import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Each ATLAS module owns its PostgreSQL schema (enterprise-architecture §3).
export const vault = pgSchema('vault');
export const tender = pgSchema('tender');
export const audit = pgSchema('audit');

// Append-only: no update/delete path exists in application code.
export const auditLog = audit.table('log', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  outcome: text('outcome').notNull(),
  payload: jsonb('payload'),
});

export const vaultDocuments = vault.table('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  reference: text('reference'),
  bucket: text('bucket'),
  objectKey: text('object_key'),
  sha256: text('sha256'),
  mime: text('mime'),
  issuedAt: date('issued_at', { mode: 'date' }),
  expiresAt: date('expires_at', { mode: 'date' }),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const intel = pgSchema('intel');

export const competitors = intel.table('competitor', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const competitorBids = intel.table(
  'competitor_bid',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    buyerName: text('buyer_name').notNull(),
    bidderName: text('bidder_name').notNull(),
    competitorId: uuid('competitor_id').references(() => competitors.id),
    // Phase 0: the join key to the avis we saw. Nullable until back-filled by
    // reference — the estimation↔attribution rebate depends on this link.
    tenderId: uuid('tender_id').references(() => tenders.id),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }),
    // The administrative estimation read off the result notice (vision). Together
    // with amount_mad this yields the recovered winning rebate — the calibration
    // GOLD. Often null on a résultat-définitif notice; captured when present.
    estimationMad: numeric('estimation_mad', { precision: 14, scale: 2 }),
    // Market object as printed on the notice — feeds segment inference for the
    // per-segment rebate benchmarks.
    objet: text('objet'),
    isWinner: boolean('is_winner').notNull().default(false),
    resultDate: date('result_date', { mode: 'date' }),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One bid per (avis, competitor): lets the result-crawler harvest and the
    // PV harvest race without producing duplicate rows that would double-count a
    // winner in the rebate calibration. competitor_id is nullable but always set
    // in practice; NULLs are distinct in Postgres, which is fine here.
    uniqueIndex('competitor_bid_reference_competitor_uniq').on(
      table.reference,
      table.competitorId,
    ),
  ],
);

// Native procurement (Odoo-replacement slice 1): suppliers, bons de
// commande, factures fournisseurs — our roles, our audit, no external ERP.
export const supply = pgSchema('supply');

export const suppliers = supply.table('supplier', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  name: text('name').notNull(),
  /** Identifiant Commun de l'Entreprise — Moroccan business id. */
  ice: text('ice'),
  phone: text('phone'),
  email: text('email'),
  status: text('status').notNull().default('actif'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = supply.table('purchase_order', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  projectId: uuid('project_id').references(() => projects.id),
  reference: text('reference').notNull(),
  objet: text('objet').notNull(),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  status: text('status').notNull().default('brouillon'),
  orderedAt: date('ordered_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Bon de commande line items — inserted with the parent order (mirrors the
// sales quote_line/invoice_line pattern). When lines are supplied, the order's
// amount_mad is the Σ of these line totals; legacy orders carry none.
export const purchaseOrderLines = supply.table(
  'purchase_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the order — deleting the parent cascades.
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [
    index('supply_purchase_order_line_order_id_idx').on(table.purchaseOrderId),
  ],
);

export const supplierInvoices = supply.table('supplier_invoice', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  reference: text('reference').notNull(),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  invoiceDate: date('invoice_date', { mode: 'date' }).notNull(),
  dueDate: date('due_date', { mode: 'date' }).notNull(),
  status: text('status').notNull().default('recue'),
  paidAt: date('paid_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const project = pgSchema('project');

// A chantier — born from a won tender or registered manually.
export const projects = project.table('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  tenderId: uuid('tender_id').references(() => tenders.id),
  reference: text('reference').notNull(),
  name: text('name').notNull(),
  buyerName: text('buyer_name').notNull(),
  montantMarcheMad: numeric('montant_marche_mad', { precision: 14, scale: 2 }).notNull(),
  ordreServiceDate: date('ordre_service_date', { mode: 'date' }),
  delaiMois: numeric('delai_mois', { precision: 4, scale: 1 }),
  status: text('status').notNull().default('preparation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Situation de travaux / décompte provisoire (CCAG-T): cumulative amounts;
// the period delta + retenue de garantie are derived in the domain layer.
export const situations = project.table('situation', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  numero: integer('numero').notNull(),
  periodEnd: date('period_end', { mode: 'date' }).notNull(),
  montantCumuleMad: numeric('montant_cumule_mad', { precision: 14, scale: 2 }).notNull(),
  montantPeriodeMad: numeric('montant_periode_mad', { precision: 14, scale: 2 }).notNull(),
  retenueGarantieMad: numeric('retenue_garantie_mad', { precision: 14, scale: 2 }).notNull(),
  netAPayerMad: numeric('net_a_payer_mad', { precision: 14, scale: 2 }).notNull(),
  avancementPct: numeric('avancement_pct', { precision: 5, scale: 2 }).notNull(),
  status: text('status').notNull().default('brouillon'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Avenant — contract amendment changing amount and/or delay. The décompte
// ceiling becomes montant marché + sum of approved avenant deltas.
export const avenants = project.table('avenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  numero: integer('numero').notNull(),
  objet: text('objet').notNull(),
  montantDeltaMad: numeric('montant_delta_mad', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  delaiDeltaMois: numeric('delai_delta_mois', { precision: 4, scale: 1 })
    .notNull()
    .default('0'),
  approvedAt: date('approved_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Journal de chantier — daily site report filed by the terrain role.
// One report per project per day (enforced in application code).
export const dailyLogs = project.table('daily_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  reportDate: date('report_date', { mode: 'date' }).notNull(),
  effectifs: integer('effectifs').notNull(),
  travauxRealises: text('travaux_realises').notNull(),
  materiel: text('materiel'),
  meteo: text('meteo'),
  blocages: text('blocages'),
  incidentsSecurite: integer('incidents_securite').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Tâches de chantier — the physical work-breakdown for a project. Progress here
// is PHYSICAL avancement (per-task % rolled up in task.domain), deliberately
// SEPARATE from the situation-based financial avancement above.
export const tasks = project.table(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    label: text('label').notNull(),
    description: text('description'),
    progressPct: numeric('progress_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    // status ∈ {'a_faire','en_cours','termine','bloque'} — validated at the edge.
    status: text('status').notNull().default('a_faire'),
    startDate: date('start_date', { mode: 'date' }),
    dueDate: date('due_date', { mode: 'date' }),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Tasks are always read per chantier — keep that list query off a seq scan.
    index('task_project_id_idx').on(table.projectId),
  ],
);

export const finance = pgSchema('finance');

// Bank guarantees register — cash locked at banks until release.
// kind: provisoire (per tender) | definitive | retenue_remplacee (per project).
export const cautions = finance.table('caution', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  kind: text('kind').notNull(),
  reference: text('reference').notNull(),
  tenderId: uuid('tender_id').references(() => tenders.id),
  projectId: uuid('project_id').references(() => projects.id),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  bankName: text('bank_name'),
  issuedAt: date('issued_at', { mode: 'date' }).notNull(),
  releasedAt: date('released_at', { mode: 'date' }),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Recettes / encaissements — money IN (TGR payments, acomptes, avances).
// method ∈ {virement,cheque,espece,effet,autre} — validated at the edge.
export const payments = finance.table(
  'payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    projectId: uuid('project_id').references(() => projects.id),
    label: text('label').notNull(),
    payerName: text('payer_name'),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    method: text('method').notNull().default('virement'),
    transferReference: text('transfer_reference'),
    bankName: text('bank_name'),
    paidAt: date('paid_at', { mode: 'date' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Cashflow per chantier reads payments by project — keep it off a seq scan.
    index('payment_project_id_idx').on(table.projectId),
  ],
);

// Dépenses — money OUT, classified by category (location_materiel, materiaux,
// main_oeuvre, carburant, transport, sous_traitance, administratif, taxes, autre).
export const expenses = finance.table(
  'expense',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    projectId: uuid('project_id').references(() => projects.id),
    category: text('category').notNull(),
    label: text('label').notNull(),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    method: text('method'),
    reference: text('reference'),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    spentAt: date('spent_at', { mode: 'date' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // By-category summary + per-chantier cashflow are the two hot read paths.
    index('expense_category_idx').on(table.category),
    index('expense_project_id_idx').on(table.projectId),
    // Supplier-scoped expense reports (all dépenses for fournisseur X) + joins
    // to supply.supplier must not seq-scan finance.expense as it grows.
    index('expense_supplier_id_idx').on(table.supplierId),
  ],
);

export const watch = pgSchema('watch');

// Every portal fetch is recorded; raw HTML is archived when content
// changes (sha256) so extractions are auditable and re-parsable without
// re-crawling. Coverage reporting reads this table.
export const portalSnapshots = watch.table('portal_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  changed: boolean('changed').notNull(),
  parsedOk: boolean('parsed_ok').notNull().default(false),
  items: integer('items').notNull().default(0),
  objectKey: text('object_key'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const people = pgSchema('people');

// Workforce register — employees and their chantier assignments.
export const employees = people.table('employee', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  fullName: text('full_name').notNull(),
  cin: text('cin'),
  metier: text('metier').notNull(),
  phone: text('phone'),
  status: text('status').notNull().default('actif'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One active assignment per employee (enforced in application code).
export const assignments = people.table('assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  startDate: date('start_date', { mode: 'date' }).notNull(),
  endDate: date('end_date', { mode: 'date' }),
  // Phase 3 — pay basis for the labour-cost rollup. Both nullable: a freshly
  // created assignment may carry no rate yet (dues fall back to 0 in
  // labor.domain). rateType ∈ {'jour','mois'} — validated at the edge; a 'mois'
  // rate is divided by WORKING_DAYS_PER_MONTH to get the effective daily rate.
  rateType: text('rate_type'),
  rateAmountMad: numeric('rate_amount_mad', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Pointage — one logged work day per assignment. daysWorked allows half-days
// (0.5). Logging the same (assignment, date) UPSERTS (idempotent back-fill) so a
// re-submitted pointage replaces daysWorked + notes instead of double-counting.
export const workDays = people.table(
  'work_day',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    workDate: date('work_date', { mode: 'date' }).notNull(),
    daysWorked: numeric('days_worked', { precision: 4, scale: 2 })
      .notNull()
      .default('1'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Work days are always read per assignment — keep that list query off a seq
    // scan as the pointage log grows.
    index('work_day_assignment_id_idx').on(table.assignmentId),
    // One pointage per (assignment, day): lets a re-submitted log UPSERT on the
    // natural key instead of duplicating the day in the labour-cost rollup.
    uniqueIndex('work_day_assignment_date_uniq').on(
      table.assignmentId,
      table.workDate,
    ),
  ],
);

export const comms = pgSchema('comms');

// Delivery outbox — every outbound message is recorded before sending.
// Real transports (SMTP/WhatsApp) activate via env; until then the console
// transport proves the pipeline and the outbox is the audit trail.
export const outbox = comms.table('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('en_attente'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const buyers = tender.table('buyer', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  buyerType: text('buyer_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenders = tender.table('tender', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: text('company_id').notNull().default('agha-rm-infra'),
  reference: text('reference').notNull(),
  buyerId: uuid('buyer_id').references(() => buyers.id),
  buyerName: text('buyer_name').notNull(),
  procedure: text('procedure').notNull(),
  objet: text('objet').notNull(),
  estimationMad: numeric('estimation_mad', { precision: 14, scale: 2 }),
  cautionProvisoireMad: numeric('caution_provisoire_mad', { precision: 14, scale: 2 }),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  pipelineState: text('pipeline_state').notNull().default('detected'),
  qualification: jsonb('qualification'),
  sourceUrl: text('source_url'),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Phase 0 — Socle de vérité ────────────────────────────────────────────────

// The reward signal: the real result of OUR bids joined to the price we
// proposed. Without this table no learning loop can close (recon: déficit #0).
export const submissionOutcomes = tender.table('submission_outcome', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id),
  result: text('result').notNull(),
  montantSoumisMad: numeric('montant_soumis_mad', { precision: 14, scale: 2 }),
  rabaisRetenuPct: numeric('rabais_retenu_pct', { precision: 5, scale: 2 }),
  scenarioChoisi: text('scenario_choisi'),
  ourRank: integer('our_rank'),
  winnerAmountMad: numeric('winner_amount_mad', { precision: 14, scale: 2 }),
  gapToFirstPct: numeric('gap_to_first_pct', { precision: 7, scale: 2 }),
  motifRejet: text('motif_rejet'),
  lessons: jsonb('lessons'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only transition history — replaces the single mutable pipeline_state
// column so we can measure stage durations and detected→won conversion.
export const tenderEvents = tender.table('tender_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenderId: uuid('tender_id')
    .notNull()
    .references(() => tenders.id),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Portal mirror — read-only image of the authenticated MPE account ─────────
// A faithful, idempotent mirror of what the AGHID CONSTRUCTION account itself
// shows on marchespublics.gov.ma: "Mes réponses" and "Mes cautions". This is
// the company's own ground truth (what WE submitted, what WE locked), distinct
// from the public-portal watch and the competitor intel above.
export const portal = pgSchema('portal');

// "Mes réponses" — one row per soumission we deposited on the portal.
export const portalSubmissions = portal.table(
  'submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    procedure: text('procedure'),
    category: text('category'),
    objet: text('objet'),
    organisme: text('organisme'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // The portal's internal consultation id — the eventual true key, but absent
    // from the listing rows, so nullable until a detail crawl back-fills it.
    consultationId: text('consultation_id'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // reference alone is NOT unique — the same short ref recurs across years and
    // re-issued consultations — so the deadline disambiguates the soumission.
    uniqueIndex('portal_submission_ref_deadline_uniq').on(
      table.reference,
      table.deadlineAt,
    ),
  ],
);

// "Mes cautions" — one row per caution (bank guarantee) requested via the portal.
export const portalCautions = portal.table(
  'caution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    procedure: text('procedure'),
    category: text('category'),
    objet: text('objet'),
    organisme: text('organisme'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    bankName: text('bank_name'),
    intitule: text('intitule'),
    // NOT NULL with a 0 sentinel so it can anchor the unique index (NULL <> NULL
    // would defeat dedup for amount-less brouillon cautions). 0 reads back as
    // "no amount" — see listCautions and the unique-index note below.
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    statut: text('statut'),
    demandeFile: text('demande_file'),
    consultationId: text('consultation_id'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Same recurring-reference caveat as submissions; the amount further
    // distinguishes multiple cautions filed against one consultation.
    //
    // amount_mad is NOT NULL with a 0 default so it can sit in the unique key:
    // a brouillon caution carries no amount yet, and in Postgres NULL <> NULL
    // inside a unique index would let two amount-less rows for the same
    // (reference, deadline) escape the conflict, duplicating on every harvest.
    // The sentinel 0 (a real caution is always a positive guarantee) collapses
    // all amount-less rows for one (reference, deadline) into a single conflict
    // group while preserving distinct positive amounts. listCautions maps 0 back
    // to `undefined` on read, so callers still see "no amount". The repository
    // upsert writes 0 for a missing amount and the in-memory matcher folds the
    // same way, keeping both implementations identical.
    uniqueIndex('portal_caution_ref_deadline_amount_uniq').on(
      table.reference,
      table.deadlineAt,
      table.amountMad,
    ),
  ],
);

// ── Stock & matériaux — native warehouse/site materials ledger ───────────────
// Materials and depots are the dimensions; every quantity change is an
// append-only stock_movement event. Balances and per-chantier consumption are
// derived in stock.domain from the event log — the tables hold no running total.
export const stock = pgSchema('stock');

// A material reference (sac de ciment, m3 de béton, tonne d'acier…). Unit and
// optional standard cost live here; cost can be overridden per movement.
export const materials = stock.table(
  'material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    code: text('code').notNull(),
    designation: text('designation').notNull(),
    // e.g. 'sac','m3','tonne','u','kg','ml' — free text, validated at the edge.
    unit: text('unit').notNull(),
    category: text('category'),
    unitCostMad: numeric('unit_cost_mad', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One material per (company, code): lets re-imports upsert on the code
    // instead of duplicating the reference.
    uniqueIndex('stock_material_company_code_uniq').on(
      table.companyId,
      table.code,
    ),
  ],
);

// A storage location — central depot or a chantier's on-site stock.
export const depots = stock.table(
  'depot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    name: text('name').notNull(),
    location: text('location'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One depot per (company, name): the natural upsert key for re-imports.
    uniqueIndex('stock_depot_company_name_uniq').on(table.companyId, table.name),
  ],
);

// Append-only event log: no update/delete path exists in application code.
// kind ∈ {'initial','purchase','transfer','consumption','adjustment'}. Balances
// and project consumption are folded from these rows in stock.domain; there is
// deliberately NO unique constraint — every harvest is a distinct event.
export const stockMovements = stock.table(
  'stock_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    // Optional override of the material's standard cost for this movement.
    unitCostMad: numeric('unit_cost_mad', { precision: 14, scale: 2 }),
    // Source depot — set for consumption/transfer/adjustment-out; null otherwise.
    fromDepotId: uuid('from_depot_id').references(() => depots.id),
    // Destination depot — set for initial/purchase/transfer/adjustment-in.
    toDepotId: uuid('to_depot_id').references(() => depots.id),
    // The chantier consuming the material (site consumption only); null otherwise.
    projectId: uuid('project_id').references(() => projects.id),
    reference: text('reference'),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The four FK columns each back a hot read path folded from this log:
    // per-material balance roll-ups, per-depot stock queries (source/dest), and
    // per-chantier consumption. Plain btree indexes keep those from degrading to
    // sequential scans as the append-only event log grows.
    index('stock_movement_material_id_idx').on(table.materialId),
    index('stock_movement_from_depot_id_idx').on(table.fromDepotId),
    index('stock_movement_to_depot_id_idx').on(table.toDepotId),
    index('stock_movement_project_id_idx').on(table.projectId),
  ],
);

// ── Commercial / Ventes — private-job customer master + sales documents ───────
// Distinct from tender.buyer (PUBLIC-procurement acheteurs): sales.client is the
// SEPARATE commercial customer master for private jobs — devis, bons de livraison
// and factures. Quote/invoice totals (HT, TVA, TTC) are computed in sales.domain
// and persisted alongside the parent; lines mirror the situations/avenants
// parent+lines pattern. Money as numeric(14,2), pct as numeric(5,2).
export const sales = pgSchema('sales');

// A commercial customer (private client), the natural upsert key being
// (company_id, name) so re-imports back-fill instead of duplicating.
export const clients = sales.table(
  'client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    name: text('name').notNull(),
    /** Identifiant Commun de l'Entreprise — Moroccan business id. */
    ice: text('ice'),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    status: text('status').notNull().default('actif'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One client per (company, name): the natural upsert key for re-imports.
    uniqueIndex('sales_client_company_name_uniq').on(table.companyId, table.name),
  ],
);

// Devis — a price quote to a client. status ∈ {brouillon,envoye,accepte,refuse,
// expire}, validated at the edge. Totals folded in sales.domain on create.
export const quotes = sales.table(
  'quote',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    reference: text('reference').notNull(),
    objet: text('objet'),
    status: text('status').notNull().default('brouillon'),
    quoteDate: date('quote_date', { mode: 'date' }).notNull(),
    validUntil: date('valid_until', { mode: 'date' }),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Reference is unique per company; lists scope by client.
    uniqueIndex('sales_quote_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_quote_client_id_idx').on(table.clientId),
  ],
);

// Quote line items — inserted with the parent quote (situations/avenants pattern).
export const quoteLines = sales.table(
  'quote_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the quote — deleting the parent cascades.
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [index('sales_quote_line_quote_id_idx').on(table.quoteId)],
);

// Bon de livraison — a delivery note, optionally born from a quote.
// status ∈ {brouillon,livre}, validated at the edge.
export const deliveryNotes = sales.table(
  'delivery_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    quoteId: uuid('quote_id').references(() => quotes.id),
    reference: text('reference').notNull(),
    deliveryDate: date('delivery_date', { mode: 'date' }).notNull(),
    status: text('status').notNull().default('brouillon'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_delivery_note_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_delivery_note_client_id_idx').on(table.clientId),
  ],
);

// Delivery line items — quantities only (no price); inserted with the parent.
export const deliveryLines = sales.table(
  'delivery_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the BL — deleting the parent cascades.
    deliveryNoteId: uuid('delivery_note_id')
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    orderIndex: integer('order_index').default(0),
  },
  (table) => [
    index('sales_delivery_line_delivery_note_id_idx').on(table.deliveryNoteId),
  ],
);

// Facture — an invoice to a client, optionally linked to a quote.
// status ∈ {brouillon,envoyee,payee,annulee}. Totals folded in sales.domain.
export const invoices = sales.table(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    quoteId: uuid('quote_id').references(() => quotes.id),
    reference: text('reference').notNull(),
    invoiceDate: date('invoice_date', { mode: 'date' }).notNull(),
    dueDate: date('due_date', { mode: 'date' }),
    status: text('status').notNull().default('brouillon'),
    totalHtMad: numeric('total_ht_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaPct: numeric('tva_pct', { precision: 5, scale: 2 }).notNull().default('20'),
    totalTtcMad: numeric('total_ttc_mad', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    paidAt: date('paid_at', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_invoice_company_reference_uniq').on(
      table.companyId,
      table.reference,
    ),
    index('sales_invoice_client_id_idx').on(table.clientId),
  ],
);

// ── Matériel & engins — equipment register + chantier assignment ─────────────
// Machines and tools (distinct from people.assignment, which posts WORKERS to a
// chantier): equipment.equipment is the inventory dimension; equipment.assignment
// posts a MACHINE to a project with a date de retour prévue. status mirrors the
// open-assignment lifecycle — 'disponible' when idle, 'assignee' while posted,
// 'hors_service' when broken. assign/return move status transactionally so the
// inventory and the assignment log never disagree.
export const equipment = pgSchema('equipment');

export const equipments = equipment.table(
  'equipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: text('company_id').notNull().default('agha-rm-infra'),
    code: text('code'),
    name: text('name').notNull(),
    category: text('category'),
    // status ∈ {'disponible','assignee','hors_service'} — validated at the edge
    // and enforced by the equipment.domain transition guards on assign/return.
    status: text('status').notNull().default('disponible'),
    acquisitionDate: date('acquisition_date', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One machine per (company, name): lets re-imports upsert on the name
    // instead of duplicating the reference.
    uniqueIndex('equipment_company_name_uniq').on(table.companyId, table.name),
    // The availability board reads by status — keep it off a seq scan.
    index('equipment_status_idx').on(table.status),
    // Defence-in-depth: the domain guards (assertAssign/assertReturn/
    // assertSetStatus) live in application code; this DB-level CHECK stops any
    // direct INSERT/UPDATE (migration, DB admin, another service) from writing
    // an unrecognised status that would crash the status-badge UI. Literals
    // mirror EQUIPMENT_STATUSES in equipment.domain — keep the two in sync.
    check(
      'equipment_status_check',
      sql`${table.status} IN ('disponible', 'assignee', 'hors_service')`,
    ),
  ],
);

// One posting of a machine to a chantier. An OPEN row (returnedAt null) is the
// machine's current assignment; closing it (returnedAt set) frees the machine.
export const equipmentAssignments = equipment.table(
  'assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipments.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    assignedAt: date('assigned_at', { mode: 'date' }).notNull(),
    // Date de retour prévue — when the machine is expected back; null if open-ended.
    expectedReturnAt: date('expected_return_at', { mode: 'date' }),
    // Set when the machine is returned; null while the assignment is open.
    returnedAt: date('returned_at', { mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two hot read paths: a machine's assignment history and a chantier's
    // current fleet. Plain btree indexes keep both off a seq scan as the log grows.
    index('equipment_assignment_equipment_id_idx').on(table.equipmentId),
    index('equipment_assignment_project_id_idx').on(table.projectId),
  ],
);

// Invoice line items — inserted with the parent invoice.
export const invoiceLines = sales.table(
  'invoice_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lines are subordinate parts of the invoice — deleting the parent cascades.
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit'),
    unitPriceMad: numeric('unit_price_mad', { precision: 14, scale: 2 }).notNull(),
    lineTotalMad: numeric('line_total_mad', { precision: 14, scale: 2 }).notNull(),
    orderIndex: integer('order_index').default(0),
  },
  (table) => [index('sales_invoice_line_invoice_id_idx').on(table.invoiceId)],
);
