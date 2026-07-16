import { ENDPOINTS } from "../constants.js";
import type { HttpClient } from "../http.js";
import type { Card, CardLeftToSpend } from "../types.js";
import { expectList, expectObject } from "../validate.js";

/** Cards and their spending headroom. */
export class Cards {
  constructor(private readonly http: HttpClient) {}

  /** List the user's cards. `GET /v1/user/cards` — returns a bare JSON array. */
  async list(): Promise<Card[]> {
    const r = await this.http.get<unknown>(ENDPOINTS.cards);
    return expectList<Card>(r, ENDPOINTS.cards, "a cards list");
  }

  /**
   * Remaining headroom against this card's LIMIT. `GET /v1/user/card/left-to-spend?card_id=`
   *
   * **Not a balance.** It is the card's periodic limit less the spend already booked against it,
   * and is unrelated to the money in the account — see {@link CardLeftToSpend}. For funds, call
   * `Account.balance()`.
   *
   * The card id is required — the endpoint answers 400 CARD_ID_REQUIRED without it.
   */
  async leftToSpend(cardId: string): Promise<CardLeftToSpend> {
    const r = await this.http.get<unknown>(ENDPOINTS.cardLeftToSpend, { card_id: cardId });
    return expectObject(r, ENDPOINTS.cardLeftToSpend, "a left-to-spend object") as unknown as CardLeftToSpend;
  }
}
