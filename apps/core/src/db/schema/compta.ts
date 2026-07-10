// pg schema: compta — comptabilité marocaine (CGNC) : plan de comptes, journaux
// & écritures en partie double, TVA, déclarations fiscales & sociales,
// immobilisations, banques, documents légaux et profil fiscal de l'entreprise.
//
// Conventions (mêmes que le reste d'ATLAS) : montants numeric(14,2) en MAD,
// pourcentages numeric(6,3), dates métier `date` (mode 'date'), horodatage
// timestamptz. Les comptes sont identifiés par leur CODE CGNC (texte, stable,
// humain) — pas d'uuid intermédiaire, comme le fait le module BTP avec les
// numéros de prix du bordereau.
import { sql } from 'drizzle-orm';
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

export const compta = pgSchema('compta');

// ── Profil fiscal & légal de l'entreprise (ligne unique) ─────────────────────
// Tout ce qui paramètre les calculs (régime TVA, taux IS, mois de clôture) et
// la fiche légale (RC/IF/ICE/TP/CNSS) que le tableau de bord affiche.
export const comptaProfil = compta.table('profil', {
  id: text('id').primaryKey().default('agha-rm-infra'),
  raisonSociale: text('raison_sociale').notNull().default('AGHA RM INFRA'),
  formeJuridique: text('forme_juridique').notNull().default('SARL'),
  capitalSocial: numeric('capital_social', { precision: 14, scale: 2 }),
  registreCommerce: text('registre_commerce'),
  identifiantFiscal: text('identifiant_fiscal'),
  ice: text('ice'),
  taxeProfessionnelle: text('taxe_professionnelle'),
  cnssAffiliation: text('cnss_affiliation'),
  adresse: text('adresse'),
  ville: text('ville'),
  gerant: text('gerant'),
  dateCreation: date('date_creation', { mode: 'date' }),
  /** Mois de clôture de l'exercice (12 = 31 décembre, le cas standard). */
  exerciceClotureMois: integer('exercice_cloture_mois').notNull().default(12),
  /** Régime de déclaration TVA: mensuel (CA ≥ 1M MAD) ou trimestriel. */
  regimeTva: text('regime_tva').notNull().default('mensuel'),
  /** Prorata de déduction TVA (%) — 100 pour un assujetti total. */
  prorataTva: numeric('prorata_tva', { precision: 6, scale: 3 }).notNull().default('100'),
  /** Taux IS applicable (%) — barème LF en vigueur, configurable. */
  tauxIs: numeric('taux_is', { precision: 6, scale: 3 }).notNull().default('20'),
  /** Taux de cotisation minimale (%) sur les produits imposables. */
  tauxCotisationMinimale: numeric('taux_cotisation_minimale', { precision: 6, scale: 3 })
    .notNull()
    .default('0.25'),
  effectif: integer('effectif'),
  assujettiTp: boolean('assujetti_tp').notNull().default(true),
  /** Fin de l'exonération quinquennale de taxe professionnelle (création). */
  exonerationTpJusquau: date('exoneration_tp_jusquau', { mode: 'date' }),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Exercices comptables ─────────────────────────────────────────────────────
export const comptaExercices = compta.table(
  'exercice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    annee: integer('annee').notNull(),
    dateDebut: date('date_debut', { mode: 'date' }).notNull(),
    dateFin: date('date_fin', { mode: 'date' }).notNull(),
    statut: text('statut').notNull().default('ouvert'), // ouvert | cloture
    /** Résultat net figé à la clôture (sinon calculé en direct). */
    resultatNet: numeric('resultat_net', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('compta_exercice_annee_uniq').on(table.annee)],
);

// ── Plan comptable (CGNC) ────────────────────────────────────────────────────
// Le code CGNC est la clé primaire (1111, 4455, 61251…). Les comptes livrés
// par le seed portent is_custom=false; l'entreprise peut en ajouter.
export const comptes = compta.table(
  'compte',
  {
    code: text('code').primaryKey(),
    intitule: text('intitule').notNull(),
    /** Classe CGNC 1-8 (1 financement permanent … 8 résultats). */
    classe: integer('classe').notNull(),
    parentCode: text('parent_code'),
    isCustom: boolean('is_custom').notNull().default(false),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('compta_compte_classe_idx').on(table.classe),
    index('compta_compte_parent_idx').on(table.parentCode),
  ],
);

// ── Journaux ─────────────────────────────────────────────────────────────────
export const journaux = compta.table('journal', {
  code: text('code').primaryKey(), // ACH, VTE, BQ, CAI, OD, PAIE
  intitule: text('intitule').notNull(),
  type: text('type').notNull().default('divers'),
  actif: boolean('actif').notNull().default(true),
});

// ── Écritures (partie double) ────────────────────────────────────────────────
// L'équilibre débit=crédit est garanti par le domaine avant insertion; les
// lignes vivent dans leur propre table pour le grand livre / la balance.
export const ecritures = compta.table(
  'ecriture',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exerciceId: uuid('exercice_id')
      .notNull()
      .references(() => comptaExercices.id),
    journalCode: text('journal_code')
      .notNull()
      .references(() => journaux.code),
    /** Numéro séquentiel par journal et par exercice (max+1 en transaction). */
    numero: integer('numero').notNull(),
    dateEcriture: date('date_ecriture', { mode: 'date' }).notNull(),
    pieceRef: text('piece_ref'),
    libelle: text('libelle').notNull(),
    statut: text('statut').notNull().default('brouillon'), // brouillon | validee
    /** Provenance: manuel | vente (facture sales) | systeme. */
    source: text('source').notNull().default('manuel'),
    sourceId: uuid('source_id'),
    totalDebit: numeric('total_debit', { precision: 14, scale: 2 }).notNull().default('0'),
    totalCredit: numeric('total_credit', { precision: 14, scale: 2 }).notNull().default('0'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('compta_ecriture_journal_numero_uniq').on(
      table.exerciceId,
      table.journalCode,
      table.numero,
    ),
    index('compta_ecriture_date_idx').on(table.dateEcriture),
    index('compta_ecriture_exercice_idx').on(table.exerciceId),
    // Une facture de vente ne génère qu'une écriture (garde anti-doublon).
    uniqueIndex('compta_ecriture_source_uniq')
      .on(table.source, table.sourceId)
      .where(sql`source_id is not null and deleted_at is null`),
  ],
);

export const ecritureLignes = compta.table(
  'ecriture_ligne',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ecritureId: uuid('ecriture_id')
      .notNull()
      .references(() => ecritures.id, { onDelete: 'cascade' }),
    compteCode: text('compte_code')
      .notNull()
      .references(() => comptes.code),
    libelle: text('libelle'),
    debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0'),
    /** Tiers libre (client, fournisseur, organisme) pour le lettrage futur. */
    tiers: text('tiers'),
    ordre: integer('ordre').notNull().default(0),
  },
  (table) => [
    index('compta_ligne_ecriture_idx').on(table.ecritureId),
    index('compta_ligne_compte_idx').on(table.compteCode),
  ],
);

// ── TVA — déclarations périodiques (SIMPL-TVA) ───────────────────────────────
export const tvaDeclarations = compta.table(
  'tva_declaration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** '2026-01' (mensuel) ou '2026-T1' (trimestriel). */
    periodeKey: text('periode_key').notNull(),
    regime: text('regime').notNull().default('mensuel'),
    dateEcheance: date('date_echeance', { mode: 'date' }).notNull(),
    tvaCollectee: numeric('tva_collectee', { precision: 14, scale: 2 }).notNull().default('0'),
    tvaDeductibleCharges: numeric('tva_deductible_charges', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tvaDeductibleImmo: numeric('tva_deductible_immo', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    creditAnterieur: numeric('credit_anterieur', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** TVA due (>0) — 0 quand la période dégage un crédit. */
    tvaDue: numeric('tva_due', { precision: 14, scale: 2 }).notNull().default('0'),
    /** Crédit de TVA reporté sur la période suivante. */
    creditNouveau: numeric('credit_nouveau', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    statut: text('statut').notNull().default('a_preparer'), // a_preparer | a_declarer | declaree | payee
    dateDeclaration: date('date_declaration', { mode: 'date' }),
    datePaiement: date('date_paiement', { mode: 'date' }),
    reference: text('reference'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('compta_tva_periode_uniq').on(table.periodeKey)],
);

// ── Registre des déclarations & paiements fiscaux ────────────────────────────
// IS (acomptes 1-4, cotisation minimale, solde/reliquat), IR salaires mensuel,
// taxe professionnelle, liasse fiscale… Chaque ligne = une obligation datée
// avec son statut de vie (générée par l'échéancier, ajustable à la main).
export const declarationsFiscales = compta.table(
  'declaration_fiscale',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** is_acompte_1..4 | is_solde | cotisation_minimale | ir_salaires |
     *  ir_annuel | tp | liasse_fiscale | autre */
    type: text('type').notNull(),
    annee: integer('annee').notNull(),
    /** '2026-01' pour les types mensuels (IR), vide pour les annuels. */
    periodeKey: text('periode_key').notNull().default(''),
    label: text('label').notNull(),
    base: numeric('base', { precision: 14, scale: 2 }),
    montant: numeric('montant', { precision: 14, scale: 2 }).notNull().default('0'),
    dateEcheance: date('date_echeance', { mode: 'date' }).notNull(),
    statut: text('statut').notNull().default('a_venir'), // a_venir | a_declarer | declaree | payee
    dateDeclaration: date('date_declaration', { mode: 'date' }),
    datePaiement: date('date_paiement', { mode: 'date' }),
    reference: text('reference'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('compta_declaration_type_periode_uniq').on(
      table.type,
      table.annee,
      table.periodeKey,
    ),
    index('compta_declaration_echeance_idx').on(table.dateEcheance),
  ],
);

// ── Déclarations sociales (CNSS / AMO / DAMANCOM) ────────────────────────────
export const socialDeclarations = compta.table(
  'social_declaration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    periodeKey: text('periode_key').notNull(), // '2026-01'
    masseSalariale: numeric('masse_salariale', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Masse plafonnée (prestations sociales, plafond CNSS 6 000 DH/mois/salarié). */
    massePlafonnee: numeric('masse_plafonnee', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    effectif: integer('effectif').notNull().default(0),
    partSalariale: numeric('part_salariale', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    partPatronale: numeric('part_patronale', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalCotisations: numeric('total_cotisations', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    /** Détail par rubrique {allocations_familiales, prestations, amo, tfp…}. */
    detail: jsonb('detail').notNull().default('{}'),
    dateEcheance: date('date_echeance', { mode: 'date' }).notNull(),
    statut: text('statut').notNull().default('a_preparer'), // a_preparer | declaree | payee
    dateDeclaration: date('date_declaration', { mode: 'date' }),
    datePaiement: date('date_paiement', { mode: 'date' }),
    reference: text('reference'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('compta_social_periode_uniq').on(table.periodeKey)],
);

// ── Immobilisations & amortissements ─────────────────────────────────────────
// Le plan d'amortissement (linéaire, prorata temporis au mois de mise en
// service) est calculé par le domaine — seules les données d'entrée vivent ici.
export const immobilisations = compta.table(
  'immobilisation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    designation: text('designation').notNull(),
    compteCode: text('compte_code').notNull(), // classe 2
    categorie: text('categorie').notNull().default('materiel_technique'),
    dateAcquisition: date('date_acquisition', { mode: 'date' }).notNull(),
    dateMiseEnService: date('date_mise_en_service', { mode: 'date' }),
    valeurHt: numeric('valeur_ht', { precision: 14, scale: 2 }).notNull(),
    /** Taux linéaire annuel (%) — 10 pour 10 ans, 20 pour 5 ans, 25, 33.33… */
    tauxAmortissement: numeric('taux_amortissement', { precision: 6, scale: 3 })
      .notNull()
      .default('10'),
    statut: text('statut').notNull().default('actif'), // actif | cede | sorti
    dateSortie: date('date_sortie', { mode: 'date' }),
    prixCession: numeric('prix_cession', { precision: 14, scale: 2 }),
    fournisseur: text('fournisseur'),
    pieceRef: text('piece_ref'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('compta_immo_statut_idx').on(table.statut)],
);

// ── Banques ──────────────────────────────────────────────────────────────────
export const banqueComptes = compta.table('banque_compte', {
  id: uuid('id').primaryKey().defaultRandom(),
  banque: text('banque').notNull(),
  agence: text('agence'),
  rib: text('rib'),
  devise: text('devise').notNull().default('MAD'),
  soldeInitial: numeric('solde_initial', { precision: 14, scale: 2 }).notNull().default('0'),
  dateSoldeInitial: date('date_solde_initial', { mode: 'date' }),
  statut: text('statut').notNull().default('actif'), // actif | cloture
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const banqueMouvements = compta.table(
  'banque_mouvement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compteId: uuid('compte_id')
      .notNull()
      .references(() => banqueComptes.id),
    dateMouvement: date('date_mouvement', { mode: 'date' }).notNull(),
    libelle: text('libelle').notNull(),
    /** Signé : positif = encaissement, négatif = décaissement. */
    montant: numeric('montant', { precision: 14, scale: 2 }).notNull(),
    reference: text('reference'),
    /** Pointé lors du rapprochement avec le relevé bancaire. */
    rapproche: boolean('rapproche').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('compta_mouvement_compte_idx').on(table.compteId),
    index('compta_mouvement_date_idx').on(table.dateMouvement),
  ],
);

// ── Documents légaux & attestations (fichiers dans MinIO) ────────────────────
export const legalDocuments = compta.table(
  'legal_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** attestation_fiscale | attestation_cnss | attestation_tp | rc_modele_j |
     *  statuts | pv_ag | liasse_fiscale | bilan | quitus | contrat | autre */
    type: text('type').notNull(),
    titre: text('titre').notNull(),
    annee: integer('annee'),
    dateEmission: date('date_emission', { mode: 'date' }),
    /** Les attestations expirent — le tableau de bord alerte avant échéance. */
    dateExpiration: date('date_expiration', { mode: 'date' }),
    storageKey: text('storage_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('compta_legal_type_idx').on(table.type),
    index('compta_legal_expiration_idx').on(table.dateExpiration),
  ],
);

// ── Obligations légales annuelles (checklist) ────────────────────────────────
// liasse fiscale ≤ 3 mois après clôture, AG ordinaire ≤ 6 mois, dépôt au
// greffe ≤ 30 j après l'AG, inventaire annuel… Générées par année, cochables.
export const obligationsLegales = compta.table(
  'obligation_legale',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    annee: integer('annee').notNull(),
    type: text('type').notNull(),
    label: text('label').notNull(),
    dateEcheance: date('date_echeance', { mode: 'date' }).notNull(),
    statut: text('statut').notNull().default('a_faire'), // a_faire | fait | na
    dateFait: date('date_fait', { mode: 'date' }),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('compta_obligation_annee_type_uniq').on(table.annee, table.type),
    index('compta_obligation_echeance_idx').on(table.dateEcheance),
  ],
);
