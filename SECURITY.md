# Security

This is a public architecture demonstration. Public source is intentional; secrets are not.

## Never commit

- Cloudflare API tokens or account credentials;
- admin passwords;
- OAuth/SAML client secrets or signing material;
- authorization headers, cookies, session tokens, private keys;
- real billing/payment/account metadata;
- production-only infrastructure identifiers that are not intentionally public.

Use Cloudflare/GitHub managed secret stores for production and ignored `.dev.vars` for local-only placeholders.

`npm run validate:security`, included in the canonical `check` gate, inspects tracked checkout files and every reachable Git revision for credential-file paths and secret-like text blobs. The history check reads each unique blob once, fails closed when a blob or the total history exceeds its bounded scan budget, and reports only object identifiers and finding categories. Exact value hashes exempt four synthetic credential values in their original test files; a different value or path is still checked. A real exposure requires private incident handling and credential rotation because deleting a file does not erase public Git history.

The authoritative Worker secret-name inventory is `config/worker-secrets.json`. It follows the baseline registry (`Wizard-Gang/baseline` `config/secrets.json`), which names every WizardGang secret, its one home and its consumers; baseline `docs/SECRETS-RUNBOOK.md` mints, sets, rotates and revokes each one. Values are never checked in or exposed by health, version, logs, usage, evidence, or source-link surfaces.

<!-- WORKER_SECRETS_START -->
- `DEMO_WEBHOOK_SECRET`;
- `GITHUB_WEBHOOK_SECRET`;
- `GITHUB_APP_PRIVATE_KEY`;
- `GITHUB_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `MICROSOFT_OAUTH_CLIENT_SECRET`;
- `CLOUDFLARE_BILLING_TOKEN` (optional);
<!-- WORKER_SECRETS_END -->

Public provider configuration is a Wrangler var, not a secret: `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_TENANT_ID`, and, once the SAML IdP exists, `SAML_IDP_CERT`, `SAML_IDP_ISSUER` and `SAML_SSO_URL`.

The demo holds no signing secret of its own. Visitor demo sessions (`demo-session`), identity sessions, flows and access tokens (`identity-session`), and identity audit identifiers (`identity-audit`) use 32-byte keys that the vendored wg-edge `deriveKey` derives with HKDF-SHA256 from the shared Secrets Store `WG_SESSION_KEY` binding. Without that binding each feature fails closed. Rotating `WG_SESSION_KEY` signs every demo and identity session out at once.

## Demo administration

`/admin` is authenticated and state-changing responses use `Cache-Control: no-store`. Online/offline and crawler-access states are persisted in D1 and state transitions are auditable, but audit payloads must never contain credentials or authorization material.

The vendored `wg-edge` shell gates `/admin` and `/admin/*` with the shared Secrets Store `WG_OPS_TOKEN`; the application receives only the shell's authenticated-admin decision and never reads an admin password. State-changing form submissions still require exact same-origin requests and failures fail closed.

The controlled Git lifecycle reuses the admin boundary for start and merge/release actions. The browser sends credentials only to the same-origin Worker. The Worker and `git-demo.yml` both act as the `wg-github-app` GitHub App, which is installed on this repository only and holds no Administration, Secrets, Environments or Workflows permission. Each Worker call mints an installation token with only the permissions that call needs through the vendored wg-edge `githubAppToken` (`GITHUB_APP_PRIVATE_KEY`); `git-demo.yml` runs in the `git-demo` environment and mints a job-scoped token from its `APP_ID` and `APP_PRIVATE_KEY`, which GitHub revokes when the job ends. The release job requests Actions read access to verify the canonical exact-head CI run and its real acceptance jobs through the shared protected delivery adapter; it does not grant workflow mutation. No personal GitHub token remains.

Crawler access combines the shared shell's stable `/robots.txt` policy with application request gating for `OAI-SearchBot` and `ChatGPT-User`; robots rules alone are insufficient for user-triggered visits. `GPTBot` remains blocked so search/fetch access is separate from model-training access. No authorization decision relies on a crawler user agent.

The broad operator credential is accepted only by the shared shell for the `/admin` boundary; application routes never compare or persist it. REST writes accept only short-lived tokens derived from validated identity sessions, and those tokens are limited to a server-derived visitor namespace. Public REST, GraphQL, and MCP reads share the explicit `demo:read` boundary, and authenticated GraphQL mutations cross the same normalized-principal policy. Webhook receivers verify signatures over the exact request body and reject replayed delivery IDs.

## Public logging

`/api/operations/logs` is a bounded public-safe diagnostic machine surface. There is no public human log explorer. Do not store or return passwords, authorization headers, cookies, bearer tokens, API keys, secrets, payment data, private account identifiers, or unreviewed request bodies. Structured detail is defensively redacted and size-bounded before it reaches `application_logs`. Identity log records never expose their structured detail through the public log projection.

Keep operational logs (`log` events) distinct from the `audit` event stream: logs explain runtime behavior; audit events preserve meaningful control/change evidence.

## Offline behavior

Intentional offline state is not a reason to expose debugging details. Gated browser demo routes use the registered recovery experience; gated API-like/write calls receive safe JSON `503` responses. Routes explicitly declared available while offline, including recovery, security/support, administration, crawler controls, and applicable operational machine endpoints, remain governed by their route declarations. `/operations` remains an ordinary unknown route while the application is offline.

## Vulnerability reporting

Do not open a public issue for a suspected vulnerability, active security incident, credential exposure, exploit detail, or sensitive infrastructure concern. Use the repository's [private vulnerability reporting](https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/advisories/new) mechanism.

This file is the disclosure policy. Machine-readable contact information is available at `https://demo.wizardgang.ai/.well-known/security.txt`.

Include the affected route, component, or release; observed behavior and impact; safe reproduction steps; and supporting evidence that can be shared privately. A report may be rejected as non-security, accepted into a draft GitHub Security Advisory, coordinated through remediation, and later published in sanitized form. Not every report is a vulnerability, security incident, GHSA, or CVE.

### Coordinated disclosure lifecycle

The controlled path is **private report → triage → GHSA → fix/release → eligible CVE → public advisory**.

1. **Private report.** Reporter identity, private reproduction steps, attachments, exploit detail, credentials, and sensitive infrastructure information stay in GitHub private vulnerability reporting.
2. **Triage.** Maintainers validate whether the report is a security vulnerability and determine scope and impact. Triage notes remain private.
3. **GHSA.** A confirmed vulnerability may be coordinated in a draft GitHub Security Advisory. Draft advisory content is private.
4. **Fix and release.** Remediation is completed and a fixed release is published before the advisory is published.
5. **Eligible CVE.** A CVE is recorded only after an actual identifier has been assigned.
6. **Public advisory.** The sanitized GitHub Security Advisory is published in the repository's [security advisories](https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/advisories).

Private report contents, draft GHSA data, reporter identity, exploit details, private treatment notes, and unreleased vulnerability detail are never published.
