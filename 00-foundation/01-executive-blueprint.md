# Executive Blueprint — AGHA RM INFRA

## 1. Company Definition

AGHA RM INFRA is a Moroccan enterprise active in:

- **Construction & public works (BTP)** — bâtiment, génie civil, VRD, terrassements
- **Infrastructure** — roads, networks, public facilities
- **Hydraulic development** — irrigation, drinking water (AEP), drainage, small dams,
  pumping stations
- **Agricultural development** — land development (aménagement foncier), drip
  irrigation, agricultural infrastructure under Génération Green 2020–2030
- **Engineering & project management services**
- **Public procurement** — the dominant client channel: the Moroccan State,
  collectivités territoriales, and public establishments (ORMVAs, ONEE, ABHs,
  Ministère de l'Équipement et de l'Eau, Ministère de l'Agriculture, agences
  urbaines, communes…)

Future expansion: private development, real estate, industrial services,
export of engineering services to West Africa.

## 2. Strategic Diagnosis

| Reality of the Moroccan BTP sector | ATLAS answer |
|---|---|
| Tenders won/lost on paperwork rigor: one missing or expired attestation = elimination | Automated compliance engine; document vault with validity tracking |
| Pricing is a dark art: winners are decided by rabais strategy and cost mastery | Historical price database mined from published PV/résultats on the PMMP |
| Margins destroyed on site: poor attachement/décompte discipline, unmanaged claims | Digital attachements, décompte automation, penalty/claim tracking |
| Knowledge lives in one or two heads | Structured knowledge base; every dossier captured forever |
| Cash flow killed by payment delays (délais de paiement publics) | Receivables radar: décompte aging, intérêts moratoires computation, nantissement tracking |
| Most SMEs see only a fraction of available tenders | Agents watch every relevant source daily; coverage becomes near-total |

**The core bet**: in a market where most competitors run on Excel and paper, a
company whose tender pipeline, costing memory and site administration are run by
software + AI agents wins more, prices better, and bleeds less.

## 3. Business Architecture — Value Streams

ATLAS organizes the company around five value streams:

```
VS1  WIN      Detect → Qualify → Decide (Go/No-Go) → Prepare → Submit → Track award
VS2  BUILD    Mobilize → Execute → Measure (attachements) → Bill (décomptes) → Receive (réceptions)
VS3  COLLECT  Invoice/décompte → Follow payment → Escalate (intérêts moratoires) → Cash
VS4  SUPPORT  Finance, HR/paie, fleet & equipment, procurement of materials, legal
VS5  LEARN    Capture data from VS1–VS4 → Analytics → Better pricing, better bids, better ops
```

Every module and agent in this repository belongs to exactly one value stream.
VS1 is the revenue engine and is built first (see Tender Intelligence Division).

## 4. Operating Model

### 4.1 Organization (target, scales with headcount)

- **Direction Générale** — strategy, final Go/No-Go, signatures (human only)
- **Division Marchés (Tender Division)** — humans + AI agents running VS1
- **Direction Travaux** — conducteurs de travaux, chefs de chantier (VS2)
- **Direction Administrative & Financière** — VS3 + VS4
- **Cellule Systèmes & IA** — owns ATLAS; initially 1 engineer + external help,
  grows into an internal software team

### 4.2 Human–AI division of labor

| AI agents do | Humans do |
|---|---|
| Watch portals, parse DCE, extract requirements | Decide Go/No-Go |
| Draft dossiers, mémoires techniques, check compliance | Validate, sign (electronic certificate holders) |
| Compute price scenarios, win probabilities | Choose the final rabais/price |
| Track deadlines, alert on expiring documents | Renew documents with administrations |
| Mine published results, profile competitors | Build relationships, negotiate |
| Draft décomptes, detect billing gaps | Approve and submit décomptes |

**Rule**: agents have no authority to create legal or financial commitments.
Every external submission passes a named human gate, logged in the audit trail.

### 4.3 Cadence (operating rhythm)

- **Daily**: tender pipeline digest (new opportunities, deadlines, expiring docs)
- **Weekly**: Go/No-Go committee; site progress vs décompte review
- **Monthly**: cash & receivables review; win/loss analysis; KPI review
- **Quarterly**: strategy review; qualification/classification upgrade planning;
  architecture council (see 40-execution/02-governance.md)

## 5. Growth Trajectory (decade view)

| Horizon | State | System milestone |
|---|---|---|
| Year 1 | Win rate ↑ via total tender coverage + compliance automation | Tender Division live; Odoo back-office live |
| Year 2–3 | Class upgrades (qualification/classification), larger marchés, groupements | Full construction ops; predictive pricing from own + market data |
| Year 4–5 | Multi-région operations, possible second entity (BET — bureau d'études) | Multi-company ATLAS; consolidated analytics |
| Year 6–10 | National player; West Africa expansion (UEMOA procurement markets) | Multi-country, multi-currency, multi-language platform |

## 6. What Success Looks Like (KPIs)

- **Coverage**: % of relevant published tenders detected ≥ 95%
- **Bid throughput**: dossiers submitted per month (target 3× manual baseline)
- **Win rate**: tracked per segment; target sector top-quartile
- **Bid cost**: hours per dossier (target −60% vs manual)
- **Zero eliminations** for administrative non-conformity
- **DSO** (days sales outstanding) on public décomptes: measured, then reduced
- **Margin fidelity**: estimated vs real cost gap < 5% by Year 3
