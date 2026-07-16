import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlasmaCard } from "../dist/index.js";

/** Wrap a payload in the Plasma envelope the HTTP layer unwraps. */
function ok(data) {
  return new Response(JSON.stringify({ success: true, status_code: 200, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: new URL(String(url)), init });
    return handler(new URL(String(url)), init);
  };
  return { client: new PlasmaCard({ auth: { kind: "token", privyToken: "t" }, fetch }), calls };
}

describe("resources", () => {
  it("cards() reads a bare JSON array payload", async () => {
    const { client } = clientWith(() => ok([{ id: "c1", type: "virtual", status: "active", last_4: "1234" }]));
    const cards = await client.cards.list();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].last_4, "1234");
  });

  it("cardLeftToSpend() requires and sends the card id", async () => {
    const { client, calls } = clientWith(() => ok({ left_to_spend: { amount: "1000000000", currency: "USDT", decimals: 6 } }));
    const r = await client.cards.leftToSpend("card-123");
    assert.equal(calls[0].url.searchParams.get("card_id"), "card-123");
    assert.equal(r.left_to_spend.amount, "1000000000");
  });

  it("transactions() returns the cursor page verbatim and forwards params", async () => {
    const { client, calls } = clientWith(() =>
      ok({ data: [{ id: "t1", amount: { amount: "-100", currency: "USDT", decimals: 6 }, timestamp: "1784214754685", status: "completed", type: "card_purchase" }], next_cursor: "cur-2", has_more: true }),
    );
    const page = await client.transactions.list({ includeDustReceives: true, limit: 2 });
    assert.equal(page.data.length, 1);
    assert.equal(page.next_cursor, "cur-2");
    assert.equal(page.has_more, true);
    assert.equal(calls[0].url.searchParams.get("includeDustReceives"), "true");
    assert.equal(calls[0].url.searchParams.get("limit"), "2");
  });

  it("iterateTransactions() follows next_cursor until has_more is false", async () => {
    const pages = {
      // no cursor => page 1; cursor "cur-2" => page 2 (last)
      "": { data: [{ id: "t1" }, { id: "t2" }], next_cursor: "cur-2", has_more: true },
      "cur-2": { data: [{ id: "t3" }], next_cursor: null, has_more: false },
    };
    const seenCursors = [];
    const { client } = clientWith((url) => {
      const cur = url.searchParams.get("cursor") ?? "";
      seenCursors.push(cur);
      return ok(pages[cur]);
    });

    const ids = [];
    for await (const tx of client.transactions.iterate({ limit: 2 })) ids.push(tx.id);
    assert.deepEqual(ids, ["t1", "t2", "t3"]);
    assert.deepEqual(seenCursors, ["", "cur-2"]); // exactly two requests, second carried the cursor
  });

  it("iterateTransactions() stops when has_more is true but no cursor is provided", async () => {
    // Defensive: a truthy has_more with a null cursor must not loop forever.
    const { client, calls } = clientWith(() => ok({ data: [{ id: "t1" }], next_cursor: null, has_more: true }));
    const ids = [];
    for await (const tx of client.transactions.iterate()) ids.push(tx.id);
    assert.deepEqual(ids, ["t1"]);
    assert.equal(calls.length, 1);
  });

  it("iterateTransactions() yields a record served on two pages only once", async () => {
    // next_cursor is timestamp-based, so records sharing a timestamp can straddle a boundary.
    const pages = {
      "": { data: [{ id: "t1" }, { id: "t2" }], next_cursor: "cur-2", has_more: true },
      "cur-2": { data: [{ id: "t2" }, { id: "t3" }], next_cursor: null, has_more: false },
    };
    const { client } = clientWith((url) => ok(pages[url.searchParams.get("cursor") ?? ""]));
    const ids = [];
    for await (const tx of client.transactions.iterate()) ids.push(tx.id);
    assert.deepEqual(ids, ["t1", "t2", "t3"]); // t2 not double-counted
  });

  it("allTransactions() collects every page", async () => {
    const pages = {
      "": { data: [{ id: "t1" }], next_cursor: "cur-2", has_more: true },
      "cur-2": { data: [{ id: "t2" }], next_cursor: null, has_more: false },
    };
    const { client } = clientWith((url) => ok(pages[url.searchParams.get("cursor") ?? ""]));
    assert.deepEqual((await client.transactions.all()).map((t) => t.id), ["t1", "t2"]);
  });

  describe("transactionsSince()", () => {
    const from = new Date("2026-07-16T00:00:00Z");
    const at = (iso) => String(new Date(iso).getTime());

    it("keeps records at or after `from` and drops older ones", async () => {
      const { client } = clientWith(() =>
        ok({
          data: [
            { id: "new", timestamp: at("2026-07-16T10:00:00Z") },
            { id: "boundary", timestamp: at("2026-07-16T00:00:00Z") }, // exactly `from` — kept
            { id: "old", timestamp: at("2026-07-15T23:59:59Z") },
          ],
          next_cursor: null,
          has_more: false,
        }),
      );
      const ids = [];
      for await (const tx of client.transactions.since(from)) ids.push(tx.id);
      assert.deepEqual(ids, ["new", "boundary"]);
    });

    it("keeps paging past a page that ends before `from` — the API promises no ordering", async () => {
      const pages = {
        "": { data: [{ id: "old", timestamp: at("2026-01-01T00:00:00Z") }], next_cursor: "cur-2", has_more: true },
        "cur-2": { data: [{ id: "new", timestamp: at("2026-07-17T00:00:00Z") }], next_cursor: null, has_more: false },
      };
      const { client } = clientWith((url) => ok(pages[url.searchParams.get("cursor") ?? ""]));
      const ids = [];
      for await (const tx of client.transactions.since(from)) ids.push(tx.id);
      assert.deepEqual(ids, ["new"]); // reached only by not stopping at the out-of-range page
    });

    it("keeps a record whose timestamp cannot be read rather than hiding it", async () => {
      const { client } = clientWith(() =>
        ok({ data: [{ id: "unreadable", timestamp: "not-a-date" }], next_cursor: null, has_more: false }),
      );
      const ids = [];
      for await (const tx of client.transactions.since(from)) ids.push(tx.id);
      assert.deepEqual(ids, ["unreadable"]);
    });

    it("rejects an invalid `from` instead of silently returning nothing", async () => {
      const { client } = clientWith(() => ok({ data: [], next_cursor: null, has_more: false }));
      await assert.rejects(async () => {
        for await (const _ of client.transactions.since(new Date("nope"))) void _;
      }, RangeError);
    });
  });
});
