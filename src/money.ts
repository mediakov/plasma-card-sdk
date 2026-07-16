/**
 * Reading money out of a transaction — carried over verbatim in spirit from jupiter-card-sdk,
 * because the lesson is universal: never compute the sign or amount inline.
 *
 *   const sum = (tx.direction === "CREDIT" ? 1 : -1) * Number(tx.amount);  // ✗
 *
 * treats an unknown/missing direction as money leaving the account (income booked as expense),
 * and Number("") === 0 turns a bad amount into a real wrong number. Both bugs shipped in the
 * Jupiter consumers before this pattern existed.
 *
 * Every accessor returns null for a record it cannot read honestly. null means "cannot be
 * represented" — skip it or surface it, never zero.
 *
 * NOTE: Plasma's transaction field names (amount / direction / timestamp) are UNVERIFIED (see
 * types.ts). Confirm them against real traffic; the logic here is correct once the field names
 * are right.
 */
import type { PlasmaTransaction } from "./types.js";

export function parseMoney(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function directionSign(tx: Pick<PlasmaTransaction, "direction">): 1 | -1 | null {
  if (tx.direction === "CREDIT") return 1;
  if (tx.direction === "DEBIT") return -1;
  return null;
}

export function signedAmount(tx: Pick<PlasmaTransaction, "direction" | "amount">): number | null {
  const sign = directionSign(tx);
  const amount = parseMoney(tx.amount);
  return sign === null || amount === null ? null : sign * amount;
}

export function transactionDate(tx: Pick<PlasmaTransaction, "timestamp">): Date | null {
  if (tx.timestamp == null || tx.timestamp === "") return null;
  const d = new Date(tx.timestamp);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the record can be booked (direction, amount, date all readable). */
export function isBookable(tx: PlasmaTransaction): boolean {
  return signedAmount(tx) !== null && transactionDate(tx) !== null;
}
