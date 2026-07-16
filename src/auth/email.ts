import { PRIVY_APP_ID } from "../constants.js";
import { AuthError, ValidationError } from "../errors.js";
import type { HttpClient } from "../http.js";
import { SessionStore } from "./session.js";

const ORIGIN = "https://recovery.plasma.org";
const PRIVY_BASE = "https://auth.privy.io/api/v1";
const PASSWORDLESS = `${PRIVY_BASE}/passwordless`;
// Privy renews a session by POSTing the rotating refresh token here. Recovered from the app
// bundle (the `sessions` family, `refreshSession`); the exact request/response is confirmed by
// docs/AUTH.md's live check, not by this code. Same web-origin client mode as login.
const SESSIONS = `${PRIVY_BASE}/sessions`;

interface PrivyTokenResponse {
  token?: unknown;
  privy_access_token?: unknown;
  refresh_token?: unknown;
}

/** The credentials distilled from a Privy authenticate/refresh response. */
interface PrivyTokens {
  accessToken: string;
  refreshToken?: string;
}

/** Privy's confirmed origin-gated email OTP flow for the Plasma app ID, plus token refresh. */
export class EmailAuth {
  /** De-dupes concurrent refreshes so a burst of 401s triggers a single network renewal. */
  private inFlightRefresh?: Promise<boolean>;

  constructor(
    private readonly http: HttpClient,
    private readonly fetchImpl: typeof fetch,
    private readonly sessions: SessionStore,
  ) {}

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      origin: ORIGIN,
      "privy-app-id": PRIVY_APP_ID,
      // Absence of privy-client-id intentionally selects Privy's web-origin mode.
      "privy-client": "react-auth:2.13.0",
    };
  }

  private async post(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { ...this.headers(), ...extraHeaders },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new AuthError(0, url, "Privy authentication request failed", "NETWORK", { cause });
    }
    const text = await response.text();
    if (!response.ok) throw new AuthError(response.status, url, text);
    try {
      return JSON.parse(text);
    } catch {
      throw new ValidationError(url, "a JSON authentication response", `${text.length} non-JSON bytes`);
    }
  }

  /**
   * Extract the access token (and rotating refresh token, when present) from a Privy response.
   * `token` was confirmed live as the credential Plasma accepts; `privy_access_token` is kept only
   * for a compatible Privy response variation.
   */
  private tokensFrom(body: PrivyTokenResponse, url: string): PrivyTokens {
    const accessToken = typeof body.token === "string"
      ? body.token
      : typeof body.privy_access_token === "string" ? body.privy_access_token : undefined;
    if (!accessToken) throw new AuthError(401, url, "Privy response contained no access token");
    return {
      accessToken,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token !== ""
        ? body.refresh_token
        : undefined,
    };
  }

  private persist(tokens: PrivyTokens): void {
    this.http.setToken(tokens.accessToken);
    this.sessions.save({ version: 2, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }

  /** Request an email one-time code. This POST is never retried. */
  async sendCode(email: string): Promise<void> {
    await this.post(`${PASSWORDLESS}/init`, { email });
  }

  /** Verify an email one-time code and persist the returned access + refresh tokens. */
  async verifyCode(email: string, code: string): Promise<void> {
    const body = await this.post(`${PASSWORDLESS}/authenticate`, { email, code }) as PrivyTokenResponse;
    this.persist(this.tokensFrom(body, `${PASSWORDLESS}/authenticate`));
  }

  /**
   * Renew the access token using the stored refresh token, without an OTP.
   *
   * De-duped: concurrent callers share one network round-trip. Returns `true` when a fresh token
   * was obtained and persisted, `false` when there is no refresh token to use. A refresh that is
   * actively rejected by Privy (expired/rotated-away refresh token) throws AuthError, since the
   * only recovery is a new OTP. On success the rotated refresh token replaces the old one.
   */
  async refresh(): Promise<boolean> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    const stored = this.sessions.load();
    if (!stored?.refreshToken) return false;
    const refreshToken = stored.refreshToken;
    // Privy's /sessions refresh pairs the refresh token with the current (even expired) access
    // token — confirmed live: omitting it returns 400 {"code":"missing_or_invalid_token"}.
    const accessToken = stored.accessToken;
    this.inFlightRefresh = (async () => {
      const body = await this.post(
        SESSIONS,
        { refresh_token: refreshToken },
        { authorization: `Bearer ${accessToken}` },
      ) as PrivyTokenResponse;
      const tokens = this.tokensFrom(body, SESSIONS);
      // Privy rotates the refresh token on use; keep the new one, but never regress to no token.
      this.persist({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? refreshToken });
      return true;
    })();
    try {
      return await this.inFlightRefresh;
    } finally {
      this.inFlightRefresh = undefined;
    }
  }

  /** Remove the locally stored tokens. This does not revoke the Privy session server-side. */
  clearLocalSession(): void {
    this.sessions.clear();
    this.http.clearToken();
  }
}
