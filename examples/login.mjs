/**
 * Establish or reuse a Plasma email-OTP session.
 *
 * First run:  PLASMA_EMAIL=you@example.com node examples/login.mjs
 * Then:       PLASMA_EMAIL=you@example.com PLASMA_OTP=123456 node examples/login.mjs
 *
 * Run `npm run build` first. The short-lived access token is written to
 * .plasma-session.json (mode 0600); no token is printed.
 */
import { PlasmaCard } from "../dist/index.js";

const email = process.env.PLASMA_EMAIL;
if (!email) {
  console.error("Set PLASMA_EMAIL to the email linked to your Plasma Privy identity.");
  process.exitCode = 2;
} else {
  const client = new PlasmaCard({ auth: { kind: "email", email } });
  if (!client.isAuthenticated()) {
    const code = process.env.PLASMA_OTP;
    if (!code) {
      await client.login.sendCode();
      console.log("OTP sent. Re-run with PLASMA_OTP set to the emailed code.");
    } else {
      await client.login.verify(code);
      console.log("Authenticated. Session saved locally.");
    }
  } else {
    console.log("A local access token is available. It is short-lived; request a new OTP after it expires.");
  }
}
