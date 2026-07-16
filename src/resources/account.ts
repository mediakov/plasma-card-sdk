import { ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type { PlasmaBalance, PlasmaCard, PlasmaTransaction, PlasmaUser, Paginated } from "../types.js";
import { expectList, expectObject } from "../validate.js";

export interface TransactionListParams {
  /** The one confirmed param from static analysis; others (limit/cursor) unknown until observed. */
  includeDustReceives?: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * Read-side resources for a ZenMoney syncer. Every method here hits a GET endpoint recovered
 * statically (docs/ENDPOINTS.md). The RESPONSE shapes are unverified (see types.ts) — the
 * validation is structural only (is it an object / a list), because we have not seen real bodies.
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

  /**
   * One page of card transactions. The HTTP layer already unwrapped the Plasma envelope, so `r`
   * is the `data` payload. Whether that payload is a bare array or a `{data,meta}` page is still
   * unknown — confirm against real traffic; `expectList` accepts either for now.
   */
  async transactions(params: TransactionListParams = {}): Promise<Paginated<PlasmaTransaction>> {
    const r = await this.http.get<unknown>(ENDPOINTS.transactionHistory, {
      includeDustReceives: params.includeDustReceives,
      limit: params.limit,
      cursor: params.cursor,
    });
    const list = expectList<PlasmaTransaction>(r, ENDPOINTS.transactionHistory, "a transactions list");
    return Array.isArray(r) ? { data: list } : (r as Paginated<PlasmaTransaction>);
  }
}
