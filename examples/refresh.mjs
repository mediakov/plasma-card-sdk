/**
 * Verify — live — that the access token can be refreshed WITHOUT a new OTP.
 *
 * Confirmed working 2026-07-16: Privy's web-origin session-refresh
 * (`POST https://auth.privy.io/api/v1/sessions` with the rotating refresh token + current bearer)
 * renews the token headlessly for a linked email account, so an unattended Plasma syncer is
 * feasible. Keep this as a re-check (e.g. after a Privy change). Nothing is printed except
 * pass/fail; no token is shown.
 *
 * Prerequisites:
 *   1. npm run build
 *   2. A FRESH login so the refresh token is on disk (older sessions predate refresh support):
 *        PLASMA_EMAIL=you@example.com node examples/login.mjs           # sends OTP
 *        PLASMA_EMAIL=you@example.com PLASMA_OTP=123456 node examples/login.mjs
 *
 * Then:
 *        PLASMA_EMAIL=you@example.com node examples/refresh.mjs
 *
 * What it does: forces a refresh from the stored refresh token, then calls GET /v1/user with the
 * renewed bearer. A 200 means web-origin refresh works headlessly. Report the outcome so
 * docs/AUTH.md can move from "unverified" to "confirmed" (or be corrected).
 */
import { PlasmaCard, AuthError } from "../dist/index.js";

const email = process.env.PLASMA_EMAIL;
if (!email) {
  console.error("Set PLASMA_EMAIL to the email linked to your Plasma Privy identity.");
  process.exitCode = 2;
} else {
  const client = new PlasmaCard({ auth: { kind: "email", email } });
  if (!client.isAuthenticated()) {
    console.error("No local session. Run examples/login.mjs first (a fresh login, to store a refresh token).");
    process.exitCode = 2;
  } else {
    try {
      const renewed = await client.login.refresh();
      if (!renewed) {
        console.error("No refresh token stored. Log in again — sessions created before refresh support have none.");
        process.exitCode = 1;
      } else {
        // If refresh returned a working token, this authenticated read succeeds.
        const user = await client.account.user();
        console.log(`PASS: refreshed the access token and read /v1/user (id present: ${Boolean(user?.id)}).`);
        console.log("Web-origin refresh works headlessly for this account.");
      }
    } catch (err) {
      if (err instanceof AuthError) {
        console.error(`FAIL: refresh was rejected (HTTP ${err.status}${err.code ? ` ${err.code}` : ""}).`);
        console.error("Likely the request shape differs from Privy's documented web protocol, or web-origin");
        console.error("refresh is attested for this account. The response body (no secrets) helps pin it down:");
        console.error(err.body?.slice(0, 400));
      } else {
        console.error(`FAIL: ${err?.message ?? err}`);
      }
      process.exitCode = 1;
    }
  }
}
