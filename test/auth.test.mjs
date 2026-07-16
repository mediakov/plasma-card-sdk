import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { PlasmaCard, AuthError } from "../dist/index.js";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionFile() {
  const dir = mkdtempSync(join(tmpdir(), "plasma-sdk-test-"));
  dirs.push(dir);
  return join(dir, "session.json");
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("email auth", () => {
  it("uses the confirmed web-origin OTP flow, persists the access token, and authorizes Plasma", async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/passwordless/init")) return response(200, { success: true });
      if (String(url).endsWith("/passwordless/authenticate")) return response(200, { token: "plasma-access-token" });
      if (String(url).endsWith("/v1/user")) return response(200, { success: true, data: { id: "user-1" } });
      throw new Error(`unexpected URL ${url}`);
    };
    const file = sessionFile();
    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: file }, fetch });

    assert.equal(client.isAuthenticated(), false);
    await client.login.sendCode();
    await client.login.verify("123456");
    assert.equal(client.isAuthenticated(), true);
    assert.equal((await client.account.user()).id, "user-1");

    assert.deepEqual(JSON.parse(calls[0].init.body), { email: "you@example.com" });
    assert.deepEqual(JSON.parse(calls[1].init.body), { email: "you@example.com", code: "123456" });
    assert.equal(calls[0].init.headers.origin, "https://recovery.plasma.org");
    assert.equal(calls[2].init.headers.authorization, "Bearer plasma-access-token");
    assert.equal(statSync(file).mode & 0o777, 0o600);

    const restored = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: file }, fetch });
    assert.equal(restored.isAuthenticated(), true);
    restored.login.clearLocalSession();
    assert.equal(restored.isAuthenticated(), false);
  });

  it("rejects a successful-looking verification response without an access token", async () => {
    const fetch = async () => response(200, { user: { id: "without-token" } });
    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: sessionFile() }, fetch });
    await assert.rejects(() => client.login.verify("123456"), AuthError);
  });

  it("persists the rotating refresh token and renews the access token on a 401", async () => {
    let userCalls = 0;
    const calls = [];
    const fetch = async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.endsWith("/passwordless/authenticate")) {
        return response(200, { token: "access-1", refresh_token: "refresh-1" });
      }
      if (u.endsWith("/api/v1/sessions")) {
        return response(200, { token: "access-2", refresh_token: "refresh-2" });
      }
      if (u.endsWith("/v1/user")) {
        userCalls++;
        // First call sees the stale token and 401s; the replay carries the renewed token.
        return init.headers.authorization === "Bearer access-1"
          ? response(401, { success: false, status_code: 401, errors: [{ error_code: "UNAUTHORIZED" }] })
          : response(200, { success: true, data: { id: "user-1", bearer: init.headers.authorization } });
      }
      throw new Error(`unexpected URL ${u}`);
    };

    const file = sessionFile();
    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: file }, fetch });
    await client.login.verify("123456");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).refreshToken, "refresh-1");

    const user = await client.account.user();
    assert.equal(user.id, "user-1");
    assert.equal(user.bearer, "Bearer access-2"); // replayed with the renewed token
    assert.equal(userCalls, 2); // original 401 + one replay

    const sessionsCall = calls.find((c) => c.url.endsWith("/api/v1/sessions"));
    assert.deepEqual(JSON.parse(sessionsCall.init.body), { refresh_token: "refresh-1" });
    assert.equal(sessionsCall.init.headers.origin, "https://recovery.plasma.org");
    // Confirmed live: Privy's /sessions pairs the refresh token with the current access token.
    assert.equal(sessionsCall.init.headers.authorization, "Bearer access-1");

    // The rotated refresh token replaced the old one on disk.
    assert.equal(JSON.parse(readFileSync(file, "utf8")).refreshToken, "refresh-2");
  });

  it("does not retry a 401 when there is no refresh token to use", async () => {
    let userCalls = 0;
    const fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith("/passwordless/authenticate")) return response(200, { token: "access-1" }); // no refresh_token
      if (u.endsWith("/api/v1/sessions")) throw new Error("must not attempt refresh without a token");
      if (u.endsWith("/v1/user")) {
        userCalls++;
        return response(401, { success: false, status_code: 401, errors: [{ error_code: "UNAUTHORIZED" }] });
      }
      throw new Error(`unexpected URL ${u}`);
    };
    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: sessionFile() }, fetch });
    await client.login.verify("123456");
    assert.equal(await client.login.refresh(), false);
    await assert.rejects(() => client.account.user(), AuthError);
    assert.equal(userCalls, 1); // surfaced the 401 without a replay
  });
});
