# Market Intelligence System (Desk C)

The compounding asset: a structured map of the Moroccan public works market —
who buys, who wins, at what price — built **exclusively from published data**.

## 1. Data Sources (all public)

| Source | Yields | Agent |
|---|---|---|
| PMMP published results (résultats définitifs, extraits des PV) | Tender, all bidders, bid amounts, winner, winning amount | C1 Result Miner |
| PMMP avis history | Buyer activity volumes, seasonality, estimation levels | C1 |
| Programmes prévisionnels des achats | Forward demand by buyer | C1 |
| OMPIC (registre de commerce) | Competitor legal data: capital, age, dirigeants | C2 Profiler |
| Ministère de l'Équipement qualification registry | Competitors' sectors/qualifications/classes | C2 |
| Buyer payment reputation (own experience + market signals) | Payment-delay risk by buyer | C3 |
| Bulletin Officiel, sector press | Concessions, PPPs, structural moves | C2 |

## 2. Intelligence Products

### 2.1 Buyer profiles (`intel.buyer`)
Per buyer (ORMVA du Haouz, ONEE-Branche Eau, commune X…): annual volumes by
sector, average # bidders, rabais distribution of winners, estimation accuracy
(estimation vs winning price), payment behavior (from our VS3 data), procedural
habits (mémoire technique weight, visite requirements), relaunch patterns.

**Use**: A4 scoring (a buyer with 12 avg bidders and −25% winning rabais is a
margin desert); B4 win-prob priors; VS3 cash forecasting.

### 2.2 Competitor dossiers (`intel.competitor` + `competitor_bid`)
Per competitor: where they bid (region/sector/buyer), win rate, rabais band
(e.g., wins cluster at −18%…−22% vs estimation), classes held, estimated
capacity load (sum of recent wins vs class ceiling), groupement history.

**Use**: pre-bid competition forecast ("expected field: 8±3 bidders, dominant
rival: X, their likely band: −20%"); groupement partner shortlists; strategic
watch (a rival winning everything in our region at thin margins is burning
capacity — opportunity in 6 months).

### 2.3 Price observatory (`intel.unit_price`)
Unit prices extracted from published BPU-based results where recoverable, plus
our own bid history and supplier quotes: béton B25 per m³ by region/year,
conduite PEHD per ml by diameter, terrassement rocheux per m³…

**Use**: B3 grounding (every estimate cites observatory entries), inflation
tracking, "price drift" alerts on volatile inputs (steel, fuel, bitumen).

### 2.4 Win-probability model (B4 consumer)
Phase 1 heuristic: P(win) from buyer's historical winning-rabais distribution →
where does our scenario land? Adjusted by expected field size and mémoire
technique weight. Phase 2+: logistic regression on accumulated outcomes
(ours + observed), recalibrated quarterly, accuracy reported honestly
(Brier score on the KPI dashboard).

## 3. Collection Pipeline & Hygiene

- C1 runs nightly batch jobs (cheap T1 extraction over result documents).
- Entity resolution is the hard problem: company names are inconsistent across
  PVs ("STE AGHA RM INFRA SARL" vs "AGHA RM"). Canonical registry with alias
  table + fuzzy matching + human merge queue for ambiguous cases.
- Every intel row carries source document reference (provenance) — claims
  without provenance are not admitted to briefs.
- Coverage audit monthly: sample 20 published results manually, measure capture
  rate; target ≥ 90%.

## 4. Ethics & Legal Boundary (absolute)

- Published information only. No procurement-insider contact, no commission
  member contact, no confidential leak solicitation — criminal exposure under
  Moroccan law and instant company destruction.
- Intelligence informs **our** pricing; never price coordination with
  competitors (collusion).
- C2 profiles contain business facts, not personal data beyond public registry
  content (CNDP posture).

## 5. Maturity Roadmap

| Stage | Capability | When |
|---|---|---|
| M1 | Results capture + buyer/competitor base tables | Phase 1 (with division MVP) |
| M2 | Price observatory + scoring integration into G1 briefs | Phase 1+3 months |
| M3 | Fitted win-prob + quarterly market review auto-report | Phase 2 |
| M4 | Forward radar: programme prévisionnel → pre-positioning playbooks | Phase 2 |
| M5 | Regional expansion intelligence (new région entry analysis) | Phase 3+ |
