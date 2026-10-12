# WizardGang Architecture Demo

Live, executable architecture demonstrations on Cloudflare Workers, served at `https://demo.wizardgang.ai` from `Wizard-Gang/wizardgang-architecture-demo`.

## Public routes

- `/` — orientation and live proof: service state, availability and the running version.
- `/demos` — the demonstrations: D1 and R2; REST/OpenAPI and GraphQL; signed webhooks and the live Git delivery feed; OAuth 2.0, SSO and SAML; MCP; Edge, Workers and Durable Objects; accessibility and internationalization.

`/admin` is the protected operator page and `/offline` the recovery page. Machine contracts live under `/api/*`, `/auth/*`, `/graphql`, `/mcp` and `/webhooks/*`. Routes are declared once under `src/routing/`; navigation, sitemap, canonical links and the generated [`src/generated/route-manifest.json`](src/generated/route-manifest.json) are projections of those declarations.

## Invariants

- Shared state uses baseline's `wizardgang` D1 `records`/`events` tables through `WG_DB`, with per-row TTLs and no demo-owned DDL.
- R2 stores object bytes under `demo/` in the shared `wizardgang` bucket (`WG_R2`); D1 records hold metadata and references.
- Durable Objects own coordinated state; Workers mediate application state and integrations.
- Public REST, GraphQL and MCP reads share one explicit authorization boundary.
- Secrets, credentials, private account metadata and real billing data never belong in Git or public logs.

## Local setup

1. Use Node.js 26.10.0 from `.node-version` and npm 12.1.0 from `packageManager`, then run `npm ci`.
2. Copy `.dev.vars.example` to ignored `.dev.vars`, replace the placeholders and seed the local Secrets Store `WG_SESSION_KEY` as the example shows.
3. Run `npm run validate:migrations` to apply baseline's vendored schema to a clean local D1.
4. Run `npm run dev` for the local-only Vite/Wrangler surface.

## Commands

[`package.json`](package.json) is the authority for exact command composition.

- `npm run check` — the credential-free acceptance gate, ordered in `scripts/lib/acceptance-plan.ts`; `npm run check -- source` or `-- browser` selects one group.
- `npm run security:dependency-advisories` and `BASE_SHA=<pr-base-sha> npm run validate:patch-whitespace` — the network and committed-range checks CI runs beside `check`. `npm run validate:ci` reproduces the CI path in a clean checkout with Chromium.
- `npm run generate:assets`, `npm run generate:routes` and `npm run generate:openapi` regenerate tracked artifacts; `npm run validate:generated-artifacts` checks their freshness.
- `npm run verify:github-settings` is the read-only live settings comparison and `npm run apply:github-settings` the explicit administration write, both against `config/github-repository-settings.json`.
- `npm run deploy` refuses production deployment from an arbitrary checkout.

`platform/` is baseline's shared Worker platform, vendored verbatim and pinned by `platform/vendor.lock.json`; `npm run check:platform` verifies the pin. Never edit it; re-vendor it from a merged `Wizard-Gang/baseline` commit. Worker secret names in `config/worker-secrets.json` follow baseline's `config/secrets.json` registry.

## Delivery

[`AGENTS.md`](AGENTS.md) is the delivery workflow and [`implementation_plan.md`](implementation_plan.md) the queue. Commits and PRs use `[DEMO-NNN] [TYPE] Imperative description`. `npm run delivery` (`scripts/controlled-delivery.ts`) selects or allocates identities, renders the controlled record, opens the PR and performs the protected squash. `main` requires exact-head `validate` and `browser` from `.github/workflows/ci.yml`, strict current-base protection and one squash commit per PR.

An owner-authorized version intent on `main` lets `.github/workflows/release-cutter.yml` create the annotated tag. `.github/workflows/release.yml` then reproduces the tag, publishes the GitHub Release, deploys through baseline's `deploy-worker.yml` after production-environment approval and attaches the verified result to the Release.
