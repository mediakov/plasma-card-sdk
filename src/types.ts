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
/**
 * `card_purchase`, `receive`, `earn_deposit` and `earn_withdraw` are OBSERVED. `send`,
 * `withdrawal` and `refund` are inference and may well be wrong — note that the real earn
 * withdrawal is `earn_withdraw`, not the `earn_withdrawal` anyone would have guessed, so
 * treat the unobserved names with suspicion. `Open<>` keeps an unseen value from becoming
 * a type error.
 *
 * **Beware the earn pair.** Moving money between the cash and earn pots produces ONE row,
 * and it describes itself misleadingly:
 *
 *   { type: "earn_deposit",  balance_type: "cash", amount: -10, vault_address: "0x…" }
 *   { type: "earn_withdraw", balance_type: "cash", amount: +10, vault_address: "0x…" }
 *
 * Both are tagged `cash`, and neither has a matching earn-side row. Read literally, a
 * deposit looks like a purchase and a withdrawal looks like income. They are transfers
 * between your own two balances; the sign carries the direction.
 */
export type TransactionType = Open<
  "card_purchase" | "receive" | "earn_deposit" | "earn_withdraw" | "send" | "withdrawal" | "refund"
>;
export type TransactionSource = Open<"card" | "onchain" | "internal">;
export type BalanceType = Open<"cash" | "earn">;
export type XplTransactionType = Open<"tier_upgrade" | "reward" | "cashback">;

export interface MembershipTier {
  id?: string;
  key?: Open<"core" | "plus" | "premium">;
  display_name?: string;
  [k: string]: unknown;
}

export interface User {
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
  /**
   * The limit as a minor-units integer string, scaled by 6 (USD) — e.g. "10000000000" is 10,000.
   *
   * There is no `decimals` field here, unlike Money. The scale is confirmed arithmetically: a
   * 10,000 daily limit less a day's spend reconciles exactly with `left_to_spend`; at any other
   * scale it does not. Wrap it as `{ amount: limit, currency: "USD", decimals: 6 }` to read it
   * with the money accessors.
   */
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

export interface Card {
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
export interface Balance {
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

/**
 * The merchant's REGISTERED address — **not** where the purchase happened.
 *
 * Do not treat this as a transaction location. Observed live: an Uber Eats and a Trip.com
 * purchase both reported `Amsterdam, NL` (those companies' EU seat) for a cardholder in
 * Portugal, while the merchant actually visited in person — a Portuguese cinema chain —
 * reported no location at all. Geocoding these would put map pins in the wrong country.
 *
 * Useful for identifying a merchant; useless for locating a purchase. `address` and
 * `formatted` were empty on every merchant observed, leaving only city/country. There is
 * no lat/lng here at all.
 */
export interface MerchantLocation {
  address?: string | null;
  city?: string | null;
  country?: string | null;
  formatted?: string | null;
  [k: string]: unknown;
}

export interface TransactionMerchant {
  name?: string | null;
  /** The unnormalised descriptor, e.g. "UBER   * EATS PENDING". */
  raw_name?: string | null;
  logo?: string | null;
  mcc_code?: string | null;
  location?: MerchantLocation | null;
  category?: { name?: string | null; mcc?: number | null } | null;
  [k: string]: unknown;
}

export interface FxDetails {
  /**
   * The amount in the merchant's currency. Its `decimals` is its OWN — observed as 2 for
   * EUR while the settlement leg used 6 — so never reuse the transaction's scale here.
   */
  local_amount?: Money;
  /** Local currency per settlement unit: local_amount = amount * exchange_rate. */
  exchange_rate?: number;
  [k: string]: unknown;
}

/**
 * Cashback accrued on a purchase. It is an accrual, not money that has moved: `status`
 * was `pending` when observed. Expect the actual credit to arrive as its own transaction
 * — counting this as income when the purchase posts would double it.
 */
export interface Cashback {
  earned?: Money;
  status?: Open<"pending" | "completed">;
  /** Decimal fraction as a string, e.g. "0.03" for 3%. */
  rate_applied?: string | null;
  display_label?: string | null;
  program?: { name?: string | null; type?: string | null; display_category_name?: string | null } | null;
  cashback_type?: string | null;
  [k: string]: unknown;
}

/** The chain an on-chain leg used. `id` 0 with key "solana" was observed — not an EVM id. */
export interface ChainRef {
  id?: number | null;
  name?: string | null;
  key?: Open<"solana" | "ethereum" | "plasma">;
  [k: string]: unknown;
}

export interface TokenRef {
  symbol?: string | null;
  logo?: string | null;
  [k: string]: unknown;
}

export interface Transaction {
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
  /**
   * Fee charged on the transaction (e.g. an FX markup). It is NOT additional to `amount`:
   * reconciliation against the live balance shows `amount` is already the account's full
   * impact, so adding this on top would overstate the charge.
   */
  fee_total?: Money | null;
  /** Rewards accrued on a purchase. An accrual, not money that has moved — see Cashback. */
  cashback?: Cashback | null;
  decline_reason?: string | null;
  decline_reason_data?: { type?: string | null; message?: string | null } | null;

  // ── on-chain legs (receive / earn_deposit) ───────────────────────────────
  /** The counterparty address on `chain`. Observed as a Solana address, not an EVM one. */
  sender_address?: string | null;
  /** The on-chain transaction hash. */
  tx_hash?: string | null;
  token?: TokenRef | null;
  chain?: ChainRef | null;
  /** The earn vault the money moved into or out of (`earn_deposit` / `earn_withdraw`). */
  vault_address?: string | null;

  // ── p2p counterparty (all null on the on-chain receives observed) ─────────
  username?: string | null;
  avatar_preset_id?: string | null;
  alias?: string | null;
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

/**
 * A spend-and-get-back promotion: spend `spend_threshold`, receive `reward_amount`.
 *
 * Worth knowing if you are reconciling: when this completes, Plasma credits the reward
 * to the cash balance **without writing a transaction**. Observed live — a completed $10
 * bonus left `cash_balance` exactly $10 above the sum of every row in
 * `transaction-history`. A ledger built only from transactions will drift by the reward
 * until (or unless) a row appears for it.
 */
export interface SpendBonus {
  status?: Open<"completed" | "in_progress" | "expired">;
  reward_amount?: Money;
  spend_threshold?: Money;
  cumulative_spend?: Money;
  progress_percent?: number;
  /** Epoch milliseconds as a string, like every other Plasma timestamp. */
  expires_at?: string | null;
  completed_at?: string | null;
  days_remaining?: number;
  [k: string]: unknown;
}

/** Accrued rewards awaiting payout, and their value in the payout token. */
export interface RewardsBalance {
  balance?: Money;
  balance_payout_currency?: Money;
  [k: string]: unknown;
}

/** Bank/virtual account entries. Both endpoints wrap a (possibly empty) `accounts` array. */
export interface AccountList {
  accounts?: unknown[];
  [k: string]: unknown;
}

/**
 * Remaining headroom against the card's LIMIT — **not a balance, and not spendable funds.**
 *
 * `left_to_spend` = the card's limit for the period MINUS the non-declined card spend already
 * booked against it. Confirmed live: a 10,000 daily limit with two pending charges totalling
 * 613.78 reported exactly 9,386.22. Pending charges count; declined ones do not.
 *
 * It is derived from the limit alone and says nothing about the money in the account — the two
 * routinely differ by orders of magnitude (a 10,000 limit over an 86.28 balance). The real
 * ceiling on a purchase is the LOWER of this and the account balance, so never surface this as
 * a balance or book it into a ledger: use `Account.balance()` for funds.
 */
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
