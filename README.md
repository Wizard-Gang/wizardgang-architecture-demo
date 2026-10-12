# WizardGang Architecture Demo

Public, executable companion to **WG-ARCH-001 — WizardGang Systems Architecture**.

Target site: `https://demo.wizardgang.ai`  
Public repository: `Wizard-Gang/wizardgang-architecture-demo`

The canonical architecture standard is [`docs/ARCHITECTURE-STANDARD.md`](docs/ARCHITECTURE-STANDARD.md). This repository intentionally keeps architecture and operational documentation in reviewable Markdown/text rather than PDFs.

## Public surface

The ordinary browser experience is intentionally small:

- `/` — project orientation and compact live proof;
- `/demos` — executable architecture demonstrations.

`/admin` is a protected operational page and `/offline` is the recovery page. There is no human `/operations` route; requests receive the ordinary 404. Operational machine APIs, scheduled availability collection, 365-day retention, bounded logs, provider observations, and protected controls remain independent contracts.

The server-rendered application hierarchy is declared once in the route registry. Navigation, sitemap membership, canonical links, page metadata, and the generated route manifest are projections of those declarations. Do not maintain a second route list in this README. The human routing/browser contract is [`docs/ROUTE-REGISTRY.md`](docs/ROUTE-REGISTRY.md), and the generated machine inventory is [`docs/route-manifest.json`](docs/route-manifest.json).

## Demonstrated architecture

`/demos` groups the live demonstrations around visitor tasks rather than implementation inventory:

- Data — D1 and R2;
- APIs — REST/OpenAPI and GraphQL;
- Integrations — signed webhooks;
- Identity — separate OAuth 2.0, SSO, and SAML demos;
- AI / MCP — MCP endpoint, tools, executable proof, and connection guidance;
- supporting runtime proof — Edge, Workers, and Durable Objects;
- supporting quality proof — accessibility and internationalization.

Browser presentation and machine/protocol contracts remain separate. REST, OpenAPI, GraphQL, MCP, identity callbacks, webhooks, laboratory, operational, crawler, admin, and recovery routes keep their own declarations and policies.

Core invariants:

- shared state uses baseline's `wizardgang` D1 `records`/`events` tables through `WG_DB`, with per-row TTLs and no demo-owned DDL;
- R2 stores object bytes under `demo/` in the shared `wizardgang` bucket (`WG_R2`) while D1 records store metadata/references;
- Durable Objects own coordinated state and D1 stores audit evidence where applicable;
- Workers mediate application state and integrations;
- public REST, GraphQL, and MCP reads share an explicit authorization boundary;
- secrets, credentials, private account metadata, and real billing/payment data never belong in Git or public logs.

## Operations and administration

The homepage exposes only compact visitor-facing operational proof: current service/dependency state, measured scheduled availability, and running release/source identity. Detailed operational data remains behind machine contracts such as `/api/operations/*` rather than a public dashboard.

Availability while intentionally offline is declared per route. Gated API traffic returns structured `503` responses; browser demo navigation uses the registered recovery experience. `/admin` controls demonstration availability and crawler-access state under its authentication boundary.

## Local setup

1. Use Node.js 26.10.0 from `.node-version` with npm 12.1.0 from `packageManager`, then run `npm ci` from the committed lock file.
2. Copy `.dev.vars.example` to ignored `.dev.vars` and replace local placeholders, then seed the simulated local Secrets Store `WG_SESSION_KEY` as `.dev.vars.example` shows.
3. Run `npm run validate:migrations` to apply baseline's vendored shared schema to a clean local D1.
4. Run `npm run dev` for the local-only development surface.

Development builds generate a local HTTP adapter around the shared shell so loopback requests work while application same-origin checks retain their local URL. Release builds generated with `WG_VERSION` and `WG_COMMIT` import the strict shell directly and exclude that adapter.

### Validation and command authority

[`package.json`](package.json) scripts are the authority for exact command composition. This README keeps only the entry-point, prerequisite, and side-effect guidance needed to use them.

- `npm run dev` starts the local-only Vite/Wrangler surface after asset generation. It requires ignored local `.dev.vars` configuration; use `npm run dev -- --open` only when a desktop browser is available.
- `npm run check` is the canonical credential-free acceptance gate. The single ordered plan in `scripts/lib/acceptance-plan.ts` runs all stages by default; `npm run check -- source` and `npm run check -- browser` select its groups. Browser selection needs prepared client assets and Worker entry plus a fresh empty D1 context. The asset generator's two clean parity passes produce and verify the client distribution; the accepted second pass feeds `build:worker` directly without a third Vite invocation. The check also exercises migrations, the Worker dry run and bundle validation, browser, source, contract, and security checks without mutating live providers.
- Focused commands remain available when their scope is the work being changed: `npm run generate:routes` writes the tracked route projection directly, `npm run validate:routes` tests route serialization (not generated-file freshness), `npm run validate:generated-artifacts` owns tracked freshness, `npm run validate:migrations` applies the vendored shared schema to local D1 state, and `npm run verify:chromium` / `npm run test:site-accessibility` exercise the browser audit. `npm run build` independently generates a fresh client distribution and performs the Worker dry run and bundle validation.
- Ordinary pre-PR validation is `npm run check`, `npm run security:dependency-advisories`, and `BASE_SHA=<pr-base-sha> npm run validate:patch-whitespace`. The advisory query requires registry/network access; the patch check requires the authoritative base commit and sufficient Git history. A clean checkout with those prerequisites plus Chromium can use `npm run validate:ci` for the diagnostic install, acceptance, and committed-range path; run the advisory command separately, as CI does in the `validate` job.
- `npm run verify:github-settings` is the read-only live settings check and needs an authorized GitHub token; `npm run apply:github-settings` is the explicit administration-write path. `npm run deploy` intentionally refuses production deployment from an arbitrary checkout.

`platform/` is baseline's shared Worker platform (wg-edge, conformance and deploy checks), vendored verbatim and pinned by `platform/vendor.lock.json`; `npm run check:platform` verifies the pin. Never edit it; re-vendor it from a merged `Wizard-Gang/baseline` commit instead. Session, identity and audit keys come from its `deriveKey` over the Secrets Store `WG_SESSION_KEY`, and every Worker secret name follows baseline's `config/secrets.json` registry.

For failure output, retained artifacts, exact-head log retrieval, and base-SHA recovery, use [CI diagnostics](docs/CI-DIAGNOSTICS.md). Required status names and controlled-delivery policy remain under [Delivery](#delivery), [AGENTS.md](AGENTS.md), and [change management](docs/CHANGE-MANAGEMENT.md).

## Delivery

Commit pattern: `[DEMO-NNN] [TYPE] Imperative description`.

[`AGENTS.md`](AGENTS.md) is the shared delivery workflow. The permanent lowercase [`implementation_plan.md`](implementation_plan.md) selects the first open task; when it is empty, the next instruction fills it through a controlled plan-only change before implementation begins. `npm run delivery` provides automatic `begin`/`select`, plan-only identity allocation, controlled-record generation, PR publication and protected squash planning/application; see [change management](docs/CHANGE-MANAGEMENT.md#automatic-authoring-and-protected-delivery) for arguments and mutation boundaries. Provider operations require authenticated GitHub access and the pinned runtime; pure delivery predicates run inside `check`. This repository requires exact-head `validate` and `browser`, strict current-with-main protection, and one squash commit for each controlled PR. [Repository boundaries](docs/REPOSITORY-BOUNDARIES.md) retain the demo-specific architecture, cloud development, secret and operational rules.

`main` is the accepted production baseline. Changes flow through isolated branches, pull requests, automated validation and review; one owner-authorized batch, whose version intent is set during planning, then produces an annotated semantic tag, one tag reproduction, a GitHub Release and an exact-tag deployment whose verified result the same Release run attaches to that Release, with no version or record follow-up PR. See [`docs/CHANGE-MANAGEMENT.md`](docs/CHANGE-MANAGEMENT.md) and [`docs/RELEASE-MANAGEMENT.md`](docs/RELEASE-MANAGEMENT.md).

## Start here

- [`docs/ARCHITECTURE-STANDARD.md`](docs/ARCHITECTURE-STANDARD.md) — architecture, boundaries, and engineering defaults.
- [`docs/REPOSITORY-BOUNDARIES.md`](docs/REPOSITORY-BOUNDARIES.md) — application-specific development and architecture invariants.
- [`docs/ROUTE-REGISTRY.md`](docs/ROUTE-REGISTRY.md) — routing contract; [`docs/route-manifest.json`](docs/route-manifest.json) is its generated machine projection.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`docs/IDENTITY.md`](docs/IDENTITY.md) — operating and authorization boundaries.
- [`docs/governance/GOVERNANCE.md`](docs/governance/GOVERNANCE.md) — management-system entry point and links to the focused governance policies.
- [`docs/CHANGE-MANAGEMENT.md`](docs/CHANGE-MANAGEMENT.md) and [`docs/RELEASE-MANAGEMENT.md`](docs/RELEASE-MANAGEMENT.md) — controlled delivery, release, deployment, and rollback.

## GitHub auto-merge

The committed repository settings retain per-PR auto-merge capability. Controlled deliveries use the shared explicit protected squash path described above, with freshly re-read exact-head checks, mutable metadata and current-base protection. The authoring flow does not enroll controlled PRs in auto-merge or use a stalled auto-merge/manual-text fallback. Run `npm run verify:github-settings` for a read-only live check; `npm run apply:github-settings` applies the committed authority and independently verifies it.
