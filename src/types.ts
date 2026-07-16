/**
 * Response models for the Plasma One API.
 *
 * These were OBSERVED from real captured responses (2026-07-16) against a live account, not
 * guessed. Field names are the API's own snake_case. Fields that were consistently present are
 * declared plainly; genuinely optional / state-dependent ones are `?`, and anything that came back
 * `null` is nullable. Every object keeps an index signature so a field this one account never
 * exercised does not become a type error.
 *
 * Still read money and dates through `money.ts` — those accessors return null rather than guess,
 * the same discipline the Jupiter SDK arrived at.
 */

/**
 * The Plasma backend wraps EVERY response in this envelope — confirmed live:
 *   {"success":true,"status_code":200,"message":"…","data":<payload>,"errors":[],"trace_id":"…"}
 * The HTTP layer unwraps it; the models below describe the `data` payload. On error `data` is `[]`
 * and `errors` is populated.
 */
export interface ApiEnvelope<T> {
  success?: boolean;
  status_code?: number;
  message?: string;
  data?: T;
  errors?: Array<{ code?: number; message?: string; error_code?: string }>;
  trace_id?: string;
}

/** Known union that still accepts unknown future values without a type error. */
export type Open<T extends string> = T | (string & {});

/**
 * Money is an object, not a scalar: a signed integer `amount` in minor units (as a string),
 * plus the `decimals` needed to scale it and the `currency`. E.g. {amount:"-1250000",
 * currency:"USDT", decimals:6} is -1.25 USDT. Card debits are negative, credits positive.
 * Read it with parseMoney / formatMoney (money.ts) — never Number(amount) inline.
 */
export interface Money {
  amount: string;
  currency: Open<Currency>;
  decimals: number;
}

/** Currencies seen live; USDT0 is the on-chain USD₮0 leg, XPL the reward token. Open-ended. */
export type Currency = "USDT" | "USDT0" | "USD" | "EUR" | "XPL";

// enums — observed lowercase values, left Open for unseen states
export type CardStatus = Open<"active" | "frozen" | "locked" | "terminated" | "pending">;
export type CardType = Open<"virtual" | "physical">;
export type LimitPeriod = Open<"daily" | "weekly" | "monthly" | "yearly" | "per_transaction">;
export type TransactionStatus = Open<"completed" | "pending" | "declined" | "reversed">;
export type TransactionType = Open<"card_purchase" | "receive" | "send" | "withdrawal" | "refund">;
export type TransactionSource = Open<"card" | "onchain" | "internal">;
export type BalanceType = Open<"cash" | "earn">;
export type XplTransactionType = Open<"tier_upgrade" | "reward" | "cashback">;

export interface MembershipTier {
  id?: string;
  key?: Open<"core" | "plus" | "premium">;
  display_name?: string;
  [k: string]: unknown;
}

export interface PlasmaUser {
  id: string;
  created_at?: string;
  privy_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  country_code?: string | null;
  state_code?: string | null;
  is_verified?: boolean;
  is_account_restricted?: boolean;
  chain_ids?: number[];
  /** Smart-account and card-account addresses (the stable card account identity). */
  user_smart_account_address?: string;
  user_card_account_address?: string;
  plasma_pay_entity_id?: string;
  solana_deposit_address?: string;
  tron_deposit_address?: string;
  verified_phone_number?: string | null;
  verified_phone_country_code?: string | null;
  membership_tier?: MembershipTier;
  avatar?: { type?: string; preset_id?: string } | null;
  identity_country?: string | null;
  residence_country?: string | null;
  [k: string]: unknown;
}

export interface CardLimit {
  limit: string;
  period: LimitPeriod;
  [k: string]: unknown;
}

export interface CardProgram {
  id?: string;
  name?: string;
  timezone?: string;
  issuing_bank?: string;
  is_legacy?: boolean;
  membership_tier?: MembershipTier;
  [k: string]: unknown;
}

export interface BillingAddress {
  id?: string;
  line_1?: string | null;
  line_2?: string | null;
  line_3?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  primary?: number;
  inactive?: number;
  [k: string]: unknown;
}

export interface PlasmaCard {
  id: string;
  last_4?: string | null;
  type?: CardType;
  status?: CardStatus;
  card_name?: string | null;
  cardholder_name?: string | null;
  nickname?: string | null;
  expiration?: string | null;
  /** 0/1 flags, not booleans — the API returns numbers here. */
  locked?: number;
  pin_set?: number;
  ecomm?: number;
  atm?: number;
  primary?: number;
  limits?: CardLimit[];
  card_program?: CardProgram;
  billing_address?: BillingAddress | null;
  issuing_bank?: string;
  created_at?: string;
  [k: string]: unknown;
}

/**
 * Flat balance object. Every `*_balance` is a minor-units integer STRING scaled by the single
 * shared `decimals` (6 for USD). Wrap a field with `{ amount, currency:"USD", decimals }` to reuse
 * the money accessors, or read it directly.
 */
export interface PlasmaBalance {
  balance?: string;
  total_balance?: string;
  ledger_balance?: string;
  cash_balance?: string;
  earn_balance?: string;
  smart_account_usdt_balance?: string;
  pending_deposit_total?: string;
  decimals?: number;
  [k: string]: unknown;
}

export interface AssetBalance {
  asset_key?: string;
  display_symbol?: string;
  available_balance?: Money;
  locked_balance?: Money;
  total_balance?: Money;
  available_balance_usd?: Money;
  total_balance_usd?: Money;
  [k: string]: unknown;
}

export interface TokenBalances {
  asset_balances?: AssetBalance[];
  failures?: unknown[];
  [k: string]: unknown;
}

export interface TransactionMerchant {
  name?: string | null;
  raw_name?: string | null;
  logo?: string | null;
  mcc_code?: string | null;
  category?: { name?: string | null; mcc?: number | null } | null;
  [k: string]: unknown;
}

export interface FxDetails {
  local_amount?: Money;
  exchange_rate?: number;
  [k: string]: unknown;
}

export interface PlasmaTransaction {
  id: string;
  /** Signed money: negative for debits (card_purchase), positive for credits (receive). */
  amount: Money;
  /** Epoch MILLISECONDS as a string (13 digits). Read via transactionDate. */
  timestamp: string;
  status: TransactionStatus;
  type: TransactionType;
  source?: TransactionSource;
  balance_type?: BalanceType;
  merchant?: TransactionMerchant | null;
  card?: { last_4?: string | null } | null;
  fx_details?: FxDetails | null;
  decline_reason?: string | null;
  decline_reason_data?: { type?: string | null; message?: string | null } | null;
  [k: string]: unknown;
}

export interface TierUpgrade {
  expires_at?: string | null;
  method?: string | null;
  target_tier_key?: string | null;
  target_tier_name?: string | null;
  [k: string]: unknown;
}

export interface XplTransaction {
  id: string;
  source_transaction_id?: string | null;
  type: XplTransactionType;
  amount: Money;
  timestamp: string;
  status: TransactionStatus;
  display_title?: string | null;
  tier_upgrade?: TierUpgrade | null;
  tx_hash?: string | null;
  [k: string]: unknown;
}

/** Bank/virtual account entries. Both endpoints wrap a (possibly empty) `accounts` array. */
export interface AccountList {
  accounts?: unknown[];
  [k: string]: unknown;
}

export interface CardLeftToSpend {
  left_to_spend?: string | Money | null;
  [k: string]: unknown;
}

/**
 * Cursor-paginated list, confirmed live: `{ data, next_cursor, has_more }`. Page with
 * `?limit=N&cursor=<next_cursor>` until `has_more` is false — never stop early on `data` length
 * alone (the Jupiter ordering lesson). `next_cursor` is a timestamp-based opaque string.
 */
export interface CursorPage<T> {
  data: T[];
  next_cursor?: string | null;
  has_more?: boolean;
  [k: string]: unknown;
}
