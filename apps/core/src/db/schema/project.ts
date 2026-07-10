// pg schema: project — chantiers, situations, avenants, journaux & tâches.
import {
  boolean,
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
import { sql } from 'drizzle-orm';
import { tenders } from './tender';

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
  // ── Fields ported from the BTP construction-management app (marché de travaux
  //    details); all nullable/additive so existing chantier rows are untouched.
  objet: text('objet'), // full marché object (long); `name` stays the short label
  annee: text('annee'),
  societe: text('societe'), // entreprise attributaire (our company / groupement)
  commune: text('commune'),
  typeMarche: text('type_marche'), // 'normal' | 'negocie'
  modePassation: text('mode_passation'),
  dateOuverture: date('date_ouverture', { mode: 'date' }),
  receptionProvisoire: date('reception_provisoire', { mode: 'date' }),
  receptionDefinitive: date('reception_definitive', { mode: 'date' }),
  achevementTravaux: date('achevement_travaux', { mode: 'date' }),
  assistanceTechnique: text('assistance_technique'),
  maitreOeuvre: text('maitre_oeuvre'),
  progressPct: numeric('progress_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  // Identité administrative de la société attributaire.
  rc: text('rc'),
  cb: text('cb'),
  cnss: text('cnss'),
  patente: text('patente'),
  // Imputation budgétaire du marché.
  programme: text('programme'),
  projetLibelle: text('projet_libelle'),
  ligneBudgetaire: text('ligne_budgetaire'),
  chapitre: text('chapitre'),
  // Arrêts de travaux: [{ id, dateArret, dateReprise?, motif }] — feeds the
  // délai effectif (date fin initiale + jours d'arrêt).
  arrets: jsonb('arrets').notNull().default('[]'),
  // Comment NOTRE société a obtenu ce marché — pilote le wizard de création et
  // les champs affichés. ao_direct | bon_commande | sous_traitance |
  // groupement | marche_prive (validé à l'edge, zod).
  modeObtention: text('mode_obtention').notNull().default('ao_direct'),
  // Payload spécifique au mode: titulaire principal + part (sous-traitance),
  // membres/quote-parts/mandataire (groupement), client + devis (privé),
  // n° BC (bon de commande ≤500k DH), mode de passation détaillé (direct).
  acquisition: jsonb('acquisition').notNull().default('{}'),
  // Original btpdb ids, kept for traceability/idempotence of migrated rows.
  legacyUserId: uuid('legacy_user_id'),
  legacyProjectId: uuid('legacy_project_id'),
  // Corbeille: soft-deleted projects are restorable from the trash page.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Situation de travaux / décompte provisoire (CCAG-T): cumulative amounts;
// the period delta + retenue de garantie are derived in the domain layer.
export const situations = project.table(
  'situation',
  {
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
  },
  (table) => [
    // Situations are always read per chantier — keep that list query off a seq scan.
    index('situation_project_id_idx').on(table.projectId),
  ],
);

// Avenant — contract amendment (CCAG-T art. 51/52/54): changes amount and/or
// delay, can edit bordereau lines (modifications) or add prix nouveaux. The
// décompte ceiling becomes montant marché + sum of approved avenant deltas.
export const avenants = project.table(
  'avenant',
  {
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
    // Nullable since the BTP rebuild: a brouillon has no approval date yet.
    approvedAt: date('approved_at', { mode: 'date' }),
    // ── BTP registre fields (ported from the source app) ──
    reference: text('reference'),
    typeAvenant: text('type_avenant').notNull().default('modification'), // modification|prix_nouveaux|mixte|diminution
    statut: text('statut').notNull().default('brouillon'), // brouillon|en_attente|approuve|rejete|annule
    dateAvenant: date('date_avenant', { mode: 'date' }),
    dateNotification: date('date_notification', { mode: 'date' }),
    dateApprobation: date('date_approbation', { mode: 'date' }),
    montantInitialMad: numeric('montant_initial_mad', { precision: 14, scale: 2 }),
    montantNouveauMad: numeric('montant_nouveau_mad', { precision: 14, scale: 2 }),
    pourcentageVariation: numeric('pourcentage_variation', { precision: 8, scale: 4 }),
    // [{ bordereauLigneId, action, ancienneQuantite, nouvelleQuantite, ancienPrix, nouveauPrix, designation, unite, montantDifference }]
    modifications: jsonb('modifications').notNull().default('[]'),
    // [{ id, numero, designation, unite, quantite, prixUnitaire, montant }]
    prixNouveaux: jsonb('prix_nouveaux').notNull().default('[]'),
    observations: text('observations'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Avenants are always read per chantier — keep that list query off a seq scan.
    index('avenant_project_id_idx').on(table.projectId),
  ],
);

// Journal de chantier — daily site report filed by the terrain role.
// One report per project per day (enforced in application code).
export const dailyLogs = project.table(
  'daily_log',
  {
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
    // ── Rapport de chantier enrichi (0047) — saisie terrain par le chef ──
    heuresTravail: numeric('heures_travail', { precision: 4, scale: 1 }),
    visites: text('visites'),
    avancement: text('avancement'),
    // ids d'assets photo (project_asset) joints au rapport du jour.
    photoIds: jsonb('photo_ids').notNull().default('[]'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Daily logs are always read per chantier — keep that list query off a seq scan.
    index('daily_log_project_id_idx').on(table.projectId),
  ],
);

// ── Saisie terrain (0047) — le chef de chantier alimente le suivi réel ──────
// Matériel/engins utilisés sur le chantier: heures machine + carburant +
// location. equipmentId relie (sans FK dure) au module /equipment quand
// l'engin est référencé; `engin` reste le libellé affiché.
export const chantierMateriel = project.table(
  'chantier_materiel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    date: date('date', { mode: 'date' }).notNull(),
    engin: text('engin').notNull(),
    equipmentId: uuid('equipment_id'),
    regime: text('regime').notNull().default('propre'), // propre | location
    heuresUtilisation: numeric('heures_utilisation', { precision: 6, scale: 1 }),
    carburantL: numeric('carburant_l', { precision: 8, scale: 1 }),
    coutCarburantMad: numeric('cout_carburant_mad', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    coutLocationMad: numeric('cout_location_mad', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    note: text('note'),
    saisiPar: text('saisi_par').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chantier_materiel_project_date_idx').on(table.projectId, table.date)],
);

// Consommations matériaux (sortie réelle sur chantier): article libre +
// quantité + coût; bonLivraison/fournisseur tracent la provenance.
export const chantierConsommations = project.table(
  'chantier_consommation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    date: date('date', { mode: 'date' }).notNull(),
    article: text('article').notNull(),
    unite: text('unite').notNull().default('u'),
    quantite: numeric('quantite', { precision: 12, scale: 3 }).notNull(),
    prixUnitaireMad: numeric('prix_unitaire_mad', { precision: 12, scale: 2 }),
    coutMad: numeric('cout_mad', { precision: 12, scale: 2 }).notNull().default('0'),
    fournisseur: text('fournisseur'),
    bonLivraison: text('bon_livraison'),
    note: text('note'),
    saisiPar: text('saisi_par').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chantier_consommation_project_date_idx').on(table.projectId, table.date)],
);

// Attachement terrain — quantités RÉALISÉES par ligne du bordereau, saisies
// par le chef de chantier. ligneId référence l'id de la ligne dans le jsonb du
// bordereau (designation/unite snapshotées); l'administratif les INTÈGRE
// ensuite dans le métré officiel (statut saisi → integre).
export const chantierAttachements = project.table(
  'chantier_attachement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    date: date('date', { mode: 'date' }).notNull(),
    ligneId: text('ligne_id').notNull(),
    numeroPrix: text('numero_prix'),
    designation: text('designation').notNull(),
    unite: text('unite').notNull(),
    quantite: numeric('quantite', { precision: 14, scale: 3 }).notNull(),
    note: text('note'),
    statut: text('statut').notNull().default('saisi'), // saisi | integre
    saisiPar: text('saisi_par').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chantier_attachement_project_date_idx').on(table.projectId, table.date)],
);

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

// ============================================================================
// BTP execution tables — faithful port of the source construction-management
// app: bordereau (BPU) → périodes → métré hiérarchique → décompte auto-généré,
// plus révision des prix, registres (avenants/ODS/pénalités/cautions/retenues/
// validations) and the photothèque/PV/documents store. Line items live in jsonb
// exactly as in the source app; engine-computed totals are persisted as columns
// so list reads never re-run the engine.
// ============================================================================

// Bordereau des prix (BPU) — the priced bill of quantities for a chantier.
// lignes: [{ id, numero, designation, unite, quantite, prixUnitaire, montant }]
export const bordereaux = project.table(
  'bordereau',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    reference: text('reference'),
    designation: text('designation'),
    lignes: jsonb('lignes').notNull().default('[]'),
    // Montant HT du bordereau (Σ lignes.montant) — saving a bordereau also
    // refreshes projects.montant_marche_mad (TTC) through the engine.
    montantTotalMad: numeric('montant_total_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bordereau_project_id_idx').on(table.projectId)],
);

// Période — "Métré N°X": a billing period. Creating one auto-creates its empty
// décompte shell (same numero), exactly like the source app's "Nouveau métré".
export const periodes = project.table(
  'periode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    numero: integer('numero').notNull(),
    libelle: text('libelle'),
    dateDebut: date('date_debut', { mode: 'date' }),
    dateFin: date('date_fin', { mode: 'date' }),
    tauxTva: numeric('taux_tva', { precision: 5, scale: 2 }).notNull().default('20'),
    tauxRetenue: numeric('taux_retenue', { precision: 5, scale: 2 }).notNull().default('10'),
    // "Décompte et dernier": flags the contract's FINAL décompte — switches the
    // récap to travaux terminés and enables the révision des prix application.
    isDecompteDernier: boolean('is_decompte_dernier').notNull().default(false),
    statut: text('statut').notNull().default('en_cours'), // en_cours|validee|facturee
    observations: text('observations'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('periode_project_id_idx').on(table.projectId),
    uniqueIndex('periode_project_numero_uq')
      .on(table.projectId, table.numero)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// Métré — one row per bordereau line × période. Hierarchy: sections (lieu/douar)
// → sous-sections (élément, with optional nombreElements multiplier for rebar)
// → lignes (measurements: nombreSemblables/longueur/largeur/profondeur/nombre/
// diametre → partiel, computed per the bordereau line's unité).
export const metres = project.table(
  'metre',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    periodeId: uuid('periode_id')
      .notNull()
      .references(() => periodes.id),
    // Join key to the bordereau line: "{bordereauId}-ligne-{numero}".
    bordereauLigneId: text('bordereau_ligne_id').notNull(),
    designationBordereau: text('designation_bordereau'),
    unite: text('unite'),
    sections: jsonb('sections').notNull().default('[]'),
    sousSections: jsonb('sous_sections').notNull().default('[]'),
    lignes: jsonb('lignes').notNull().default('[]'),
    // Contribution of THIS période alone (stored rounded half-up, 2dp).
    totalPartiel: numeric('total_partiel', { precision: 15, scale: 4 }).notNull().default('0'),
    // Previous périodes + this one.
    totalCumule: numeric('total_cumule', { precision: 15, scale: 4 }).notNull().default('0'),
    quantiteBordereau: numeric('quantite_bordereau', { precision: 15, scale: 4 })
      .notNull()
      .default('0'),
    pourcentageRealisation: numeric('pourcentage_realisation', { precision: 8, scale: 2 })
      .notNull()
      .default('0'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('metre_project_id_idx').on(table.projectId),
    index('metre_periode_id_idx').on(table.periodeId),
  ],
);

// Décompte — auto-generated from the métré on every save (cumulative model:
// quantiteRealisee = Σ partiels of every période ≤ this one). Persists the full
// récapitulatif so finance reads never re-run the engine.
export const decomptes = project.table(
  'decompte',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    periodeId: uuid('periode_id').references(() => periodes.id),
    numero: integer('numero').notNull(),
    dateDecompte: date('date_decompte', { mode: 'date' }),
    // [{ prixNo, designation, unite, quantiteBordereau, quantiteRealisee,
    //    prixUnitaireHT, montantHT, bordereauLigneId }]
    lignes: jsonb('lignes').notNull().default('[]'),
    tauxTva: numeric('taux_tva', { precision: 5, scale: 2 }).notNull().default('20'),
    // Cumulative gross work to date (HT), before révision.
    totalHtMad: numeric('total_ht_mad', { precision: 15, scale: 2 }).notNull().default('0'),
    // Révision des prix applied on the décompte dernier (0 otherwise).
    revisionMontantMad: numeric('revision_montant_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    montantTvaMad: numeric('montant_tva_mad', { precision: 15, scale: 2 }).notNull().default('0'),
    // Cumulative TTC (after révision when applied) — drives the progress %.
    totalTtcMad: numeric('total_ttc_mad', { precision: 15, scale: 2 }).notNull().default('0'),
    // Récapitulatif: dépenses des exercices antérieurs / acomptes de l'exercice
    // en cours (split of prior décomptes by fiscal year), retenue de garantie
    // (MIN(TRUNC(TTC×10%), TRUNC(marché TTC×7%))) and the net acompte à payer.
    depensesAnterieuresMad: numeric('depenses_anterieures_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    decomptesPrecedentsMad: numeric('decomptes_precedents_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    retenueGarantieMad: numeric('retenue_garantie_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    montantAcompteMad: numeric('montant_acompte_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    isDernier: boolean('is_dernier').notNull().default(false),
    statut: text('statut').notNull().default('draft'), // draft|submitted|validated|paid
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decompte_project_id_idx').on(table.projectId),
    // At most one live décompte per période (the métré-driven upsert relies on
    // this; also blocks concurrent double-saves that would double-count in the
    // cumulative "décomptes précédents"). Nulls excluded so manual,
    // période-less décomptes remain allowed.
    uniqueIndex('decompte_project_periode_uq')
      .on(table.projectId, table.periodeId)
      .where(sql`${table.periodeId} is not null and ${table.deletedAt} is null`),
    uniqueIndex('decompte_project_numero_uq')
      .on(table.projectId, table.numero)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// Révision des prix — reusable index-revision formula (P = P0·[a + Σ wᵢ·Iᵢ/Iᵢ0]).
export const revisionFormulas = project.table('revision_formula', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  fixedPart: numeric('fixed_part', { precision: 6, scale: 4 }).notNull().default('0.15'),
  // { "At": 0.20, "Cs": 0.25, … } — dynamic index weights.
  weights: jsonb('weights').notNull().default('{}'),
  isDefault: boolean('is_default').notNull().default(false),
  isPublic: boolean('is_public').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Monthly official index values (one row per month, "Gestion des Index").
export const revisionIndexes = project.table('revision_index', {
  id: uuid('id').primaryKey().defaultRandom(),
  monthDate: date('month_date', { mode: 'date' }).notNull().unique(),
  // { "At": 306.7, "Cs": 134.6, … }
  indexValues: jsonb('index_values').notNull().default('{}'),
  source: text('source'),
  notes: text('notes'),
  status: text('status').notNull().default('provisoire'), // provisoire|definitif
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Audit trail of index edits (create/update/delete/status_change/import).
export const revisionIndexAudit = project.table(
  'revision_index_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    monthDate: date('month_date', { mode: 'date' }),
    action: text('action').notNull(),
    actorSub: text('actor_sub'),
    actorName: text('actor_name'),
    changes: jsonb('changes'),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('revision_index_audit_month_idx').on(table.monthDate)],
);

// Per-chantier révision configuration (chosen formula + base-period indexes).
export const projectRevisionConfig = project.table('project_revision_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  formulaId: uuid('formula_id').references(() => revisionFormulas.id),
  baseIndexes: jsonb('base_indexes').notNull().default('{}'),
  baseDate: date('base_date', { mode: 'date' }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Computed révision persisted per décompte (coefficient + montant + trace).
export const decompteRevisions = project.table(
  'decompte_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decompteId: uuid('decompte_id')
      .notNull()
      .unique()
      .references(() => decomptes.id),
    montantAReviser: numeric('montant_a_reviser', { precision: 15, scale: 2 }),
    coefficientApplique: numeric('coefficient_applique', { precision: 12, scale: 6 }),
    montantRevision: numeric('montant_revision', { precision: 15, scale: 2 }),
    calculationDetails: jsonb('calculation_details'),
    formulaSnapshot: jsonb('formula_snapshot'),
    baseIndexesSnapshot: jsonb('base_indexes_snapshot'),
    status: text('status').notNull().default('calculated'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('decompte_revision_decompte_id_idx').on(table.decompteId)],
);

// ============================================================================
// Registres du marché: ODS, pénalités, cautions, retenues, validations.
// ============================================================================

// Ordre de service (CCAG-T art. 9/10) — strict status machine:
// brouillon → emis → notifie → accuse → execute → cloture (+ annule).
export const ordresService = project.table(
  'ordre_service',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    numero: integer('numero').notNull(),
    reference: text('reference'),
    // commencement|arret|reprise|modification|travaux_supplementaires|
    // prolongation|reception_provisoire|reception_definitive|mise_en_demeure|autre
    type: text('type').notNull().default('commencement'),
    objet: text('objet').notNull(),
    description: text('description'),
    motif: text('motif'),
    dateEmission: date('date_emission', { mode: 'date' }),
    dateEffet: date('date_effet', { mode: 'date' }),
    dateFin: date('date_fin', { mode: 'date' }),
    delaiJours: integer('delai_jours'),
    impactFinancierMad: numeric('impact_financier_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    impactDelaiJours: integer('impact_delai_jours').notNull().default(0),
    emetteur: text('emetteur'),
    emetteurFonction: text('emetteur_fonction'),
    destinataire: text('destinataire'),
    avenantId: uuid('avenant_id').references(() => avenants.id),
    statut: text('statut').notNull().default('brouillon'),
    dateNotification: date('date_notification', { mode: 'date' }),
    dateAccuseReception: date('date_accuse_reception', { mode: 'date' }),
    accusePar: text('accuse_par'),
    observationsDestinataire: text('observations_destinataire'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ods_project_id_idx').on(table.projectId)],
);

// Pénalité (CCAG-T art. 60): montant = base × taux × jours, plafonné à
// plafond% du marché; montant appliqué = MIN(montant, plafond).
export const penalites = project.table(
  'penalite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    type: text('type').notNull().default('retard'), // retard|malfacon|non_conformite|securite|environnement|autre
    dateDebut: date('date_debut', { mode: 'date' }),
    dateFin: date('date_fin', { mode: 'date' }),
    nombreJours: integer('nombre_jours').notNull().default(0),
    taux: numeric('taux', { precision: 8, scale: 5 }).notNull().default('0.001'),
    baseCalculMad: numeric('base_calcul_mad', { precision: 15, scale: 2 }),
    montantPenaliteMad: numeric('montant_penalite_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    plafondPourcentage: numeric('plafond_pourcentage', { precision: 5, scale: 2 })
      .notNull()
      .default('10'),
    montantPlafondMad: numeric('montant_plafond_mad', { precision: 15, scale: 2 }),
    montantAppliqueMad: numeric('montant_applique_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    statut: text('statut').notNull().default('calculee'), // calculee|notifiee|contestee|appliquee|annulee|remise
    referenceNotification: text('reference_notification'),
    dateNotification: date('date_notification', { mode: 'date' }),
    motif: text('motif'),
    observations: text('observations'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('penalite_project_id_idx').on(table.projectId)],
);

// Caution / garantie bancaire (CCAG-T art. 12/13/40). Export named cautionsBtp
// because the finance schema already exports `cautions` through the barrel.
export const cautionsBtp = project.table(
  'caution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    // caution_provisoire|caution_definitive|retenue_garantie|caution_avance|
    // caution_bonne_execution|garantie_decennale
    type: text('type').notNull(),
    montantMad: numeric('montant_mad', { precision: 15, scale: 2 }).notNull().default('0'),
    pourcentage: numeric('pourcentage', { precision: 5, scale: 2 }),
    baseCalculMad: numeric('base_calcul_mad', { precision: 15, scale: 2 }),
    organisme: text('organisme'),
    referenceOrganisme: text('reference_organisme'),
    dateEmission: date('date_emission', { mode: 'date' }),
    dateExpiration: date('date_expiration', { mode: 'date' }),
    dateMainlevee: date('date_mainlevee', { mode: 'date' }),
    statut: text('statut').notNull().default('active'), // en_attente|active|expiree|liberee|saisie|annulee
    observations: text('observations'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('caution_project_id_idx').on(table.projectId)],
);

// Retenue de garantie tracker — one row per décompte retention, releasable.
export const retenues = project.table(
  'retenue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    cautionId: uuid('caution_id').references(() => cautionsBtp.id),
    decompteId: uuid('decompte_id').references(() => decomptes.id),
    decompteNumero: integer('decompte_numero'),
    montantDecompteMad: numeric('montant_decompte_mad', { precision: 15, scale: 2 }),
    tauxRetenue: numeric('taux_retenue', { precision: 5, scale: 2 }).notNull().default('7'),
    montantRetenueMad: numeric('montant_retenue_mad', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    montantCumuleMad: numeric('montant_cumule_mad', { precision: 15, scale: 2 }),
    liberee: boolean('liberee').notNull().default(false),
    dateLiberation: date('date_liberation', { mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('retenue_project_id_idx').on(table.projectId)],
);

// Circuit de validation — multi-step approval attached to any document.
export const approvalRequests = project.table(
  'approval_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    documentType: text('document_type').notNull(), // decompte|avenant|pv|ods|attachement|autre
    documentId: text('document_id'),
    documentReference: text('document_reference'),
    status: text('status').notNull().default('en_attente'), // en_attente|en_cours|approuve|rejete|annule
    currentStep: integer('current_step').notNull().default(1),
    totalSteps: integer('total_steps').notNull().default(1),
    priority: text('priority').notNull().default('normal'), // basse|normal|haute|urgente
    dueDate: date('due_date', { mode: 'date' }),
    note: text('note'),
    montantMad: numeric('montant_mad', { precision: 15, scale: 2 }),
    requestedBy: text('requested_by'),
    requestedByName: text('requested_by_name'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('approval_request_project_id_idx').on(table.projectId)],
);

export const approvalSteps = project.table(
  'approval_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id),
    stepOrder: integer('step_order').notNull(),
    stepLabel: text('step_label').notNull(),
    role: text('role'),
    status: text('status').notNull().default('en_attente'), // en_attente|en_cours|approuve|rejete|renvoye
    decidedBy: text('decided_by'),
    decidedByName: text('decided_by_name'),
    decisionDate: timestamp('decision_date', { withTimezone: true }),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('approval_step_request_id_idx').on(table.requestId)],
);

export const approvalHistory = project.table(
  'approval_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id),
    stepId: uuid('step_id').references(() => approvalSteps.id),
    action: text('action').notNull(),
    actorSub: text('actor_sub'),
    actorName: text('actor_name'),
    comment: text('comment'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('approval_history_request_id_idx').on(table.requestId)],
);

// ============================================================================
// Photothèque, PV et documents (project_assets unifié, stockage MinIO).
// ============================================================================

export const photoAlbums = project.table(
  'photo_album',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#22d3ee'),
    icon: text('icon').notNull().default('folder'),
    sortOrder: integer('sort_order').notNull().default(0),
    periodeId: uuid('periode_id').references(() => periodes.id),
    createdBy: text('created_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('photo_album_project_id_idx').on(table.projectId)],
);

// Unified asset store: photos, PV (structured metadata) and documents.
// Files live in object storage (MinIO) under storage_key; metadata carries
// the PV type/fields, photo description/GPS, document category…
export const projectAssets = project.table(
  'project_asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    type: text('type').notNull(), // photo|pv|document
    fileName: text('file_name'),
    originalName: text('original_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    storageKey: text('storage_key'),
    sha256: text('sha256'),
    albumId: uuid('album_id').references(() => photoAlbums.id),
    metadata: jsonb('metadata').notNull().default('{}'),
    createdBy: text('created_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('project_asset_project_id_idx').on(table.projectId),
    index('project_asset_project_type_idx').on(table.projectId, table.type),
  ],
);
