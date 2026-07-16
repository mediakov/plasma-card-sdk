/**
 * The boundary between "bytes the server sent" and "values the types promise" — same rationale
 * as jupiter-card-sdk/validate.ts. Casting an unchecked body makes TypeScript vouch for it and
 * the failure surfaces far downstream. These check structure only and throw ValidationError.
 *
 * Describes a value by shape and size for error messages — never its contents (these get logged).
 */
import { ValidationError } from "./errors.js";

export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} items)`;
  if (typeof value === "string") {
    const kind = value.trimStart().startsWith("<") ? "an HTML/text page" : "a non-JSON string";
    return `${kind} (${value.length} bytes)`;
  }
  return `a ${typeof value}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectObject(value: unknown, url: string, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(url, what, describe(value));
  return value;
}

/** A bare list payload (e.g. /v1/user/cards returns a JSON array). */
export function expectList<T>(value: unknown, url: string, what: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isRecord(value) && Array.isArray(value.data)) return value.data as T[];
  throw new ValidationError(url, what, describe(value));
}

/**
 * A cursor-paginated payload, confirmed shape `{ data: [], next_cursor, has_more }`. Validates the
 * `data` array (the load-bearing part) and passes the cursor fields through untouched.
 */
export function expectCursorPage<T>(value: unknown, url: string, what: string): {
  data: T[];
  next_cursor?: string | null;
  has_more?: boolean;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new ValidationError(url, what, describe(value));
  return value as { data: T[]; next_cursor?: string | null; has_more?: boolean };
}
