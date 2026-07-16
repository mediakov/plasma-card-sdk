import { DEFAULTS, ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type {
  AccountList,
  CardLeftToSpend,
  CursorPage,
  PlasmaBalance,
  PlasmaCard,
  PlasmaTransaction,
  PlasmaUser,
  TokenBalances,
  XplTransaction,
} from "../types.js";
import { expectCursorPage, expectList, expectObject } from "../validate.js";

export interface TransactionListParams {
  /** Include tiny on-chain dust receives. Confirmed live. */
  includeDustReceives?: boolean;
  /** Page size. Confirmed live. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. Confirmed live. */
  cursor?: string;
}

/**
 * Read-side resources for a ZenMoney syncer. Every method hits a GET endpoint and response shape
 * confirmed against live traffic (2026-07-16). Validation is structural (object / list / page);
 * the field types live in types.ts.
 */
export class PlasmaAccount {
  constructor(private readonly http: HttpClient) {}

  async user(): Promise<PlasmaUser> {
    const r = await this.http.get<unknown>(ENDPOINTS.user);
    return expectObject(r, ENDPOINTS.user, "a user object") as unknown as PlasmaUser;
  }

  async cards(): Promise<PlasmaCard[]> {
    const r = await this.http.get<unknown>(ENDPOINTS.cards);
    return expectList<PlasmaCard>(r, ENDPOINTS.cards, "a cards list");
  }

  async balance(): Promise<PlasmaBalance> {
    const r = await this.http.get<unknown>(ENDPOINTS.balance);
    return expectObject(r, ENDPOINTS.balance, "a balance object") as unknown as PlasmaBalance;
  }

  async tokenBalances(): Promise<TokenBalances> {
    const r = await this.http.get<unknown>(ENDPOINTS.tokenBalances);
    return expectObject(r, ENDPOINTS.tokenBalances, "a token-balances object") as unknown as TokenBalances;
  }

  async virtualAccounts(): Promise<AccountList> {
    const r = await this.http.get<unknown>(ENDPOINTS.virtualAccounts);
    return expectObject(r, ENDPOINTS.virtualAccounts, "an accounts object") as unknown as AccountList;
  }

  async externalAccounts(): Promise<AccountList> {
    const r = await this.http.get<unknown>(ENDPOINTS.externalAccounts);
    return expectObject(r, ENDPOINTS.externalAccounts, "an accounts object") as unknown as AccountList;
  }

  /** Remaining spend for one card against its limits. Requires the card id (400 CARD_ID_REQUIRED otherwise). */
  async cardLeftToSpend(cardId: string): Promise<CardLeftToSpend> {
    const r = await this.http.get<unknown>(ENDPOINTS.cardLeftToSpend, { card_id: cardId });
    return expectObject(r, ENDPOINTS.cardLeftToSpend, "a left-to-spend object") as unknown as CardLeftToSpend;
  }

  /** One page of card transactions, newest first. Use `iterateTransactions` to walk them all. */
  async transactions(params: TransactionListParams = {}): Promise<CursorPage<PlasmaTransaction>> {
    const r = await this.http.get<unknown>(ENDPOINTS.transactionHistory, {
      includeDustReceives: params.includeDustReceives,
      limit: params.limit,
      cursor: params.cursor,
    });
    return expectCursorPage<PlasmaTransaction>(r, ENDPOINTS.transactionHistory, "a transactions page");
  }

  /**
   * Every card transaction, oldest-page-boundary agnostic, following `next_cursor` until
   * `has_more` is false. Never stops on page length alone — the Jupiter lesson: pagination has no
   * ordering guarantee, so only `has_more`/`next_cursor` may end the walk. `maxPages` is a runaway
   * backstop, not a limit you should rely on to bound real history.
   */
  async *iterateTransactions(
    params: Omit<TransactionListParams, "cursor"> = {},
  ): AsyncGenerator<PlasmaTransaction, void, unknown> {
    let cursor: string | undefined;
    for (let page = 0; page < DEFAULTS.maxPages; page++) {
      const res = await this.transactions({ ...params, cursor });
      for (const tx of res.data) yield tx;
      if (!res.has_more || !res.next_cursor) return;
      cursor = res.next_cursor;
    }
    throw new Error(`transaction pagination exceeded ${DEFAULTS.maxPages} pages — aborting to avoid a loop`);
  }

  /** One page of XPL reward-token history (tier upgrades, rewards). Same cursor pagination. */
  async xplTransactions(params: TransactionListParams = {}): Promise<CursorPage<XplTransaction>> {
    const r = await this.http.get<unknown>(ENDPOINTS.xplTransactionHistory, {
      limit: params.limit,
      cursor: params.cursor,
    });
    return expectCursorPage<XplTransaction>(r, ENDPOINTS.xplTransactionHistory, "an XPL transactions page");
  }
}
