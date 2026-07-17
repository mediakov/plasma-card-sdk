/**
 * Plasma One backend, recovered by static analysis of the app.
 * The marketing domains (plasma.to / plasma.org) are NOT the API.
 */
export const PLASMA_BASE = "https://pay-tasks.prod.plasma-one.tech/api";
export const PLASMA_WS = "wss://pay-tasks-ws.prod.plasma-one.tech/ws";

/**
 * Privy auth (privy.io). These are the app's PUBLIC client identifiers — shipped in the app,
 * not secrets. They do not, by themselves, grant access: Privy enforces native app attestation
 * on login, so headless login is not possible with these alone.
 */
export const PRIVY_APP_ID = "cmlp3xl8q00vl0cl84mzc1kzx";
export const PRIVY_CLIENT_ID = "client-WY6W311hfzEMNBRfQRYbEu3kg9ubJw5wqUzmJy2Wa4qfs";

/** A realistic UA; the app is React Native so this may need tuning against real traffic. */
export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DEFAULTS = {
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseMs: 500,
  retryMaxMs: 8_000,
  /** Backstop for any paginated endpoint whose page count is unknown until real traffic is seen. */
  maxPages: 500,
} as const;

/**
 * Endpoints recovered from the app bundle. Only the read endpoints a syncer needs are listed
 * here; the app exposes ~108 operations in total.
 *
 * Paths marked `TEMPLATED` are built from a path parameter in the app and were not a single
 * string literal — the id-bearing shape is inferred and MUST be confirmed against real traffic.
 */
export const ENDPOINTS = {
  user: "/v1/user", // GET — confirmed live
  cards: "/v1/user/cards", // GET — confirmed live (bare JSON array)
  balance: "/v1/user/balance", // GET — confirmed live
  tokenBalances: "/v1/user/token-balances", // GET — confirmed live
  cardLeftToSpend: "/v1/user/card/left-to-spend", // GET — confirmed; requires ?card_id=<id>
  transactionHistory: "/v1/transaction-history", // GET — confirmed; params: includeDustReceives, limit, cursor
  transactionOne: "/v1/transaction-history/{id}", // GET — TEMPLATED, not yet confirmed
  virtualAccounts: "/v1/user/virtual-accounts", // GET — confirmed live ({accounts:[]})
  externalAccounts: "/v1/user/external-accounts", // GET — confirmed live ({accounts:[]})
  xplTransactionHistory: "/v1/user/rewards/xpl-transaction-history", // GET — confirmed; cursor-paginated
  spendBonus: "/v1/user/rewards/spend-bonus", // GET — confirmed live
  rewardsBalance: "/v1/user/rewards/balance", // GET — confirmed live
} as const;

/**
 * Auth is a standard Bearer token — CONFIRMED by a live 401 from v1/phone/send-code:
 * `"Missing or invalid Authorization header"`. The app presents the Privy access token as
 * `Authorization: Bearer <privy-jwt>`. (The privy-* headers exist in the app but the backend
 * gate checks `Authorization`.)
 */
export const AUTH_SCHEME = "Bearer" as const;
