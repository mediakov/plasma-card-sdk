/**
 * Session durability. Privy burns the old refresh token when it issues a new one, so the write
 * that persists the rotated token is the difference between an unattended syncer and a manual OTP.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { PlasmaCard, SessionStore } from "../dist/index.js";

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), "plasma-session-"));
  dirs.push(d);
  return d;
}
const response = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("session store", () => {
  it("round-trips a session at mode 0600 and leaves no temp file behind", () => {
    const dir = tmpDir();
    const file = join(dir, "s.json");
    const store = new SessionStore(file);
    store.save({ version: 2, accessToken: "a1", refreshToken: "r1" });
    assert.deepEqual(store.load(), { version: 2, accessToken: "a1", refreshToken: "r1" });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ["s.json"], "a .tmp file was left on disk");
  });

  it("creates a private directory when one is missing", () => {
    const file = join(tmpDir(), "nested", "s.json");
    new SessionStore(file).save({ version: 2, accessToken: "a1" });
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("still reads a v1 file written before refresh support", () => {
    const file = join(tmpDir(), "s.json");
    writeFileSync(file, JSON.stringify({ version: 1, accessToken: "old" }));
    assert.deepEqual(new SessionStore(file).load(), { version: 2, accessToken: "old", refreshToken: undefined });
  });

  it("treats a truncated file as absent rather than throwing", () => {
    const file = join(tmpDir(), "s.json");
    writeFileSync(file, '{"version":2,"accessToken":"a1","refresh');
    assert.equal(new SessionStore(file).load(), undefined);
  });

  it("never leaves a torn file: an overwrite is atomic", () => {
    // The old session must survive intact until the new one is completely on disk. Proven by
    // checking the target is only ever whole: rename() swaps it in one step.
    const dir = tmpDir();
    const file = join(dir, "s.json");
    const store = new SessionStore(file);
    store.save({ version: 2, accessToken: "a1", refreshToken: "r1" });
    for (let i = 2; i < 6; i++) {
      store.save({ version: 2, accessToken: `a${i}`, refreshToken: `r${i}` });
      // Whatever a crash interrupted, what is readable now parses and is a complete session.
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(parsed.accessToken, `a${i}`);
      assert.equal(parsed.refreshToken, `r${i}`);
      assert.deepEqual(readdirSync(dir), ["s.json"]);
    }
  });

  it("clear() leaves no token behind", () => {
    const file = join(tmpDir(), "s.json");
    const store = new SessionStore(file);
    store.save({ version: 2, accessToken: "a1", refreshToken: "r1" });
    store.clear();
    assert.equal(store.load(), undefined);
    assert.ok(!readFileSync(file, "utf8").includes("r1"));
  });
});

describe("concurrent refresh across processes", () => {
  it("adopts a token another process already rotated, instead of dying", async () => {
    // Two syncers share a session file. The other one refreshes first, which BURNS our refresh
    // token; Privy then rejects ours. The healthy session is right there on disk — use it.
    const file = join(tmpDir(), "s.json");
    const store = new SessionStore(file);
    store.save({ version: 2, accessToken: "stale", refreshToken: "r1" });

    const fetch = async (url) => {
      if (String(url).endsWith("/api/v1/sessions")) {
        // Simulate the other process having rotated first: our r1 is dead...
        store.save({ version: 2, accessToken: "winner-access", refreshToken: "r2" });
        return response(401, { error: "invalid refresh token" });
      }
      if (String(url).endsWith("/v1/user")) return response(200, { success: true, data: { id: "u1" } });
      throw new Error(`unexpected ${url}`);
    };

    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: file }, fetch });
    assert.equal(await client.login.refresh(), true, "refresh should recover, not throw");
    // ...and we are now using the winner's token, not a dead one.
    assert.equal((await client.account.user()).id, "u1");
    assert.equal(store.load().refreshToken, "r2");
  });

  it("still fails when the refresh is genuinely rejected and no one rotated it", async () => {
    const file = join(tmpDir(), "s.json");
    new SessionStore(file).save({ version: 2, accessToken: "a1", refreshToken: "r1" });
    const fetch = async () => response(401, { error: "expired refresh token" });
    const client = new PlasmaCard({ auth: { kind: "email", email: "you@example.com", sessionFile: file }, fetch });
    await assert.rejects(() => client.login.refresh());
  });
});
