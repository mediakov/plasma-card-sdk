import { DEFAULTS, ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type { CursorPage, XplTransaction } from "../types.js";
import { expectCursorPage } from "../validate.js";

export interface XplListParams {
  /** Page size. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/** XPL reward-token history (tier upgrades, rewards). */
export class Rewards {
  constructor(private readonly http: HttpClient) {}

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
