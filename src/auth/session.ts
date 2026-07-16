import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A locally persisted Privy session.
 *
 * `accessToken` is the short-lived (~1h) bearer presented to the Plasma backend.
 * `refreshToken` is Privy's rotating refresh credential, kept so the SDK can renew the access
 * token without a fresh OTP (see EmailAuth.refresh). It is optional: a token-only session (or a
 * v1 file written before refresh support) simply has none, and renewal then requires a new OTP.
 */
export interface PlasmaSession {
  version: 2;
  accessToken: string;
  refreshToken?: string;
}

/** A file on disk may still be in the pre-refresh v1 shape (access token only). */
interface LegacySession {
  version: 1;
  accessToken: string;
}

/**
 * File-backed session storage for the caller's own machine.
 *
 * Both the access token and (when available) the rotating refresh token are stored, at file mode
 * 0600. The refresh token is what makes unattended renewal possible; treat the file as a secret.
 */
export class SessionStore {
  constructor(private readonly file: string) {}

  load(): PlasmaSession | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return undefined;
      const record = parsed as { version?: unknown; accessToken?: unknown; refreshToken?: unknown };
      if (typeof record.accessToken !== "string" || record.accessToken === "") return undefined;
      if (record.version === 2 || record.version === 1) {
        return {
          version: 2,
          accessToken: record.accessToken,
          refreshToken: typeof record.refreshToken === "string" && record.refreshToken !== ""
            ? record.refreshToken
            : undefined,
        };
      }
    } catch {
      // Treat a corrupt session as absent. Authentication will then require a new OTP.
    }
    return undefined;
  }

  save(session: PlasmaSession | LegacySession): void {
    const dir = dirname(this.file);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.file, JSON.stringify(session), { mode: 0o600 });
    // writeFile's mode is affected by an existing file and the process umask.
    chmodSync(this.file, 0o600);
  }

  clear(): void {
    // Do not unlink: overwriting avoids a separate existence race and leaves no token behind.
    if (existsSync(this.file)) writeFileSync(this.file, "", { mode: 0o600 });
  }
}
