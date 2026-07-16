/**
 * HTTP-layer behaviour: the retry policy, the validation boundary, and the Plasma envelope.
 * Mirrors jupiter-card-sdk's retry-safety/validation-coverage suites — the lessons are the same,
 * and none of this was covered before.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlasmaCard, HttpClient, ApiError, AuthError, RateLimitError, ValidationError, IDEMPOTENT_METHODS } from "../dist/index.js";

function json(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
const ok = (data) => json(200, { success: true, status_code: 200, data });

function clientWith(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: new URL(String(url)), init });
    return handler(calls.length, new URL(String(url)), init);
  };
  // Backoff shrunk to keep the suite fast; the policy under test is unchanged.
  const client = new PlasmaCard({
    auth: { kind: "token", privyToken: "t" },
    fetch,
    maxRetries: 2,
    retryBaseMs: 1,
    retryMaxMs: 20,
  });
  return { client, calls };
}

describe("retry policy", () => {
  it("retries an idempotent GET on 503, then succeeds", async () => {
    const { client, calls } = clientWith((n) => (n === 1 ? json(503, { e: 1 }) : ok({ id: "u1" })));
    assert.equal((await client.account.user()).id, "u1");
    assert.equal(calls.length, 2);
  });

  it("retries a GET after a network error", async () => {
    const { client, calls } = clientWith((n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return ok({ id: "u1" });
    });
    assert.equal((await client.account.user()).id, "u1");
    assert.equal(calls.length, 2);
  });

  it("surfaces RateLimitError with retryAfterMs after exhausting retries", async () => {
    const { client, calls } = clientWith(() => json(429, { success: false }, { "retry-after": "1" }));
    const err = await client.account.user().catch((e) => e);
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfterMs, 1000);
    assert.equal(calls.length, 3); // first attempt + 2 retries
  });

  it("caps an absurd Retry-After instead of parking the process for an hour", async () => {
    // A server or proxy can send any number here. Honouring it literally would hang the process
    // for an hour, per attempt. The wait must be clamped to retryMaxMs (20ms in this client).
    const started = Date.now();
    const { client } = clientWith((n) => (n === 1 ? json(503, {}, { "retry-after": "3600" }) : ok({ id: "u1" })));
    assert.equal((await client.account.user()).id, "u1");
    assert.ok(Date.now() - started < 1_000, "honoured Retry-After past the cap");
  });

  it("falls back to backoff when Retry-After is an HTTP-date rather than seconds", async () => {
    const { client, calls } = clientWith((n) =>
      n === 1 ? json(503, {}, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }) : ok({ id: "u1" }),
    );
    assert.equal((await client.account.user()).id, "u1");
    assert.equal(calls.length, 2);
  });

  it("does not retry a 400", async () => {
    const { client, calls } = clientWith(() => json(400, { success: false, status_code: 400, errors: [{ error_code: "BAD" }] }));
    await assert.rejects(() => client.account.user(), ApiError);
    assert.equal(calls.length, 1);
  });

  it("treats only replay-safe methods as retryable by default", () => {
    assert.equal(IDEMPOTENT_METHODS.has("GET"), true);
    assert.equal(IDEMPOTENT_METHODS.has("POST"), false); // never replay a POST blind
  });
});

describe("validation boundary", () => {
  it("throws on an HTML challenge page where JSON was promised", async () => {
    const { client } = clientWith(() => new Response("<html>Just a moment…</html>", { status: 200 }));
    await assert.rejects(() => client.account.user(), ValidationError);
  });

  it("parses a JSON body even when the content-type lies", async () => {
    const { client } = clientWith(() =>
      new Response(JSON.stringify({ success: true, data: { id: "u1" } }), { status: 200, headers: { "content-type": "text/plain" } }),
    );
    assert.equal((await client.account.user()).id, "u1");
  });

  it("does not leak the response body into a ValidationError message", async () => {
    const secret = "SUPER_SECRET_TOKEN_abc123";
    const { client } = clientWith(() => new Response(`<html>${secret}</html>`, { status: 200 }));
    const err = await client.account.user().catch((e) => e);
    assert.ok(err instanceof ValidationError);
    assert.ok(!err.message.includes(secret), "error message echoed the body");
  });

  it("rejects a 2xx envelope with success:false rather than returning junk", async () => {
    const { client } = clientWith(() =>
      json(200, { success: false, status_code: 422, errors: [{ error_code: "NOPE" }], data: [] }),
    );
    const err = await client.account.user().catch((e) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 422); // the envelope's status wins over the HTTP 200
    assert.equal(err.code, "NOPE");
  });

  it("throws when a list endpoint returns an object", async () => {
    const { client } = clientWith(() => ok({ not: "an array" }));
    await assert.rejects(() => client.cards.list(), ValidationError);
  });

  it("throws when a cursor page has no data array", async () => {
    const { client } = clientWith(() => ok({ next_cursor: null, has_more: false }));
    await assert.rejects(() => client.transactions.list(), ValidationError);
  });
});

describe("auth failures", () => {
  it("surfaces AuthError on 401 when no refresher is installed (token mode)", async () => {
    const { client, calls } = clientWith(() => json(401, { success: false, errors: [{ error_code: "UNAUTHORIZED" }] }));
    await assert.rejects(() => client.account.user(), AuthError);
    assert.equal(calls.length, 1); // 401 is not a transient status; no blind retry
  });

  it("keeps a failed refresh as the cause, not swallowed", async () => {
    // The caller sees the 401 on the endpoint they asked for, but the reason the session could
    // not be renewed is the part an operator needs — it must survive on `.cause`.
    const http = new HttpClient({ privyToken: "stale", fetch: async () => json(401, { success: false }) });
    const why = new Error("refresh token expired");
    http.setRefresher(async () => {
      throw why;
    });
    const err = await http.get("/v1/user").catch((e) => e);
    assert.ok(err instanceof AuthError);
    assert.equal(err.status, 401);
    assert.equal(err.cause, why, "the refresh failure was thrown away");
  });

  it("has no cause when the 401 stands on its own", async () => {
    const http = new HttpClient({ privyToken: "t", fetch: async () => json(401, { success: false }) });
    http.setRefresher(async () => false); // nothing to refresh with
    const err = await http.get("/v1/user").catch((e) => e);
    assert.ok(err instanceof AuthError);
    assert.equal(err.cause, undefined);
  });
});
