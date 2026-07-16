# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories
("Report a vulnerability" on the Security tab) rather than opening a public
issue. We'll respond as quickly as we can.

## Handling credentials

- The session file (`.plasma-session.json` by default) holds a Privy **access
  token and refresh token** — treat it like a password. It is created `0600` and
  is gitignored. Do not commit or share it.
- The refresh token is the more dangerous of the two. The access token expires in
  60 minutes, but the refresh token **renews itself on every use**, so a leaked
  session file is long-lived access to the account, not a one-hour window. If one
  leaks, log in again from the app to invalidate the session.
- Never paste tokens into issues, PRs, logs, or test fixtures. Every fixture in
  `test/` is synthetic for this reason, and errors thrown by this SDK describe a
  response body by shape and size rather than echoing its contents.

## Scope & disclaimer

This is an **unofficial** SDK. It talks to Plasma One's private account API, is
not endorsed by Plasma or by Rain (the card issuer), and may break when that API
changes — the response models were observed from live traffic, not published
docs. Use it only with your own account and in accordance with Plasma's terms of
service.
