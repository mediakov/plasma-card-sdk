# plasma-card-sdk

A TypeScript SDK for the **Plasma One** card API (`pay-tasks.prod.plasma-one.tech`), the
stablecoin neobank card by Plasma (XPL), issued by Rain.

> ⚠️ **PRE-ALPHA.** The endpoint map is real (recovered by static analysis), the email OTP login
> path is confirmed live, and headless token refresh is **confirmed live** (2026-07-16) — so
> unattended operation works. The remaining gap: response **types are still guesses** and must be
> tightened against real captured bodies. Read `docs/RESEARCH.md` and `docs/AUTH.md` first.

## What's known (solid)

- **Base URL:** `https://pay-tasks.prod.plasma-one.tech/api/` (+ `wss://…/ws`)
- **Auth provider:** Privy, app id `cmlp3xl8q00vl0cl84mzc1kzx`
- **108 operations** with recovered REST paths — full table in [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md)
- Read endpoints a ZenMoney syncer needs: `v1/user`, `v1/user/cards`, `v1/user/balance`,
  `v1/transaction-history`, `v1/user/virtual-accounts`, …

## What's NOT known (the remaining blocker)

1. **Response shapes.** Static analysis of a React Native app yields paths, not response schemas.
   The types in `src/types.ts` are **all-optional guesses** — the honest default (same lesson the
   Jupiter SDK learned: shapes must be observed). Tighten them against real captured responses.

**Solved — unattended auth.** Privy access tokens last ~1h. An email identity linked to the
existing Privy/Plasma identity logs in through the allowed `recovery.plasma.org` web origin, and
the SDK persists the access **and refresh** tokens. It renews the access token headlessly from the
refresh token — automatically on a 401, or via `login.refresh()` — using Privy's web-origin
session-refresh call (`POST /api/v1/sessions`, refresh token + current bearer). **Confirmed live
2026-07-16** via [`examples/refresh.mjs`](examples/refresh.mjs); no OTP needed after the first
login. Full detail in [`docs/AUTH.md`](docs/AUTH.md).

## How it's built

Mirrors [`jupiter-card-sdk`](../jupiter-card-sdk)'s architecture, carrying its hard-won lessons:

- `money.ts` — `signedAmount` / `parseMoney` / `transactionDate`, returning `null` (never a guess)
- `errors.ts` — typed hierarchy (`AuthError`, `RateLimitError`, `ValidationError`, …)
- `http.ts` — validation boundary, idempotent-only retry, no replay of non-idempotent POSTs
- `types.ts` — every field optional, on purpose

The client supports either a caller-supplied token or the confirmed email OTP flow. Email mode
persists only its short-lived access token to a mode-`0600` session file:

```ts
import { PlasmaCard, signedAmount } from "plasma-card-sdk";

const pc = new PlasmaCard({ auth: { kind: "email", email: "you@example.com" } });
if (!pc.isAuthenticated()) {
  await pc.login.sendCode();
  await pc.login.verify("123456"); // code from email
}
const cards = await pc.account.cards();
for (const tx of (await pc.account.transactions()).data ?? []) {
  console.log(tx.merchantName, signedAmount(tx));
}
```

Or use the runnable example after building:

```bash
npm run build
PLASMA_EMAIL=you@example.com node examples/login.mjs             # sends an OTP
PLASMA_EMAIL=you@example.com PLASMA_OTP=123456 node examples/login.mjs
```

## To make it real

1. Capture the app's live traffic only on a safe test device. It can reveal the SDK-managed
   refresh protocol and the real response bodies needed to tighten the types.
2. Tighten `src/types.ts` against captured responses; confirm pagination + params.
3. Add automatic refresh only after that protocol is observed and shown to work headlessly.

### Web-origin probe (email identities only)

For a one-shot diagnostic of Privy's origin-gated web mode, use the helper below. It requests an
emailed OTP, exchanges it without printing or saving the bearer token, then checks whether that
token can read the Plasma user endpoint. Prefer the SDK flow above for normal use:

```bash
PLASMA_EMAIL=you@example.com node examples/web-origin-email.mjs start
PLASMA_EMAIL=you@example.com PLASMA_OTP=123456 node examples/web-origin-email.mjs verify
```

This does **not** bypass mobile attestation. Previous research found that the email identity may
be separate from the phone-linked Plasma account, in which case the final identity check succeeds
but returns no card data. Do not repeat `start` rapidly: Privy rate-limits these requests.

## Docs

- [`docs/RESEARCH.md`](docs/RESEARCH.md) — full recon: how everything was found, and the wall
- [`docs/AUTH.md`](docs/AUTH.md) — Privy flow + the attestation blocker + how auth is handled here
- [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md) — all 108 operations, methods + paths
- `docs/operation-keys.txt` — raw query/mutation key constants
