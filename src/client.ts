import { HttpClient } from "./http.js";
import { Account } from "./resources/account.js";
import { Cards } from "./resources/cards.js";
import { Rewards } from "./resources/rewards.js";
import { Transactions } from "./resources/transactions.js";
import { EmailAuth } from "./auth/email.js";
import { SessionStore } from "./auth/session.js";

/**
 * How the client authenticates.
 *
 * There is only ONE mode, deliberately: a caller-supplied token. Plasma logs in through Privy,
 * which enforces native app attestation, so this SDK CANNOT perform login headlessly (see
 * docs/AUTH.md). You obtain a token from the real app by some external means and pass it here.
 */
export type PlasmaCardAuth =
  | {
      kind: "token";
      /** A caller-supplied Privy access token. Short-lived (~1h). */
      privyToken: string;
    }
  | {
      /** Email OTP through Privy's confirmed recovery.plasma.org web-origin flow. */
      kind: "email";
      email: string;
      /** Secure local file for the short-lived access token. Default: .plasma-session.json */
      sessionFile?: string;
    };

export interface PlasmaCardOptions {
  auth: PlasmaCardAuth;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Base backoff step in ms; grows exponentially with jitter. Default 500. */
  retryBaseMs?: number;
  /** Cap on a single backoff wait in ms, including a server's Retry-After. Default 8000. */
  retryMaxMs?: number;
  fetch?: typeof fetch;
}

/**
 * Client for the Plasma One card API.
 *
 * ⚠️ PRE-ALPHA. The email OTP path and headless token refresh are both confirmed live; response
 * models remain unverified. Access tokens last ~1h and are auto-renewed from the stored refresh
 * token on a 401 (and via `login.refresh()`), so unattended operation works. See docs/AUTH.md.
 *
 * ```ts
 * const pc = new PlasmaCard({ auth: { kind: "email", email: "you@example.com" } });
 * if (!pc.isAuthenticated()) {
 *   await pc.login.sendCode();
 *   await pc.login.verify("123456");
 * }
 * const cards = await pc.account.cards();
 * const txs = await pc.account.transactions();
 * ```
 */
export class PlasmaCard {
  readonly http: HttpClient;
  /** Profile, balances, funding accounts. */
  readonly account: Account;
  /** Cards and spending headroom. */
  readonly cards: Cards;
  /** Card transactions: page, iterate, or walk since a date. */
  readonly transactions: Transactions;
  /** XPL reward-token history. */
  readonly rewards: Rewards;
  private readonly auth: PlasmaCardAuth;
  private readonly email?: EmailAuth;

  constructor(opts: PlasmaCardOptions) {
    this.auth = opts.auth;
    const sessions = opts.auth.kind === "email"
      ? new SessionStore(opts.auth.sessionFile ?? ".plasma-session.json")
      : undefined;
    const restored = sessions?.load();
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      privyToken: opts.auth.kind === "token" ? opts.auth.privyToken : restored?.accessToken,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      retryBaseMs: opts.retryBaseMs,
      retryMaxMs: opts.retryMaxMs,
      fetch: opts.fetch,
    });
    if (opts.auth.kind === "email") {
      this.email = new EmailAuth(this.http, opts.fetch ?? globalThis.fetch, sessions!);
      // A 401 now auto-renews the access token from the stored refresh token, then replays once.
      this.http.setRefresher(() => this.email!.refresh());
    }
    this.account = new Account(this.http);
    this.cards = new Cards(this.http);
    this.transactions = new Transactions(this.http);
    this.rewards = new Rewards(this.http);
  }

  /** True when a caller-supplied or persisted access token is available. */
  isAuthenticated(): boolean {
    return this.http.hasToken();
  }

  /** Email-login helpers, available only in `auth: { kind: "email" }` mode. */
  get login() {
    const email = this.email;
    const address = this.auth.kind === "email" ? this.auth.email : "";
    return {
      sendCode: async (): Promise<void> => {
        if (!email) throw new Error("login is only available in email auth mode");
        await email.sendCode(address);
      },
      verify: async (code: string): Promise<void> => {
        if (!email) throw new Error("login is only available in email auth mode");
        await email.verifyCode(address, code);
      },
      /**
       * Renew the access token from the stored refresh token without an OTP (confirmed live).
       * Returns false when no refresh token is stored (log in again). Also runs automatically on
       * a 401; call it directly only to renew proactively. See docs/AUTH.md.
       */
      refresh: async (): Promise<boolean> => {
        if (!email) throw new Error("login is only available in email auth mode");
        return email.refresh();
      },
      clearLocalSession: (): void => {
        if (!email) throw new Error("login is only available in email auth mode");
        email.clearLocalSession();
      },
    };
  }
}
