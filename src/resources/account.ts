import { ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type { AccountList, Balance, TokenBalances, User } from "../types.js";
import { expectObject } from "../validate.js";

/** Profile, balances, and funding accounts. */
export class Account {
  constructor(private readonly http: HttpClient) {}

  /** The authenticated user's profile. `GET /v1/user` */
  async user(): Promise<User> {
    const r = await this.http.get<unknown>(ENDPOINTS.user);
    return expectObject(r, ENDPOINTS.user, "a user object") as unknown as User;
  }

  /**
   * Account balances. `GET /v1/user/balance`
   *
   * Flat object: each `*_balance` is a minor-units integer string scaled by one shared `decimals`.
   */
  async balance(): Promise<Balance> {
    const r = await this.http.get<unknown>(ENDPOINTS.balance);
    return expectObject(r, ENDPOINTS.balance, "a balance object") as unknown as Balance;
  }

  /** Per-asset token balances (XPL etc.), each a full Money object. `GET /v1/user/token-balances` */
  async tokenBalances(): Promise<TokenBalances> {
    const r = await this.http.get<unknown>(ENDPOINTS.tokenBalances);
    return expectObject(r, ENDPOINTS.tokenBalances, "a token-balances object") as unknown as TokenBalances;
  }

  /** Virtual (deposit) accounts. `GET /v1/user/virtual-accounts` */
  async virtualAccounts(): Promise<AccountList> {
    const r = await this.http.get<unknown>(ENDPOINTS.virtualAccounts);
    return expectObject(r, ENDPOINTS.virtualAccounts, "an accounts object") as unknown as AccountList;
  }

  /** Linked external (bank) accounts. `GET /v1/user/external-accounts` */
  async externalAccounts(): Promise<AccountList> {
    const r = await this.http.get<unknown>(ENDPOINTS.externalAccounts);
    return expectObject(r, ENDPOINTS.externalAccounts, "an accounts object") as unknown as AccountList;
  }
}
