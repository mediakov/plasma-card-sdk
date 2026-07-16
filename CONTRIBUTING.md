# Contributing

Thanks for helping improve plasma-card-sdk!

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # builds, then runs node:test against dist/ (mocked fetch, no live calls)
npm run build       # tsup → dual ESM/CJS + .d.ts
```

- Source is TypeScript in `src/`. Tests are in `test/` (`node:test`, `.mjs`) and
  import from `dist/` on purpose: that is what consumers actually get.
- Tests must **not** make live network calls — pass a mock `fetch` through the
  client options.
- Every public method gets JSDoc.

## The one rule that matters: observe, don't infer

The response models in `src/types.ts` were rebuilt from **real captured
responses**, because the first version — inferred from static analysis of the app
— was wrong in four load-bearing ways at once (camelCase vs the API's snake_case,
money as a scalar vs an object of signed minor units, ISO vs epoch-millisecond
timestamps, and a bare array vs a cursor page). Two of those silently produced
wrong data rather than an error.

So: if you change a type, say what you observed. A field you have not seen stays
optional, and an enum you have not seen stays inside `Open<>`. The models still
reflect a single account, so unusual states are unverified guesses.

Read money and dates through `money.ts` (`parseMoney`, `formatMoney`,
`usdAmount`, `transactionDate`). They return `null` for a record they cannot read
honestly — never zero, never a guess.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) and
[semantic-release](https://semantic-release.gitbook.io/): the commit history
decides the next version, the changelog, and the npm publish. Examples:

- `feat: add cards.freeze()` → minor
- `fix(http): cap Retry-After` → patch
- `feat!: rename PlasmaCard.login.verify` (or a `BREAKING CHANGE:` footer) →
  minor while we are in 0.x (see `.releaserc.json`)

## Releasing

Pushing to `main` runs `release.yml`, which publishes via npm **trusted
publishing** (OIDC). There is deliberately no `NPM_TOKEN` anywhere: a long-lived,
2FA-bypassing token in CI is the npm supply-chain vector we are avoiding.
