# Security & Compliance Architecture

## 1. Threat Model (what actually hurts this company)

| Threat | Impact | Primary controls |
|---|---|---|
| Bid data leak (prices, rabais strategy) before opening | Lost tenders, existential | Need-to-know RBAC; price scenarios visible to Direction only; audit trail; no bid data in email/WhatsApp |
| Ransomware on company files | Operations halt, dossier loss | Immutable backups (versioned MinIO + offsite), restore drills, least-privilege endpoints |
| Document forgery / tampering (attestations, attachements) | Legal exposure, lost claims | SHA-256 on every vault object, append-only audit, WORM archive bucket |
| Account takeover (admin or signer) | Total compromise | MFA mandatory, Keycloak policies, Tailscale-only admin surface |
| Insider exfiltration (estimator leaves with price DB) | Moat erosion | Row-level access, export watermarking + export audit, legal NDAs |
| Scraper IP bans / portal lockout | Pipeline blindness | Polite rate limits, monitoring, multiple egress IPs, manual fallback procedure |
| Phishing of accountant/DAF (fake RIB fraud — common in Morocco) | Direct cash loss | Dual-approval on supplier RIB changes & payments, training |

## 2. Identity & Access

- **Keycloak** is the only identity source: staff SSO (OIDC) into ATLAS Web,
  Odoo, Metabase, Grafana.
- **MFA (TOTP) mandatory** for all accounts; hardware keys for Direction + admins.
- **Roles** (initial): `direction`, `marches`, `travaux`, `finance`, `terrain`,
  `admin-si`, `agent-service` (machine). Default deny; permissions defined per
  module action, not per screen.
- **Sensitive partitions**: price scenarios & win-probability → `direction` +
  `marches-senior` only. Salaries → Odoo HR roles only, never replicated.
- Machine credentials (agents, scrapers): per-service accounts, scoped tokens,
  rotated quarterly, never personal accounts.

## 3. Platform Security Baseline

- TLS everywhere (Caddy/Traefik auto-certs); HSTS; security headers per web rules.
- Admin interfaces (DB, MinIO console, Grafana, Keycloak admin) reachable via
  **Tailscale only** — zero public admin surface.
- Containers: non-root, pinned digests, weekly Trivy scan in CI.
- Secrets: SOPS+age; no secret in code, logs, or tickets — CI secret-scan gate.
- PostgreSQL: per-module DB roles; RLS on `company_id` (multi-entity ready);
  encrypted at rest (LUKS volume) and in transit.
- Audit: append-only `audit.log` for every state change + auth events;
  shipped to Loki; 1-year online, archived 10 years.
- Backups: nightly pgBackRest (encrypted, offsite), MinIO versioning +
  replication; **monthly restore test is a calendar event with a named owner**.

## 4. Moroccan Regulatory Compliance

### 4.1 Personal data — Loi 09-08 & CNDP
- Personal data processed: employees (HR/paie), site workers (pointage, photos),
  supplier contacts. **Action**: déclarations/autorisations CNDP before go-live
  of HR & pointage modules; register of processing; retention limits; worker
  notice (FR/AR) for site photos; DPO-like responsibility assigned to DAF.
- Data residency: no legal blanket ban on EU hosting, but cross-border transfer
  of personal data requires CNDP compliance. **Posture**: operational/personal
  data path to Moroccan hosting (N+ONE, Atlas Cloud Services) by Year 2;
  non-personal tender intelligence may remain on EU VPS.

### 4.2 Cybersecurity — Law 05-20 / DGSSI
- We are not (yet) an "infrastructure d'importance vitale" operator, but DGSSI's
  Directive Nationale de la Sécurité des SI is the reference baseline we align
  to (asset inventory, hardening, incident response, logging).

### 4.3 Public procurement integrity — Decree 2-22-431
- Strict separation: market intelligence uses **published** data only (avis, PV,
  résultats définitifs, extraits de jugement). No collusive contact, no insider
  procurement data — also enforced as an agent guardrail (see AI architecture).
- Electronic submission via PMMP with qualified certificate (Barid eSign class
  for marchés publics) — certificates are personal, held by named signatories,
  never stored in ATLAS.

### 4.4 Fiscal & corporate
- Facturation rules (DGI), TVA 20% standard, IS per Loi de Finances in force;
  ICE on all documents; e-invoicing (DGI program) tracked as a compliance
  roadmap item — Odoo l10n_ma keeps us current.
- Marché documents, décomptes, cautions: 10-year retention (archive bucket).

### 4.5 Labor — Code du travail (65-99) & CNSS
- Pointage data feeds CNSS declarations; AT/MP (work accident) incident log is
  mandatory and lives in `project.incident` with legal export format.

## 5. Application Security Practices

- OWASP Top 10 checklist gate in CI (security review on every PR
  touching auth, billing, upload, or scraper code).
- Input validation with Zod at all boundaries; parameterized queries only
  (Drizzle); no raw HTML rendering of scraped content (XSS via portal data is a
  real vector — sanitize at ingestion).
- Uploads: type sniffing, size caps, AV scan (ClamAV) before vault admission.
- Rate limiting on all public endpoints; brute-force lockout via Keycloak.

## 6. Incident Response (minimum viable)

1. Detect (Grafana alert / Sentry / user report) → 2. Triage severity (S1 cash
or bid-deadline impact, S2 degraded, S3 minor) → 3. Contain (isolate container,
revoke tokens) → 4. Restore (runbook per service) → 5. Post-mortem within 72h,
actions tracked in repo.
- S1 contact chain and runbooks live in `platform/runbooks/` (to be populated
  during Phase 0 build).
- Cyber-insurance evaluation: Year 1 action item for the DAF.
