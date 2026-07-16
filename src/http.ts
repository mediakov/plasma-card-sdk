import { AUTH_SCHEME, DEFAULTS, DEFAULT_UA, PLASMA_BASE, PRIVY_APP_ID } from "./constants.js";
import { NetworkError, TimeoutError, ValidationError, apiErrorFor } from "./errors.js";
import { describe, isRecord } from "./validate.js";

export interface HttpOptions {
  baseUrl?: string;
  /** Privy token presented to the Plasma backend (see docs/AUTH.md). */
  privyToken?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Base backoff step in ms; grows exponentially with jitter. Default 500. */
  retryBaseMs?: number;
  /** Cap on a single backoff wait in ms, including a server's Retry-After. Default 8000. */
  retryMaxMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Retry policy override; default retries idempotent methods only. */
  retry?: boolean;
  signal?: AbortSignal;
}

export const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Renews the access token and returns true when a fresh one is now in place, false when renewal
 * is not possible (no refresh token). Set via {@link HttpClient.setRefresher}; a thrown error
 * (e.g. an expired refresh token) propagates to the caller as the original auth failure.
 */
export type Refresher = () => Promise<boolean>;

/**
 * Minimal fetch wrapper: browser-ish headers, the Privy auth header, timeout, and retry with
 * backoff on idempotent requests only (never replay a non-idempotent POST — the Jupiter lesson).
 * When a refresher is installed (email auth mode), a single 401 triggers one token renewal and
 * one replay; without it, a 401 surfaces immediately as before.
 */
export class HttpClient {
  private readonly base: string;
  private privyToken?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly fetchImpl: typeof fetch;
  private refresher?: Refresher;

  constructor(opts: HttpOptions = {}) {
    this.base = opts.baseUrl ?? PLASMA_BASE;
    this.privyToken = opts.privyToken;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
    this.retryBaseMs = opts.retryBaseMs ?? DEFAULTS.retryBaseMs;
    this.retryMaxMs = opts.retryMaxMs ?? DEFAULTS.retryMaxMs;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /** True when an access token is available for authenticated Plasma requests. */
  hasToken(): boolean {
    return this.privyToken !== undefined && this.privyToken !== "";
  }

  /**
   * Replace the bearer token used for subsequent API requests.
   *
   * This is used after a successful Privy OTP verification. Tokens are never
   * logged by this client.
   */
  setToken(token: string): void {
    if (token.trim() === "") throw new TypeError("Privy access token must not be empty");
    this.privyToken = token;
  }

  /** Remove the in-memory bearer token. */
  clearToken(): void {
    this.privyToken = undefined;
  }

  /**
   * Install a callback that renews the access token when a request is rejected with 401.
   * The renewed token is read back from {@link setToken}, which the refresher is expected to call.
   */
  setRefresher(refresher: Refresher): void {
    this.refresher = refresher;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "user-agent": DEFAULT_UA,
      "privy-app-id": PRIVY_APP_ID,
      ...extra,
    };
    // Confirmed by a live 401: the backend checks a standard Authorization header.
    if (this.privyToken) h["authorization"] = `${AUTH_SCHEME} ${this.privyToken}`;
    return h;
  }

  private mayRetry(method: string, opts: RequestOptions): boolean {
    return opts.retry ?? IDEMPOTENT_METHODS.has(method.toUpperCase());
  }

  /**
   * How long to wait before re-sending a failed attempt.
   *
   * Jittered (50–100% of the exponential step) so that N clients failing on the same upstream
   * blip do not all retry on the same tick and reproduce the spike that broke it.
   *
   * A server-supplied `Retry-After` wins, but is CAPPED at `retryMaxMs`: it is an untrusted
   * number, and honouring it literally lets a `Retry-After: 3600` park the process for an hour
   * — per attempt. The cap keeps a slow retry from becoming an indefinite hang; a caller who
   * needs to respect a long backoff can catch RateLimitError, which still carries the real value.
   */
  private backoff(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, this.retryMaxMs);
    const exp = this.retryBaseMs * 2 ** attempt;
    const jitter = exp * (0.5 + Math.random() * 0.5);
    return Math.min(jitter, this.retryMaxMs);
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const retryable = this.mayRetry(method, opts);
    const headers = this.headers(opts.headers);
    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    // A 401 gets at most one refresh + replay, regardless of how many normal retries run.
    let refreshAttempted = false;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: payload, signal: opts.signal ?? AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        // A network error leaves the request's fate unknown — it may well have reached the
        // server. Only replay it when replaying is harmless.
        if (retryable && attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw isTimeout
          ? new TimeoutError(`Request to ${url} timed out after ${this.timeoutMs}ms`, { cause: e })
          : new NetworkError(`Network error for ${url}: ${(e as Error).message}`, { cause: e });
      }

      // Retryable statuses — but only for a request that is safe to send twice. A non-retryable
      // 429 still surfaces as RateLimitError carrying retryAfterMs, so the caller can decide;
      // the SDK just refuses to decide for them.
      if ((res.status === 429 || res.status >= 500) && retryable && attempt < this.maxRetries) {
        const ra = res.headers.get("retry-after");
        // Retry-After may also be an HTTP-date, which is not a number — fall back to backoff.
        const retryAfterMs = ra && !Number.isNaN(Number(ra)) ? Number(ra) * 1000 : undefined;
        await sleep(this.backoff(attempt, retryAfterMs));
        continue;
      }

      // Expired access token: renew once and replay with the fresh bearer. If the refresh itself
      // fails (expired/rotated refresh token), fall through to surface the original 401 on the
      // endpoint the caller actually asked for — recovery from there is a new OTP.
      if (res.status === 401 && this.refresher && !refreshAttempted) {
        refreshAttempted = true;
        const renewed = await this.refresher().catch(() => false);
        if (renewed) {
          if (this.privyToken) headers["authorization"] = `${AUTH_SCHEME} ${this.privyToken}`;
          attempt--; // the replay is not one of the backoff retries
          continue;
        }
      }

      const text = await res.text();
      if (!res.ok) {
        const ra = res.headers.get("retry-after");
        throw apiErrorFor(res.status, url.toString(), text, ra ? Number(ra) * 1000 : undefined);
      }
      if (!text) return undefined as T;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ValidationError(url.toString(), "a JSON body", describe(text));
      }
      // Every Plasma response is enveloped: {success, data, errors, …}. Unwrap to `data`.
      // A 2xx with success:false is still a failure — surface it rather than return junk.
      if (isRecord(parsed) && "success" in parsed) {
        if (parsed.success === false) {
          throw apiErrorFor(typeof parsed.status_code === "number" ? parsed.status_code : res.status, url.toString(), text);
        }
        return parsed.data as T;
      }
      return parsed as T;
    }
  }

  get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>("GET", path, { query });
  }
}
