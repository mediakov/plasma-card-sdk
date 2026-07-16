import { DEFAULTS, ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import { transactionDate } from "../money.js";
import type { CursorPage, Transaction } from "../types.js";
import { expectCursorPage } from "../validate.js";

export interface TransactionListParams {
  /** Include tiny on-chain dust receives. Confirmed live. */
  includeDustReceives?: boolean;
  /** Page size. Confirmed live. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. Confirmed live. */
  cursor?: string;
}

/** Params for a walk that manages the cursor itself. */
export type TransactionWalkParams = Omit<TransactionListParams, "cursor">;

/** Card transactions: a single page, or a full cursor-followed walk. */
export class Transactions {
  constructor(private readonly http: HttpClient) {}

  /**
   * One page of transactions, newest first. `GET /v1/transaction-history`
   *
   * Page with `{ limit, cursor }`; prefer {@link iterate} unless you are driving paging yourself.
   */
  async list(params: TransactionListParams = {}): Promise<CursorPage<Transaction>> {
    const r = await this.http.get<unknown>(ENDPOINTS.transactionHistory, {
      includeDustReceives: params.includeDustReceives,
      limit: params.limit,
      cursor: params.cursor,
    });
    return expectCursorPage<Transaction>(r, ENDPOINTS.transactionHistory, "a transactions page");
  }

  /**
   * Async-iterate every transaction, following `next_cursor` until `has_more` is false.
   *
   * Yields each transaction **at most once**. `next_cursor` is timestamp-based, so two records
   * sharing a timestamp can straddle a page boundary and be served on both pages; uncorrected
   * that double-counts them in whatever you are building. De-duped by id.
   *
   * Never stops on page length alone — the Jupiter lesson: the API guarantees no ordering, so
   * only `has_more`/`next_cursor` may end the walk. Exceeding `maxPages` throws rather than
   * returning quietly: a truncated history that looks complete is the failure worth avoiding.
   *
   * ```ts
   * for await (const tx of client.transactions.iterate({ includeDustReceives: true })) {
   *   console.log(tx.id, signedAmount(tx));
   * }
   * ```
   */
  async *iterate(params: TransactionWalkParams = {}): AsyncGenerator<Transaction, void, unknown> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < DEFAULTS.maxPages; page++) {
      const res = await this.list({ ...params, cursor });
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
    throw new Error(`transaction pagination exceeded ${DEFAULTS.maxPages} pages — aborting to avoid a loop`);
  }

  /** Collect every transaction into an array. Convenience over {@link iterate}. */
  async all(params: TransactionWalkParams = {}): Promise<Transaction[]> {
    const out: Transaction[] = [];
    for await (const tx of this.iterate(params)) out.push(tx);
    return out;
  }

  /**
   * Every transaction at or after `from` — the incremental-sync entry point.
   *
   * Walks EVERY page and compares each record's own timestamp, rather than stopping at the first
   * page that ends before `from`. That shortcut would be cheaper and would silently truncate the
   * history behind a single out-of-order row; the API promises no ordering. Do not add it.
   *
   * Records whose timestamp is unreadable are yielded rather than dropped — the SDK does not
   * decide what is worth keeping. Filter with `isBookable` if you need to.
   */
  async *since(from: Date, params: TransactionWalkParams = {}): AsyncGenerator<Transaction, void, unknown> {
    if (Number.isNaN(from.getTime())) throw new RangeError("transactions.since(from): `from` is not a valid Date");
    for await (const tx of this.iterate(params)) {
      const at = transactionDate(tx);
      // An unreadable timestamp cannot be compared to `from`; hiding it would lose the record.
      if (at != null && at < from) continue;
      yield tx;
    }
  }
}
