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
  USD_PEGGED,
  isUsdPegged,
  toUsd,
  usdAmount,
  localAmount,
  exchangeRate,
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

  it("toUsd re-denominates pegged currencies at par, exactly", () => {
    // Par => minor units carry over untouched; only the label changes, so it stays exact.
    assert.deepEqual(toUsd(credit), { amount: "250750000", currency: "USD", decimals: 6 });
    assert.deepEqual(toUsd(debit), { amount: "-1250000", currency: "USD", decimals: 6 });
    assert.equal(formatMoney(toUsd(credit)), "250.75");
    assert.equal(toUsd({ amount: "1", currency: "USD", decimals: 6 })?.currency, "USD");
  });

  it("toUsd refuses currencies that are not pegged, rather than waving them through", () => {
    assert.equal(toUsd(xpl), null); // XPL floats — par would fabricate a number
    assert.equal(toUsd({ amount: "100", currency: "EUR", decimals: 2 }), null);
    assert.equal(toUsd(null), null);
  });

  it("isUsdPegged covers the observed set only", () => {
    for (const c of ["USD", "USDT", "USDT0"]) assert.equal(isUsdPegged(c), true);
    for (const c of ["XPL", "EUR", "USDC", "", null, undefined]) assert.equal(isUsdPegged(c), false);
    assert.equal(USD_PEGGED.has("USDT0"), true);
  });

  it("usdAmount normalises the USDT / USDT0 split a naive sum would mix", () => {
    const usdt = { amount: "-63610000", currency: "USDT", decimals: 6 };
    const usdt0 = { amount: "214792305", currency: "USDT0", decimals: 6 };
    assert.equal(usdAmount({ amount: usdt }), -63.61);
    assert.equal(usdAmount({ amount: usdt0 }), 214.792305);
    // Both are USD, so they are summable; XPL is not and must not silently join in.
    assert.equal(usdAmount({ amount: xpl }), null);
  });

  it("localAmount / exchangeRate read the structured FX leg", () => {
    const tx = {
      amount: { amount: "-63610000", currency: "USDT", decimals: 6 },
      fx_details: { local_amount: { amount: "-54570000", currency: "EUR", decimals: 6 }, exchange_rate: 0.8578839805062097 },
    };
    assert.equal(formatMoney(localAmount(tx)), "-54.57");
    assert.equal(localAmount(tx).currency, "EUR");
    assert.equal(exchangeRate(tx), 0.8578839805062097);
    // Confirmed live: local_amount = amount * exchange_rate (local per settlement unit).
    assert.equal(+(usdAmount(tx) * exchangeRate(tx)).toFixed(2), parseMoney(localAmount(tx)));
  });

  it("localAmount / exchangeRate return null for a non-FX transaction", () => {
    assert.equal(localAmount({ amount: credit }), null);
    assert.equal(exchangeRate({ amount: credit }), null);
    assert.equal(localAmount({ fx_details: null }), null);
    assert.equal(exchangeRate({ fx_details: { exchange_rate: "0.85" } }), null); // string is not a rate
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
