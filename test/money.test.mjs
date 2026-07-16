import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseMoney,
  formatMoney,
  directionSign,
  signedAmount,
  transactionDate,
  isSettled,
  isBookable,
} from "../dist/index.js";

// Shapes mirror real captured responses; every value here is synthetic.
const debit = { amount: "-1250000", currency: "USDT", decimals: 6 };
const credit = { amount: "250750000", currency: "USDT0", decimals: 6 };
const xpl = { amount: "1230000000000000000", currency: "XPL", decimals: 18 };

describe("money accessors", () => {
  it("parseMoney scales minor units by decimals and preserves sign", () => {
    assert.equal(parseMoney(debit), -1.25);
    assert.equal(parseMoney(credit), 250.75);
    assert.equal(parseMoney({ amount: "0", currency: "USD", decimals: 6 }), 0);
  });

  it("parseMoney returns null for unreadable money", () => {
    assert.equal(parseMoney(null), null);
    assert.equal(parseMoney(undefined), null);
    assert.equal(parseMoney({ amount: "", currency: "USD", decimals: 6 }), null);
    assert.equal(parseMoney({ amount: "1.5", currency: "USD", decimals: 6 }), null); // not integer minor units
    assert.equal(parseMoney({ currency: "USD", decimals: 6 }), null);
  });

  it("formatMoney is exact, including 18-decimal tokens that lose precision as float", () => {
    assert.equal(formatMoney(debit), "-1.25");
    assert.equal(formatMoney(credit), "250.75");
    assert.equal(formatMoney(xpl), "1.23");
    assert.equal(formatMoney({ amount: "1", currency: "XPL", decimals: 18 }), "0.000000000000000001");
    assert.equal(formatMoney({ amount: "-0", currency: "USD", decimals: 6 }), "0"); // no "-0"
    assert.equal(formatMoney({ amount: "100", currency: "USD", decimals: 0 }), "100");
    assert.equal(formatMoney({ amount: "1000000", currency: "USD", decimals: 6 }), "1"); // trailing zeros trimmed
  });

  it("directionSign / signedAmount read the already-signed amount", () => {
    assert.equal(directionSign({ amount: debit }), -1);
    assert.equal(directionSign({ amount: credit }), 1);
    assert.equal(directionSign({ amount: null }), null);
    assert.equal(signedAmount({ amount: debit }), -1.25);
    assert.equal(signedAmount({ amount: { amount: "bad", currency: "USD", decimals: 6 } }), null);
  });

  it("transactionDate reads 13-digit epoch milliseconds", () => {
    assert.equal(transactionDate({ timestamp: "1784214754685" }).toISOString(), "2026-07-16T15:12:34.685Z");
    assert.equal(transactionDate({ timestamp: "2026-07-16T15:12:34.685Z" }).getTime(), 1784214754685); // ISO fallback
    assert.equal(transactionDate({ timestamp: "" }), null);
    assert.equal(transactionDate({ timestamp: null }), null);
    assert.equal(transactionDate({ timestamp: "not-a-date" }), null);
  });

  it("isSettled / isBookable", () => {
    assert.equal(isSettled({ status: "completed" }), true);
    assert.equal(isSettled({ status: "pending" }), false);
    assert.equal(isSettled({ status: "declined" }), false);
    assert.equal(isBookable({ amount: credit, timestamp: "1784214754685", status: "completed" }), true);
    assert.equal(isBookable({ amount: null, timestamp: "1784214754685", status: "completed" }), false);
    assert.equal(isBookable({ amount: credit, timestamp: "", status: "completed" }), false);
  });
});
