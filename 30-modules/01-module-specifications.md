# Functional Module Specifications

Specs for every ATLAS module outside the Tender Division (which has its own
directory). Each spec: purpose, core capabilities, key data, integrations,
delivery phase. Detailed UI/UX and physical schema are produced at build time
per module, governed by these specs.

## M1 `project` — Construction Management (VS2) — Phase 2

**Purpose**: run chantiers with the same rigor agents bring to tenders; protect
margin between award and réception définitive.

- Project record auto-created on win: BPU/DQE becomes the billing baseline;
  marché metadata (délais, penalties, révision formula) drives alerts.
- **Ordres de service registry** (OS commencement/arrêt/reprise) — legal clock
  for délais & pénalités; every OS scanned + dated + acknowledged.
- Planning: phases/tasks vs contractual milestones; S-curve avancement.
- **Attachements**: quantity measurements per BPU line, captured on site
  (mobile), photo-evidenced, contradictoirement signed — the raw material of
  every décompte and every claim.
- Situations de travaux → feeds `billing` décompte drafts.
- Journal de chantier (daily log: weather, effectifs, matériel, événements) —
  mobile-first, 2 minutes/day, legally precious in disputes.
- Incidents & HSE: AT/MP register (legal), near-miss log, photos.
- Réceptions: provisoire/définitive workflows with réserves tracking
  to closure; délai de garantie calendar.
- Sous-traitants: contracts, déclarations, their attachements & payments.

**Data**: Project, OsEvent, Task, Attachement(+lines+photos), Situation,
JournalEntry, Incident, Reception, Reserve, Subcontract.
**Integrations**: `tender` (award handoff), `billing`, ATLAS Field, Odoo
(analytic accounts per chantier).

## M2 `billing` — Décomptes & Cash (VS3) — Phase 2 (radar in Phase 1 manually)

**Purpose**: bill everything earned, on time; chase every dirham.

- Décompte provisoire generator: from validated attachements × BPU prices,
  révision des prix application, retenue de garantie & advances deduction —
  produces the standard décompte package for the maître d'ouvrage.
- Payment tracking: décompte submitted → visé → ordonnancé → paid; aging per
  buyer; **intérêts moratoires calculator** per regulation (claim-ready file).
- Cautions lifecycle: provisoire (restitution chase), définitive, retenue de
  garantie release at réception définitive — a register with bank, amounts,
  release conditions, and alerts. Idle cautions are dead capital.
- Cash projection: décompte pipeline + payment-behavior model per buyer (from
  intel) → 13-week cash view for Direction.

**Data**: Decompte(+lines), PaymentEvent, Caution, RetenueGarantie, RevisionIndex.
**Integrations**: `project`, Odoo (client invoice mirror, ledger), `intel`
(buyer payment behavior), dashboards.

## M3 `vault` — Company Document Vault (VS4) — Phase 0 (first thing built)

**Purpose**: the company can produce any administrative document, valid, in 30
seconds. Spec in data architecture §3–4 (storage, validity ladder, readiness
score). Includes: legal docs, qualifications/classifications, références
(attestations de bonne exécution — the currency of technical dossiers), staff
diplomas/CVs, matériel ownership proofs, insurance policies, modèles
(templates) versioned.

## M4 `supply` — Procurement, Fleet & Equipment (VS4) — Phase 2/3

- Suppliers registry + price quotes (feeds Estimator's price book).
- Purchase orders per chantier (budget line control vs estimate).
- Fleet & equipment: registry, affectation per chantier, maintenance schedule,
  fuel log (theft surface — anomaly alerts), amortization data to Odoo.
- Material reception on site via mobile (photo + bon de livraison scan).

## M5 `people` — Workforce Ops (VS4) — Phase 3

- Site pointage (mobile, offline, FR/AR) → CNSS declaration feed via Odoo.
- Assignments: who is on which chantier (capacity view for Strategist).
- Certifications & habilitations registry (CACES-type, medical visits) with
  expiry alerts. CNDP declaration prerequisite (security doc §4.1).

## M6 `crm` — Relationships (VS1 support) — Phase 3 (lightweight)

Buyers, partners (groupement candidates), banks, insurers, sous-traitants:
contacts, interactions, commitments. Deliberately minimal — this company's CRM
is relationship-driven; the system just ensures memory and follow-ups. Private
clients pipeline added when private work materializes.

## M7 `dashboards` — Executive Intelligence (VS5) — Phase 1 onward, grows

- **Direction cockpit**: cash position & 13-week projection, pipeline value by
  gate, win rate trend, chantier margin health (earned vs billed vs paid),
  compliance readiness score, top risks (C3 + project alerts).
- **Division Marchés board**: deadline wall (every tender, J-countdown),
  coverage stat, agent queue health.
- **Travaux board**: avancement vs planning vs facturation per chantier;
  attachements awaiting signature (revenue sitting in a drawer).
- Daily WhatsApp/email digest renders the cockpit top-5 numbers.

## M8 `brain` — AI Platform Services — Phase 0/1 (built with division)

Shared AI services per AI architecture doc: extraction pipelines, embeddings,
retrieval API, agent runtime (BullMQ + Agent SDK), eval harness, cost telemetry.

## M9 Odoo Back-Office (adopted) — Phase 0/1

Modules activated: Accounting (l10n_ma chart, TVA declarations support),
Invoicing, HR base + payroll (CNSS/AMO/IR — validated with the company's
fiduciaire), Expenses. **Customization budget: near zero** — Odoo stays vanilla;
all custom logic lives in ATLAS. Integration contract in enterprise
architecture §5.

## Cross-Module Rules

- Every module ships with: audit events, RBAC matrix, mobile-relevant endpoints,
  warehouse event feed, and FR labels (AR where field-facing).
- No module may store a document outside MinIO+`vault.document` referencing.
- No module may call Odoo directly except through `integration/odoo`.
- Each module's MVP is defined as "replaces the Excel/WhatsApp practice it
  competes with, fully, for one real chantier/tender" before widening.
