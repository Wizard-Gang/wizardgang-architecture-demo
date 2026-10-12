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

The authoritative Worker secret-name inventory is `config/worker-secrets.json`. It follows the baseline registry (`Wizard-Gang/baseline` `config/secrets.json`), which names every WizardGang secret, its one home and its consumers; baseline's secrets runbook mints, sets, rotates and revokes each one. Values are never checked in or exposed by health, version or source-link surfaces.

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
