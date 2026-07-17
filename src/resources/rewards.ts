import { DEFAULTS, ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type { CursorPage, RewardsBalance, SpendBonus, XplTransaction } from "../types.js";
import { expectCursorPage, expectObject } from "../validate.js";

export interface XplListParams {
  /** Page size. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/** XPL reward-token history, spend promotions, and accrued reward balances. */
export class Rewards {
  constructor(private readonly http: HttpClient) {}

  /**
   * The spend-and-get-back promotion, if one is running. `GET /v1/user/rewards/spend-bonus`
   *
   * Reconciliation note: a completed bonus is credited to `cash_balance` with **no
   * transaction** to explain it — confirmed live, where a completed $10 bonus left the
   * cash balance exactly $10 above the sum of every row in `transaction-history`. If you
   * are building a ledger from transactions, this endpoint is where that money comes from.
   */
  async spendBonus(): Promise<SpendBonus> {
    const r = await this.http.get<unknown>(ENDPOINTS.spendBonus);
    return expectObject(r, ENDPOINTS.spendBonus, "a spend-bonus object") as unknown as SpendBonus;
  }

  /** Accrued rewards awaiting payout. `GET /v1/user/rewards/balance` */
  async balance(): Promise<RewardsBalance> {
    const r = await this.http.get<unknown>(ENDPOINTS.rewardsBalance);
    return expectObject(r, ENDPOINTS.rewardsBalance, "a rewards balance object") as unknown as RewardsBalance;
  }

  /**
   * One page of XPL history. `GET /v1/user/rewards/xpl-transaction-history`
   *
   * Same cursor pagination as card transactions. Note XPL amounts carry `decimals: 18`, so read
   * them with `formatMoney` — `parseMoney` loses precision at that scale.
   */
  async xplTransactions(params: XplListParams = {}): Promise<CursorPage<XplTransaction>> {
    const r = await this.http.get<unknown>(ENDPOINTS.xplTransactionHistory, {
      limit: params.limit,
      cursor: params.cursor,
    });
    return expectCursorPage<XplTransaction>(r, ENDPOINTS.xplTransactionHistory, "an XPL transactions page");
  }

  /** Async-iterate every XPL record, following the cursor. De-duped by id; see Transactions.iterate. */
  async *iterateXplTransactions(params: Omit<XplListParams, "cursor"> = {}): AsyncGenerator<XplTransaction, void, unknown> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < DEFAULTS.maxPages; page++) {
      const res = await this.xplTransactions({ ...params, cursor });
      for (const tx of res.data) {
        if (tx.id != null && tx.id !== "") {
          if (seen.has(tx.id)) continue;
          seen.add(tx.id);
        }
        yield tx;
      }
      if (!res.has_more || !res.next_cursor) return;
      cursor = res.next_cursor;
    }
    throw new Error(`XPL pagination exceeded ${DEFAULTS.maxPages} pages — aborting to avoid a loop`);
  }
}
