# plasma-card-sdk

A TypeScript SDK for the **Plasma One** card API (`pay-tasks.prod.plasma-one.tech`), the
stablecoin neobank card by Plasma (XPL), issued by Rain.

> ⚠️ **EARLY BUT WORKING.** Email OTP login and headless token refresh are **confirmed live**
> (2026-07-16, so unattended operation works), and the read-side response **types are observed from
> live traffic**, not guessed. What's still thin: only read endpoints are modelled, mutations are
> untouched, and the models reflect one account's data.

## What's known (solid)

- **Base URL:** `https://pay-tasks.prod.plasma-one.tech/api/` (+ `wss://…/ws`)
- **Auth provider:** Privy
- Read endpoints a syncer needs: `v1/user`, `v1/user/cards`, `v1/user/balance`,
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

**Unattended auth.** Privy access tokens last exactly 60 minutes. Log in once with an email OTP
(the email must be linked to your Privy identity), and the SDK persists the access **and refresh**
tokens to a mode-`0600` session file and renews the access token from the refresh token on its own
— automatically on a 401, or via `login.refresh()`. Verify it yourself with
[`examples/refresh.mjs`](examples/refresh.mjs); no OTP is needed after the first login, for as long
as the refresh token stays valid.

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

## Known gaps

Worth knowing before you rely on this:

- **The models reflect one account.** States it has never been in — frozen cards, other
  currencies, `send`/`withdrawal`/`refund` rows — are inference, kept inside `Open<>` and optional
  fields so they degrade rather than crash.
- **Mutations are unmodelled.** Read endpoints only.
- **Whether a pending charge keeps its id when it settles is unverified.** If you dedupe by id,
  confirm that before trusting a ledger built from this.
- **The refresh token's lifetime is unknown** (it is opaque, not a JWT), so how long unattended
  operation lasts before a fresh OTP is needed has not been established.

## Security

The session file holds a refresh token that renews itself — treat it as a password, not a
one-hour credential. See [SECURITY.md](SECURITY.md).
