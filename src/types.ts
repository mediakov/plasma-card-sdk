/**
 * Response models for the Plasma One API.
 *
 * EVERY FIELD IS OPTIONAL, ON PURPOSE. These shapes were NOT observed from real responses —
 * static analysis of a React Native app yields endpoint paths but not response schemas (see
 * docs/RESEARCH.md). The field names below are best-effort guesses from the app's naming and
 * from how card programs like Rain model data; the real API has not been seen.
 *
 * This is the same discipline the Jupiter SDK arrived at the hard way: declaring a field
 * required makes TypeScript vouch for data nobody checked, and a live API omits and renames
 * things. Read money through the accessors in `money.ts`, which return null rather than guess.
 *
 * When real captured responses become available, TIGHTEN these against them — do not assume
 * they are correct today.
 */

/**
 * The Plasma backend wraps EVERY response in this envelope — CONFIRMED from a live 401:
 *   {"success":false,"status_code":401,"message":"Unauthorized","data":[],
 *    "errors":[{"code":401,"message":"…","error_code":"UNAUTHORIZED"}],"trace_id":"…"}
 * The real payload lives in `data`. On error, `data` is `[]` and `errors` is populated.
 */
export interface ApiEnvelope<T> {
  success?: boolean;
  status_code?: number;
  message?: string;
  data?: T;
  errors?: Array<{ code?: number; message?: string; error_code?: string }>;
  trace_id?: string;
}

/** Decimal money as a string, e.g. "123.45". Parse with `parseMoney`. */
export type MoneyString = string;

/** Known union that still accepts unknown future values without a type error. */
export type Open<T extends string> = T | (string & {});

export type CardStatus = Open<"ACTIVE" | "FROZEN" | "LOCKED" | "TERMINATED" | "PENDING">;
export type TransactionDirection = Open<"DEBIT" | "CREDIT">;
export type TransactionType = Open<"CARD" | "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "REWARD">;

// ── unverified shapes — confirm against real traffic ────────────────────────

export interface PlasmaUser {
  id?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  [k: string]: unknown;
}

export interface PlasmaCard {
  id?: string | null;
  /** The account the card draws on — the stable account identity (mirrors Jupiter's cardAccountId). */
  accountId?: string | null;
  last4?: string | null;
  status?: CardStatus | null;
  nickname?: string | null;
  tier?: Open<"CARD_CORE" | "CARD_LITE" | "CARD_PLATINUM" | "CARD_GREEN"> | null;
  [k: string]: unknown;
}

export interface PlasmaBalance {
  currency?: string | null;
  /** Spendable balance — may be a number or a MoneyString; not yet observed. */
  spendable?: number | MoneyString | null;
  available?: number | MoneyString | null;
  [k: string]: unknown;
}

export interface PlasmaTransaction {
  id?: string | null;
  cardId?: string | null;
  type?: TransactionType | null;
  direction?: TransactionDirection | null;
  amount?: MoneyString | null;
  currency?: string | null;
  merchantName?: string | null;
  timestamp?: string | null;
  /** On-chain signature for the XPL/stablecoin legs. */
  onchainSignature?: string | null;
  [k: string]: unknown;
}

/** Shape of the transaction-history list response is unknown (array? {data,meta}? cursor?). */
export interface Paginated<T> {
  data?: T[] | null;
  meta?: { total?: number | null; cursor?: string | null; nextCursor?: string | null } | null;
  [k: string]: unknown;
}
