# Data Architecture & Knowledge Management

## 1. Data Domains & Ownership

| Domain | Master system | Schema | Key entities |
|---|---|---|---|
| Tenders & bids | ATLAS | `tender`, `bid`, `intel` | Tender, DCE, Lot, Bid, GoNoGo, Award, CompetitorBid |
| Projects/chantiers | ATLAS | `project` | Project, Phase, Attachement, Reception, Incident |
| Billing & cash | ATLAS (ops) / Odoo (ledger) | `billing` | Decompte, Caution, RetenueGarantie, PaymentEvent |
| Company documents | ATLAS | `vault` | LegalDoc, Qualification, Certificate (with validity) |
| Suppliers & materials | ATLAS | `supply` | Supplier, PurchaseOrder, Equipment, FuelLog |
| People | Odoo HR (master) + ATLAS `people` (site ops) | `people` | Worker, Pointage, Assignment |
| Knowledge | ATLAS | `brain` | KnowledgeDoc, Embedding, AgentRun, Extraction |
| Analytics | ATLAS warehouse | `warehouse` | Facts & dimensions (read-only) |

Conventions (all schemas): `id` UUIDv7, `company_id`, `created_at`/`updated_at`
(timestamptz, UTC), soft-delete via `archived_at`, append-only `audit.log`
(actor, action, entity, before/after JSONB). Dates stored ISO 8601; UI renders
DD/MM/YYYY (Moroccan convention). Money: `numeric(14,2)` + `currency` (default MAD).

## 2. Core Entity Model (conceptual, synthetic example values)

```
Tender
├─ reference        "AO 12/2026/ORMVAH"      (portal reference)
├─ buyer            → Buyer (ORMVA du Haouz, type: établissement public)
├─ procedure        AOO | AOR | concours | négocié | bons de commande
├─ object           "Travaux d'aménagement hydro-agricole …"
├─ estimation_mad   4_500_000.00             (administration's estimate)
├─ caution_prov_mad 45_000.00
├─ qualifications[] [{secteur, qualification, classe_min}]
├─ deadline_at      2026-07-15T10:00:00Z
├─ lots[]           → Lot (allotissement)
├─ documents[]      → DceDocument (avis, RC, CPS, CCAG ref, BPU/DQE, plans)
├─ pipeline_state   detected → parsed → qualified → go_decided → preparing
│                   → submitted → opened → won|lost|cancelled
└─ award            → Award (winner, amount, our_rank, all_bids[])

Bid
├─ tender_id, decision (go/no-go + reasons + decided_by + decided_at)
├─ checklist[]      [{item, kind: admin|tech|fin, status, evidence_doc_id}]
├─ price_scenarios[] [{label, total_mad, margin_pct, win_prob}]
├─ final_offer      {total_mad, rabais_pct, signed_by}
└─ outcome          {result, our_rank, winner_amount_mad, lessons[]}
```

The full physical schema lives with the code (Drizzle migrations); this document
fixes domain language and ownership only. **Ubiquitous language is French** for
domain terms (décompte, attachement, caution, rabais) — do not translate them in
code; `Decompte` not `ProgressBilling`.

## 3. Document Store (GED) Layout — MinIO

```
s3://atlas-vault/        company legal docs (RC, statuts, attestations, CNSS, fiscale…)
s3://atlas-dce/          downloaded tender documents   /{tender_ref}/{filename}
s3://atlas-bids/         generated dossiers            /{tender_ref}/{version}/
s3://atlas-sites/        chantier photos & attachments /{project_code}/{date}/
s3://atlas-archive/      WORM-style retention copies (10-year legal horizon)
```

Every object row-referenced in PostgreSQL (`vault.document`: bucket, key, sha256,
mime, source, expires_at where applicable). Nothing exists "only in a folder".

## 4. Validity Tracking (compliance-critical)

Moroccan administrative documents expire and an expired one eliminates a bid:

| Document | Typical validity | Alert ladder |
|---|---|---|
| Attestation fiscale (DGI) | < 1 year | 60/30/14/7 days before expiry |
| Attestation CNSS | < 1 year | same |
| Certificat de qualification & classification | multi-year, class-bound | 90/60/30 days |
| Caution provisoire (per bid) | until adjudication | event-driven (restitution chase) |
| Assurances (RC, décennale, AT) | annual | 60/30/14 days |

`vault` computes a daily **compliance readiness score**: can we bid *today*
without requesting any document? Target: always 100%.

## 5. Knowledge Management (VS5)

Three knowledge layers, all queryable by agents:

1. **Structured** — the schemas above. The most valuable table in the company is
   `intel.competitor_bid`: every published award result (PV, résultats définitifs
   from the PMMP) → buyer, tender, all bidders, amounts, winner. This accumulates
   into a national price/competitor map that no Excel-based competitor has.
2. **Semantic** — pgvector embeddings over: past mémoires techniques, CPS clauses,
   incident reports, lessons-learned notes. Used for "find me similar past
   tenders / what did we price for geomembrane in 2025?"
3. **Procedural** — agent playbooks & checklists (versioned Markdown in repo):
   how to assemble a dossier for ORMVA vs commune vs ONEE; CCAG-T obligations
   timeline; réception procedures.

**Capture discipline**: closing a tender (won or lost) and closing a chantier
both require a structured debrief form (5 min) — fed to embeddings. Knowledge
capture is a workflow step, not an aspiration.

## 6. Analytics & Warehouse

- Event-sourced feed: every domain event lands in `warehouse.events`
  (entity, type, payload JSONB, occurred_at).
- Nightly SQL transforms build marts: `mart_pipeline` (funnel conversion),
  `mart_pricing` (won/lost vs estimation deltas, rabais distributions by buyer
  and sector), `mart_sites` (avancement vs facturation), `mart_cash` (décompte
  aging, DSO), `mart_competitors` (who wins what, where, at what discount).
- Metabase dashboards per audience: Direction (cash, pipeline, marge),
  Division Marchés (deadlines, win rate, coverage), Travaux (avancement,
  attachements en retard).

## 7. Data Quality & Retention

- Zod validation at every boundary; scraped data passes a normalization layer
  (buyer name canonicalization is critical — "ORMVA du Haouz" = "O.R.M.V.A.H").
- Dedupe: tenders keyed on (portal, reference) + fuzzy title match.
- Retention: financial & marché documents 10 years (Code de commerce / fiscal
  horizons); personal data per CNDP declarations (see security doc); site photos
  10 years (claims defense).
- Weekly `data-doctor` job: orphan checks, expired-doc scan, embedding backlog,
  failed-sync queue depth.
