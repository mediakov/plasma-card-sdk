import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

  /**
   * Persist the session atomically and durably.
   *
   * This matters more than it looks. Privy BURNS the old refresh token the moment it issues a new
   * one, so the rotated token on its way to this file is the only thing standing between an
   * unattended syncer and a manual OTP. A plain writeFileSync can be interrupted half-written,
   * leaving a truncated file that parses as no session at all — the old token already dead, the
   * new one never landed.
   *
   * So: write a temp file alongside the target (rename is only atomic within one filesystem),
   * fsync it so the bytes are really on disk, then rename over the target. A crash at any point
   * leaves either the complete old session or the complete new one, never a torn file.
   */
  save(session: PlasmaSession | LegacySession): void {
    const dir = dirname(this.file);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(session));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // openSync's mode is subject to the umask; make the private mode explicit before it lands.
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (e) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* nothing more we can do about the temp file */
      }
      throw e;
    }
    // Without this the rename itself can be lost in a crash, even though the data was fsynced.
    // Not every platform/filesystem permits it, so it is best-effort.
    try {
      const dfd = openSync(dir || ".", "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    } catch {
      /* directory fsync unsupported here */
    }
  }

  clear(): void {
    // Do not unlink: overwriting avoids a separate existence race and leaves no token behind.
    if (existsSync(this.file)) writeFileSync(this.file, "", { mode: 0o600 });
  }
}
