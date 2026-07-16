# plasma-card-sdk

A TypeScript SDK for the **Plasma One** card API (`pay-tasks.prod.plasma-one.tech`), the
stablecoin neobank card by Plasma (XPL), issued by Rain.

> ⚠️ **EARLY BUT WORKING.** The endpoint map is real, email OTP login and headless token refresh
> are **confirmed live** (2026-07-16, so unattended operation works), and the read-side response
> **types are now observed from live traffic**, not guessed. What's still thin: only the read
> endpoints a syncer needs are modelled, mutations are untouched, and the models reflect one
> account's data. Read `docs/RESEARCH.md` and `docs/AUTH.md` first.

## What's known (solid)

- **Base URL:** `https://pay-tasks.prod.plasma-one.tech/api/` (+ `wss://…/ws`)
- **Auth provider:** Privy, app id `cmlp3xl8q00vl0cl84mzc1kzx`
- **108 operations** with recovered REST paths — full table in [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md)
- Read endpoints a ZenMoney syncer needs: `v1/user`, `v1/user/cards`, `v1/user/balance`,
  `v1/transaction-history`, `v1/user/virtual-accounts`, …

## What's modelled (observed live)

The read endpoints below returned real bodies on 2026-07-16; `src/types.ts` matches them (the
API's own snake_case, money as `{amount,currency,decimals}` in signed minor units, epoch-ms
timestamps, `{data,next_cursor,has_more}` cursor pages):

- `user`, `cards`, `balance`, `token-balances`, `card/left-to-spend?card_id=` (all objects/arrays)
- `transaction-history` and `rewards/xpl-transaction-history` — cursor-paginated
  (`?limit=N&cursor=<next_cursor>`). Walk them with `transactions.iterate()` (de-duped, follows
  the cursor to the end), `transactions.all()`, or `transactions.since(date)` for incremental sync

Still open: mutation endpoints are unmodelled, and the types reflect one account, so treat unusual
states (frozen cards, other currencies) as `Open<>`/optional until seen.

**Solved — unattended auth.** Privy access tokens last ~1h. An email identity linked to the
existing Privy/Plasma identity logs in through the allowed `recovery.plasma.org` web origin, and
the SDK persists the access **and refresh** tokens. It renews the access token headlessly from the
refresh token — automatically on a 401, or via `login.refresh()` — using Privy's web-origin
session-refresh call (`POST /api/v1/sessions`, refresh token + current bearer). **Confirmed live
2026-07-16** via [`examples/refresh.mjs`](examples/refresh.mjs); no OTP needed after the first
login. Full detail in [`docs/AUTH.md`](docs/AUTH.md).

## How it's built

Mirrors [`jupiter-card-sdk`](../jupiter-card-sdk)'s architecture, carrying its hard-won lessons:

- `money.ts` — `signedAmount` / `parseMoney` / `formatMoney` / `transactionDate` / `isSettled`,
  returning `null` (never a guess); `formatMoney` is exact for 18-decimal tokens
- `errors.ts` — typed hierarchy (`AuthError`, `RateLimitError`, `ValidationError`, …)
- `http.ts` — validation boundary, idempotent-only retry with jittered backoff (a server's
  `Retry-After` is honoured but capped, so it cannot park the process), auto token refresh on 401
- `types.ts` — observed shapes, kept `Open<>`/optional where a field is state-dependent

The client supports either a caller-supplied token or the confirmed email OTP flow. Email mode
persists the access + refresh tokens to a mode-`0600` session file and auto-renews:

```ts
import { PlasmaCard, formatMoney, transactionDate } from "plasma-card-sdk";

const pc = new PlasmaCard({ auth: { kind: "email", email: "you@example.com" } });
if (!pc.isAuthenticated()) {
  await pc.login.sendCode();
  await pc.login.verify("123456"); // code from email
}

const cards = await pc.cards.list();
console.log(cards[0].type, cards[0].status, "•" + cards[0].last_4);

// iterate() follows the cursor to the end — never stops on page length
for await (const tx of pc.transactions.iterate({ includeDustReceives: true })) {
  console.log(transactionDate(tx)?.toISOString(), tx.merchant?.name, formatMoney(tx.amount), tx.amount.currency);
}

// or, for incremental sync: everything since the last run
for await (const tx of pc.transactions.since(lastSyncedAt)) { /* … */ }
```

Resources are split by domain, mirroring `jupiter-card-sdk`:

| Resource | Methods |
|---|---|
| `pc.account` | `user()`, `balance()`, `tokenBalances()`, `virtualAccounts()`, `externalAccounts()` |
| `pc.cards` | `list()`, `leftToSpend(cardId)` |
| `pc.transactions` | `list()`, `iterate()`, `all()`, `since(date)` |
| `pc.rewards` | `xplTransactions()`, `iterateXplTransactions()` |

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
