/**
 * Reading money and dates out of a transaction. The lesson carried from jupiter-card-sdk is
 * universal: never compute the amount, sign, or date inline. Every accessor returns null for a
 * record it cannot read honestly — null means "cannot be represented", so skip or surface it,
 * never silently book it as zero.
 *
 * Plasma specifics, confirmed live:
 *  - Money is `{ amount, currency, decimals }`: `amount` is a SIGNED integer in minor units, as a
 *    string; `decimals` is its scale. Debits (card_purchase) are negative, credits positive.
 *  - `timestamp` is epoch MILLISECONDS as a 13-digit string, not ISO.
 */
import type { Money, Transaction } from "./types.js";

function isMoney(v: unknown): v is Money {
  return typeof v === "object" && v !== null &&
    typeof (v as Money).amount === "string" && typeof (v as Money).decimals === "number";
}

/**
 * A Money object as a decimal number (e.g. {amount:"-1250000",decimals:6} → -1.25).
 * Convenient but lossy beyond ~15 significant digits — for 18-decimal tokens (XPL) prefer
 * formatMoney, which is exact. Returns null when the record cannot be read.
 */
export function parseMoney(money: Money | null | undefined): number | null {
  if (!isMoney(money)) return null;
  if (!/^-?\d+$/.test(money.amount)) return null;
  const n = Number(money.amount) / 10 ** money.decimals;
  return Number.isFinite(n) ? n : null;
}

/**
 * A Money object as an exact decimal string (e.g. "-1.25"), computed with BigInt so no precision
 * is lost regardless of `decimals`. Returns null when the record cannot be read.
 */
export function formatMoney(money: Money | null | undefined): string | null {
  if (!isMoney(money) || !/^-?\d+$/.test(money.amount)) return null;
  const neg = money.amount.startsWith("-");
  const digits = (neg ? money.amount.slice(1) : money.amount).padStart(money.decimals + 1, "0");
  const cut = digits.length - money.decimals;
  const whole = digits.slice(0, cut);
  const frac = money.decimals > 0 ? "." + digits.slice(cut) : "";
  const body = `${whole}${frac}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return (neg && /[1-9]/.test(digits) ? "-" : "") + body;
}

/** The sign of a transaction's (already-signed) amount: 1 credit, -1 debit, null if unreadable. */
export function directionSign(tx: Pick<Transaction, "amount">): 1 | -1 | null {
  const n = parseMoney(tx.amount);
  if (n === null) return null;
  return n < 0 ? -1 : 1;
}

/** The signed decimal amount of a transaction (Plasma already signs it). Null if unreadable. */
export function signedAmount(tx: Pick<Transaction, "amount">): number | null {
  return parseMoney(tx.amount);
}

/**
 * The transaction time as a Date. Plasma sends epoch milliseconds as a numeric string; an ISO
 * string is also accepted defensively. Returns null for anything unparseable.
 */
export function transactionDate(tx: Pick<Transaction, "timestamp">): Date | null {
  const ts = tx.timestamp;
  if (ts == null || ts === "") return null;
  const d = /^\d+$/.test(String(ts)) ? new Date(Number(ts)) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The currencies Plasma settles at par with USD.
 *
 * This is not an assumption about market prices — it is what the backend itself does. Its own
 * balance arithmetic mixes the two 1:1: a day of `USDT0` receives (914.852556) less `USDT` holds
 * (677.39) reconciles exactly to the USD-labelled `cash_balance` of 237.462556. Treating them as
 * one unit therefore matches the ledger the API is keeping.
 *
 * It is deliberately the OBSERVED set, not every dollar-ish token. A currency that is not in here
 * — XPL above all, which floats and is worth nothing near a dollar — converts to `null` rather
 * than being waved through at par.
 */
export const USD_PEGGED: ReadonlySet<string> = new Set(["USD", "USDT", "USDT0"]);

/** Whether a currency is one Plasma settles at par with USD. */
export function isUsdPegged(currency: string | null | undefined): boolean {
  return typeof currency === "string" && USD_PEGGED.has(currency);
}

/**
 * Re-denominate money into USD, or null if it is not a USD-pegged currency.
 *
 * Par means the minor units carry over untouched — only the label changes — so this is exact and
 * safe to `formatMoney`. Returns null for XPL and anything else unknown: converting those needs a
 * price the API did not give us here, and inventing one would put a fabricated number in a ledger.
 * (For token holdings the API does supply `AssetBalance.total_balance_usd` — use that instead.)
 */
export function toUsd(money: Money | null | undefined): Money | null {
  if (!isMoney(money) || !isUsdPegged(money.currency)) return null;
  return { amount: money.amount, currency: "USD", decimals: money.decimals };
}

/**
 * A transaction's signed amount in USD, or null when its currency is not USD-pegged.
 *
 * This is the figure to book: it normalises the `USDT` / `USDT0` split that otherwise makes a
 * naive sum add two different-looking units together.
 */
export function usdAmount(tx: Pick<Transaction, "amount">): number | null {
  return parseMoney(toUsd(tx.amount));
}

/**
 * The local-currency leg of a foreign-currency purchase (e.g. −54.57 EUR), or null if the
 * transaction did not involve FX. Structured Money — never parse it out of a string.
 */
export function localAmount(tx: Pick<Transaction, "fx_details">): Money | null {
  const local = tx.fx_details?.local_amount;
  return isMoney(local) ? local : null;
}

/**
 * The FX rate applied, or null. Confirmed live on every FX row: it is the LOCAL currency per
 * SETTLEMENT unit, i.e. `local_amount = amount * exchange_rate` (63.61 USDT * 0.85788 = 54.57 EUR).
 */
export function exchangeRate(tx: Pick<Transaction, "fx_details">): number | null {
  const rate = tx.fx_details?.exchange_rate;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

/** A settled transaction (money has actually moved) — excludes pending holds and declines. */
export function isSettled(tx: Pick<Transaction, "status">): boolean {
  return tx.status === "completed";
}

/** True when the record can be booked at all: amount and date are both readable. */
export function isBookable(tx: Transaction): boolean {
  return signedAmount(tx) !== null && transactionDate(tx) !== null;
}
