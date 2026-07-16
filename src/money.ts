/**
 * Reading money and dates out of a transaction. The lesson carried from jupiter-card-sdk is
 * universal: never compute the amount, sign, or date inline. Every accessor returns null for a
 * record it cannot read honestly — null means "cannot be represented", so skip or surface it,
 * never silently book it as zero.
 *
 * Plasma specifics, confirmed live (docs/AUTH.md capture):
 *  - Money is `{ amount, currency, decimals }`: `amount` is a SIGNED integer in minor units, as a
 *    string; `decimals` is its scale. Debits (card_purchase) are negative, credits positive.
 *  - `timestamp` is epoch MILLISECONDS as a 13-digit string, not ISO.
 */
import type { Money, PlasmaTransaction } from "./types.js";

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
export function directionSign(tx: Pick<PlasmaTransaction, "amount">): 1 | -1 | null {
  const n = parseMoney(tx.amount);
  if (n === null) return null;
  return n < 0 ? -1 : 1;
}

/** The signed decimal amount of a transaction (Plasma already signs it). Null if unreadable. */
export function signedAmount(tx: Pick<PlasmaTransaction, "amount">): number | null {
  return parseMoney(tx.amount);
}

/**
 * The transaction time as a Date. Plasma sends epoch milliseconds as a numeric string; an ISO
 * string is also accepted defensively. Returns null for anything unparseable.
 */
export function transactionDate(tx: Pick<PlasmaTransaction, "timestamp">): Date | null {
  const ts = tx.timestamp;
  if (ts == null || ts === "") return null;
  const d = /^\d+$/.test(String(ts)) ? new Date(Number(ts)) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A settled transaction (money has actually moved) — excludes pending holds and declines. */
export function isSettled(tx: Pick<PlasmaTransaction, "status">): boolean {
  return tx.status === "completed";
}

/** True when the record can be booked at all: amount and date are both readable. */
export function isBookable(tx: PlasmaTransaction): boolean {
  return signedAmount(tx) !== null && transactionDate(tx) !== null;
}
