/**
 * Error hierarchy — mirrors jupiter-card-sdk. Everything thrown for a failed request derives
 * from PlasmaError.
 */
export class PlasmaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A non-2xx HTTP response. */
export class ApiError extends PlasmaError {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
    public readonly code?: string,
    options?: { cause?: unknown },
  ) {
    super(`HTTP ${status}${code ? ` (${code})` : ""} for ${url}: ${body.slice(0, 300)}`, options);
  }
}

/** 401/403 — token missing, invalid, expired, or blocked by attestation. */
export class AuthError extends ApiError {}

/** 429 — rate limited. */
export class RateLimitError extends ApiError {
  constructor(status: number, url: string, body: string, code: string | undefined, public readonly retryAfterMs?: number) {
    super(status, url, body, code);
  }
}

/** The response was not the shape the endpoint promises (e.g. an HTML challenge page). Fatal. */
export class ValidationError extends PlasmaError {
  constructor(public readonly url: string, public readonly expected: string, public readonly received: string) {
    super(`Unexpected response from ${url}: expected ${expected}, got ${received}`);
  }
}

export class NetworkError extends PlasmaError {}
export class TimeoutError extends NetworkError {}

export function apiErrorFor(status: number, url: string, body: string, retryAfterMs?: number): ApiError {
  let code: string | undefined;
  try {
    const j = JSON.parse(body);
    // Plasma envelope: errors:[{error_code, message}]. Fall back to flatter shapes.
    const first = Array.isArray(j?.errors) ? j.errors[0] : undefined;
    code = first?.error_code ?? first?.code ?? j?.code ?? j?.error ?? j?.type;
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return new AuthError(status, url, body, code);
  if (status === 429) return new RateLimitError(status, url, body, code, retryAfterMs);
  return new ApiError(status, url, body, code);
}
