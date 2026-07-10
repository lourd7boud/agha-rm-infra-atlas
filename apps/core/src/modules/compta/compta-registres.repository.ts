// Registres compta — déclarations TVA, registre fiscal (IS/IR/TP/liasse/CSS),
// déclarations sociales CNSS, immobilisations, banques, documents légaux et
// obligations annuelles. Les générateurs créent les périodes manquantes sans
// écraser l'existant (ON CONFLICT DO NOTHING).
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  banqueComptes,
  banqueMouvements,
  declarationsFiscales,
  immobilisations,
  legalDocuments,
  obligationsLegales,
  socialDeclarations,
  tvaDeclarations,
} from '../../db/schema';
import { ComptaError, isoLocal } from './compta.repository';
import {
  generateEcheancierFiscal,
  generateObligationsLegales,
  round2,
  toDecimal,
} from './compta-fiscal.domain';
import { computeTvaDue, tvaEcheance, tvaPeriodeKeys, type RegimeTva } from './compta-tva.domain';
import { cnssEcheance, computeCotisations } from './compta-social.domain';
import {
  planAmortissement,
  situationFinExercice,
  type AnnuiteAmortissement,
} from './compta-amortissement.domain';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// ── Records ──────────────────────────────────────────────────────────────────

export interface TvaDeclarationRecord {
  id: string;
  periodeKey: string;
  regime: string;
  dateEcheance: Date;
  tvaCollectee: number;
  tvaDeductibleCharges: number;
  tvaDeductibleImmo: number;
  creditAnterieur: number;
  tvaDue: number;
  creditNouveau: number;
  statut: string;
  dateDeclaration: Date | null;
  datePaiement: Date | null;
  reference: string | null;
  note: string | null;
}

export interface DeclarationFiscaleRecord {
  id: string;
  type: string;
  annee: number;
  periodeKey: string;
  label: string;
  base: number | null;
  montant: number;
  dateEcheance: Date;
  statut: string;
  dateDeclaration: Date | null;
  datePaiement: Date | null;
  reference: string | null;
  note: string | null;
}

export interface SocialDeclarationRecord {
  id: string;
  periodeKey: string;
  masseSalariale: number;
  massePlafonnee: number;
  effectif: number;
  partSalariale: number;
  partPatronale: number;
  totalCotisations: number;
  detail: Record<string, { patronal: number; salarial: number }>;
  dateEcheance: Date;
  statut: string;
  dateDeclaration: Date | null;
  datePaiement: Date | null;
  reference: string | null;
  note: string | null;
}

export interface ImmobilisationRecord {
  id: string;
  designation: string;
  compteCode: string;
  categorie: string;
  dateAcquisition: Date;
  dateMiseEnService: Date | null;
  valeurHt: number;
  tauxAmortissement: number;
  statut: string;
  dateSortie: Date | null;
  prixCession: number | null;
  fournisseur: string | null;
  pieceRef: string | null;
  note: string | null;
  /** Situation calculée à la fin de l'exercice demandé. */
  dotationExercice: number;
  cumulAmortissements: number;
  vnc: number;
}

export interface BanqueCompteRecord {
  id: string;
  banque: string;
  agence: string | null;
  rib: string | null;
  devise: string;
  soldeInitial: number;
  dateSoldeInitial: Date | null;
  statut: string;
  note: string | null;
  solde: number;
  mouvementsNonRapproches: number;
}

export interface BanqueMouvementRecord {
  id: string;
  compteId: string;
  dateMouvement: Date;
  libelle: string;
  montant: number;
  reference: string | null;
  rapproche: boolean;
  note: string | null;
}

export interface LegalDocumentRecord {
  id: string;
  type: string;
  titre: string;
  annee: number | null;
  dateEmission: Date | null;
  dateExpiration: Date | null;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  note: string | null;
  createdAt: Date;
}

export interface ObligationRecord {
  id: string;
  annee: number;
  type: string;
  label: string;
  dateEcheance: Date;
  statut: string;
  dateFait: Date | null;
  note: string | null;
}

export interface EcheanceOuverte {
  source: 'fiscal' | 'tva' | 'social' | 'obligation' | 'document';
  id: string;
  label: string;
  dateEcheance: Date;
  statut: string;
  montant: number | null;
}

export interface ComptaRegistresRepository {
  // TVA
  listTva(annee: number): Promise<TvaDeclarationRecord[]>;
  genererTva(annee: number, regime: RegimeTva): Promise<number>;
  patchTva(
    id: string,
    patch: Partial<{
      tvaCollectee: number;
      tvaDeductibleCharges: number;
      tvaDeductibleImmo: number;
      creditAnterieur: number;
      statut: string;
      dateDeclaration: Date | null;
      datePaiement: Date | null;
      reference: string | null;
      note: string | null;
    }>,
  ): Promise<TvaDeclarationRecord>;
  getTva(id: string): Promise<TvaDeclarationRecord | null>;

  // Déclarations fiscales
  listDeclarations(annee: number): Promise<DeclarationFiscaleRecord[]>;
  genererEcheancier(annee: number): Promise<number>;
  setAcomptesIs(annee: number, montantParAcompte: number): Promise<void>;
  patchDeclaration(
    id: string,
    patch: Partial<{
      base: number | null;
      montant: number;
      dateEcheance: Date;
      statut: string;
      dateDeclaration: Date | null;
      datePaiement: Date | null;
      reference: string | null;
      note: string | null;
    }>,
  ): Promise<DeclarationFiscaleRecord>;
  createDeclaration(input: {
    type: string;
    annee: number;
    label: string;
    montant: number;
    dateEcheance: Date;
    note?: string;
  }): Promise<DeclarationFiscaleRecord>;

  // Social
  listSocial(annee: number): Promise<SocialDeclarationRecord[]>;
  genererSocial(annee: number): Promise<number>;
  patchSocial(
    id: string,
    patch: Partial<{
      masseSalariale: number;
      massePlafonnee: number;
      effectif: number;
      statut: string;
      dateDeclaration: Date | null;
      datePaiement: Date | null;
      reference: string | null;
      note: string | null;
    }>,
  ): Promise<SocialDeclarationRecord>;

  // Immobilisations
  listImmobilisations(annee: number, statut?: string): Promise<ImmobilisationRecord[]>;
  getImmobilisation(
    id: string,
    annee: number,
  ): Promise<(ImmobilisationRecord & { plan: AnnuiteAmortissement[] }) | null>;
  createImmobilisation(input: {
    designation: string;
    compteCode: string;
    categorie: string;
    dateAcquisition: Date;
    dateMiseEnService?: Date;
    valeurHt: number;
    tauxAmortissement: number;
    fournisseur?: string;
    pieceRef?: string;
    note?: string;
  }): Promise<string>;
  patchImmobilisation(
    id: string,
    patch: Partial<{
      designation: string;
      compteCode: string;
      categorie: string;
      dateMiseEnService: Date | null;
      tauxAmortissement: number;
      statut: string;
      dateSortie: Date | null;
      prixCession: number | null;
      note: string | null;
    }>,
  ): Promise<boolean>;
  deleteImmobilisation(id: string): Promise<boolean>;

  // Banques
  listBanqueComptes(): Promise<BanqueCompteRecord[]>;
  createBanqueCompte(input: {
    banque: string;
    agence?: string;
    rib?: string;
    soldeInitial: number;
    dateSoldeInitial?: Date;
    note?: string;
  }): Promise<string>;
  listMouvements(compteId: string, limit: number): Promise<BanqueMouvementRecord[]>;
  createMouvement(input: {
    compteId: string;
    dateMouvement: Date;
    libelle: string;
    montant: number;
    reference?: string;
    note?: string;
  }): Promise<string>;
  toggleRapproche(id: string): Promise<boolean>;
  deleteMouvement(id: string): Promise<boolean>;

  // Documents légaux
  listDocuments(type?: string): Promise<LegalDocumentRecord[]>;
  createDocument(input: {
    type: string;
    titre: string;
    annee?: number;
    dateEmission?: Date;
    dateExpiration?: Date;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    note?: string;
    createdBy?: string;
  }): Promise<LegalDocumentRecord>;
  getDocument(id: string): Promise<LegalDocumentRecord | null>;
  patchDocument(
    id: string,
    patch: Partial<{
      titre: string;
      annee: number | null;
      dateEmission: Date | null;
      dateExpiration: Date | null;
      note: string | null;
    }>,
  ): Promise<boolean>;
  deleteDocument(id: string): Promise<boolean>;

  // Obligations
  listObligations(annee: number): Promise<ObligationRecord[]>;
  genererObligations(annee: number): Promise<number>;
  patchObligation(
    id: string,
    patch: Partial<{ statut: string; dateFait: Date | null; note: string | null }>,
  ): Promise<ObligationRecord>;

  /** Toutes les échéances ouvertes (fiscal + TVA + social + obligations + docs). */
  echeancesOuvertes(): Promise<EcheanceOuverte[]>;
}

export const COMPTA_REGISTRES_REPOSITORY = Symbol('COMPTA_REGISTRES_REPOSITORY');

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapTva(row: typeof tvaDeclarations.$inferSelect): TvaDeclarationRecord {
  return {
    id: row.id,
    periodeKey: row.periodeKey,
    regime: row.regime,
    dateEcheance: row.dateEcheance,
    tvaCollectee: num(row.tvaCollectee),
    tvaDeductibleCharges: num(row.tvaDeductibleCharges),
    tvaDeductibleImmo: num(row.tvaDeductibleImmo),
    creditAnterieur: num(row.creditAnterieur),
    tvaDue: num(row.tvaDue),
    creditNouveau: num(row.creditNouveau),
    statut: row.statut,
    dateDeclaration: row.dateDeclaration,
    datePaiement: row.datePaiement,
    reference: row.reference,
    note: row.note,
  };
}

function mapDeclaration(row: typeof declarationsFiscales.$inferSelect): DeclarationFiscaleRecord {
  return {
    id: row.id,
    type: row.type,
    annee: row.annee,
    periodeKey: row.periodeKey,
    label: row.label,
    base: row.base === null ? null : num(row.base),
    montant: num(row.montant),
    dateEcheance: row.dateEcheance,
    statut: row.statut,
    dateDeclaration: row.dateDeclaration,
    datePaiement: row.datePaiement,
    reference: row.reference,
    note: row.note,
  };
}

function mapSocial(row: typeof socialDeclarations.$inferSelect): SocialDeclarationRecord {
  return {
    id: row.id,
    periodeKey: row.periodeKey,
    masseSalariale: num(row.masseSalariale),
    massePlafonnee: num(row.massePlafonnee),
    effectif: row.effectif,
    partSalariale: num(row.partSalariale),
    partPatronale: num(row.partPatronale),
    totalCotisations: num(row.totalCotisations),
    detail: (row.detail ?? {}) as SocialDeclarationRecord['detail'],
    dateEcheance: row.dateEcheance,
    statut: row.statut,
    dateDeclaration: row.dateDeclaration,
    datePaiement: row.datePaiement,
    reference: row.reference,
    note: row.note,
  };
}

function mapDocument(row: typeof legalDocuments.$inferSelect): LegalDocumentRecord {
  return {
    id: row.id,
    type: row.type,
    titre: row.titre,
    annee: row.annee,
    dateEmission: row.dateEmission,
    dateExpiration: row.dateExpiration,
    storageKey: row.storageKey,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function mapObligation(row: typeof obligationsLegales.$inferSelect): ObligationRecord {
  return {
    id: row.id,
    annee: row.annee,
    type: row.type,
    label: row.label,
    dateEcheance: row.dateEcheance,
    statut: row.statut,
    dateFait: row.dateFait,
    note: row.note,
  };
}

// ── Implémentation ───────────────────────────────────────────────────────────

export class DrizzleComptaRegistresRepository implements ComptaRegistresRepository {
  constructor(private readonly db: Db) {}

  // TVA.
  async listTva(annee: number): Promise<TvaDeclarationRecord[]> {
    const rows = await this.db
      .select()
      .from(tvaDeclarations)
      .where(sql`${tvaDeclarations.periodeKey} like ${`${annee}-%`}`)
      .orderBy(asc(tvaDeclarations.periodeKey));
    return rows.map(mapTva);
  }

  async genererTva(annee: number, regime: RegimeTva): Promise<number> {
    const keys = tvaPeriodeKeys(annee, regime);
    let crees = 0;
    for (const periodeKey of keys) {
      const [inserted] = await this.db
        .insert(tvaDeclarations)
        .values({ periodeKey, regime, dateEcheance: tvaEcheance(periodeKey) })
        .onConflictDoNothing()
        .returning({ id: tvaDeclarations.id });
      if (inserted) crees += 1;
    }
    return crees;
  }

  async getTva(id: string): Promise<TvaDeclarationRecord | null> {
    const [row] = await this.db
      .select()
      .from(tvaDeclarations)
      .where(eq(tvaDeclarations.id, id))
      .limit(1);
    return row ? mapTva(row) : null;
  }

  async patchTva(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchTva']>[1],
  ): Promise<TvaDeclarationRecord> {
    const current = await this.getTva(id);
    if (!current) throw new ComptaError('Déclaration TVA introuvable', 404);
    const computed = computeTvaDue({
      tvaCollectee: patch.tvaCollectee ?? current.tvaCollectee,
      tvaDeductibleCharges: patch.tvaDeductibleCharges ?? current.tvaDeductibleCharges,
      tvaDeductibleImmo: patch.tvaDeductibleImmo ?? current.tvaDeductibleImmo,
      creditAnterieur: patch.creditAnterieur ?? current.creditAnterieur,
    });
    const [row] = await this.db
      .update(tvaDeclarations)
      .set({
        tvaCollectee: String(computed.tvaCollectee),
        tvaDeductibleCharges: String(computed.tvaDeductibleCharges),
        tvaDeductibleImmo: String(computed.tvaDeductibleImmo),
        creditAnterieur: String(computed.creditAnterieur),
        tvaDue: String(computed.tvaDue),
        creditNouveau: String(computed.creditNouveau),
        statut: patch.statut ?? undefined,
        dateDeclaration: patch.dateDeclaration,
        datePaiement: patch.datePaiement,
        reference: patch.reference,
        note: patch.note,
        updatedAt: new Date(),
      })
      .where(eq(tvaDeclarations.id, id))
      .returning();
    if (!row) throw new ComptaError('Déclaration TVA introuvable', 404);
    return mapTva(row);
  }

  // Déclarations fiscales.
  async listDeclarations(annee: number): Promise<DeclarationFiscaleRecord[]> {
    const rows = await this.db
      .select()
      .from(declarationsFiscales)
      .where(eq(declarationsFiscales.annee, annee))
      .orderBy(asc(declarationsFiscales.dateEcheance));
    return rows.map(mapDeclaration);
  }

  async genererEcheancier(annee: number): Promise<number> {
    const specs = generateEcheancierFiscal(annee);
    let crees = 0;
    for (const spec of specs) {
      const [inserted] = await this.db
        .insert(declarationsFiscales)
        .values({
          type: spec.type,
          annee: spec.annee,
          periodeKey: spec.periodeKey,
          label: spec.label,
          dateEcheance: spec.dateEcheance,
          note: spec.note ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: declarationsFiscales.id });
      if (inserted) crees += 1;
    }
    return crees;
  }

  async setAcomptesIs(annee: number, montantParAcompte: number): Promise<void> {
    await this.db
      .update(declarationsFiscales)
      .set({ montant: String(round2(toDecimal(montantParAcompte))), updatedAt: new Date() })
      .where(
        and(
          eq(declarationsFiscales.annee, annee),
          sql`${declarationsFiscales.type} like 'is_acompte_%'`,
          sql`${declarationsFiscales.statut} in ('a_venir','a_declarer')`,
        ),
      );
  }

  async patchDeclaration(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchDeclaration']>[1],
  ): Promise<DeclarationFiscaleRecord> {
    const [row] = await this.db
      .update(declarationsFiscales)
      .set({
        base:
          patch.base === undefined ? undefined : patch.base === null ? null : String(patch.base),
        montant: patch.montant === undefined ? undefined : String(patch.montant),
        dateEcheance: patch.dateEcheance ?? undefined,
        statut: patch.statut ?? undefined,
        dateDeclaration: patch.dateDeclaration,
        datePaiement: patch.datePaiement,
        reference: patch.reference,
        note: patch.note,
        updatedAt: new Date(),
      })
      .where(eq(declarationsFiscales.id, id))
      .returning();
    if (!row) throw new ComptaError('Déclaration introuvable', 404);
    return mapDeclaration(row);
  }

  async createDeclaration(
    input: Parameters<ComptaRegistresRepository['createDeclaration']>[0],
  ): Promise<DeclarationFiscaleRecord> {
    const [row] = await this.db
      .insert(declarationsFiscales)
      .values({
        type: input.type,
        annee: input.annee,
        periodeKey: `custom-${Date.now()}`,
        label: input.label,
        montant: String(round2(toDecimal(input.montant))),
        dateEcheance: input.dateEcheance,
        note: input.note ?? null,
      })
      .returning();
    if (!row) throw new ComptaError('Création de la déclaration échouée', 500);
    return mapDeclaration(row);
  }

  // Social.
  async listSocial(annee: number): Promise<SocialDeclarationRecord[]> {
    const rows = await this.db
      .select()
      .from(socialDeclarations)
      .where(sql`${socialDeclarations.periodeKey} like ${`${annee}-%`}`)
      .orderBy(asc(socialDeclarations.periodeKey));
    return rows.map(mapSocial);
  }

  async genererSocial(annee: number): Promise<number> {
    let crees = 0;
    for (let mois = 1; mois <= 12; mois += 1) {
      const periodeKey = `${annee}-${String(mois).padStart(2, '0')}`;
      const [inserted] = await this.db
        .insert(socialDeclarations)
        .values({ periodeKey, dateEcheance: cnssEcheance(periodeKey) })
        .onConflictDoNothing()
        .returning({ id: socialDeclarations.id });
      if (inserted) crees += 1;
    }
    return crees;
  }

  async patchSocial(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchSocial']>[1],
  ): Promise<SocialDeclarationRecord> {
    const [current] = await this.db
      .select()
      .from(socialDeclarations)
      .where(eq(socialDeclarations.id, id))
      .limit(1);
    if (!current) throw new ComptaError('Déclaration CNSS introuvable', 404);
    const masseSalariale = patch.masseSalariale ?? num(current.masseSalariale);
    const effectif = patch.effectif ?? current.effectif;
    const massePlafonnee =
      patch.massePlafonnee ??
      (patch.masseSalariale !== undefined || patch.effectif !== undefined
        ? Math.min(masseSalariale, effectif * 6_000)
        : num(current.massePlafonnee));
    const cotisations = computeCotisations({ masseSalariale, massePlafonnee });
    const [row] = await this.db
      .update(socialDeclarations)
      .set({
        masseSalariale: String(round2(toDecimal(masseSalariale))),
        massePlafonnee: String(round2(toDecimal(massePlafonnee))),
        effectif,
        partSalariale: String(cotisations.partSalariale),
        partPatronale: String(cotisations.partPatronale),
        totalCotisations: String(cotisations.total),
        detail: cotisations.detail,
        statut: patch.statut ?? undefined,
        dateDeclaration: patch.dateDeclaration,
        datePaiement: patch.datePaiement,
        reference: patch.reference,
        note: patch.note,
        updatedAt: new Date(),
      })
      .where(eq(socialDeclarations.id, id))
      .returning();
    if (!row) throw new ComptaError('Déclaration CNSS introuvable', 404);
    return mapSocial(row);
  }

  // Immobilisations.
  private mapImmo(row: typeof immobilisations.$inferSelect, annee: number): ImmobilisationRecord {
    const input = {
      valeurHt: num(row.valeurHt),
      tauxAmortissement: num(row.tauxAmortissement),
      dateMiseEnService: row.dateMiseEnService ?? row.dateAcquisition,
    };
    const plan = planAmortissement(input);
    const situation = situationFinExercice(input, annee);
    return {
      id: row.id,
      designation: row.designation,
      compteCode: row.compteCode,
      categorie: row.categorie,
      dateAcquisition: row.dateAcquisition,
      dateMiseEnService: row.dateMiseEnService,
      valeurHt: num(row.valeurHt),
      tauxAmortissement: num(row.tauxAmortissement),
      statut: row.statut,
      dateSortie: row.dateSortie,
      prixCession: row.prixCession === null ? null : num(row.prixCession),
      fournisseur: row.fournisseur,
      pieceRef: row.pieceRef,
      note: row.note,
      dotationExercice: plan.find((a) => a.annee === annee)?.dotation ?? 0,
      cumulAmortissements: situation.cumul,
      vnc: situation.vnc,
    };
  }

  async listImmobilisations(annee: number, statut?: string): Promise<ImmobilisationRecord[]> {
    const conditions = [isNull(immobilisations.deletedAt)];
    if (statut) conditions.push(eq(immobilisations.statut, statut));
    const rows = await this.db
      .select()
      .from(immobilisations)
      .where(and(...conditions))
      .orderBy(desc(immobilisations.dateAcquisition));
    return rows.map((row) => this.mapImmo(row, annee));
  }

  async getImmobilisation(
    id: string,
    annee: number,
  ): Promise<(ImmobilisationRecord & { plan: AnnuiteAmortissement[] }) | null> {
    const [row] = await this.db
      .select()
      .from(immobilisations)
      .where(and(eq(immobilisations.id, id), isNull(immobilisations.deletedAt)))
      .limit(1);
    if (!row) return null;
    const record = this.mapImmo(row, annee);
    return {
      ...record,
      plan: planAmortissement({
        valeurHt: record.valeurHt,
        tauxAmortissement: record.tauxAmortissement,
        dateMiseEnService: record.dateMiseEnService ?? record.dateAcquisition,
      }),
    };
  }

  async createImmobilisation(
    input: Parameters<ComptaRegistresRepository['createImmobilisation']>[0],
  ): Promise<string> {
    const [row] = await this.db
      .insert(immobilisations)
      .values({
        designation: input.designation,
        compteCode: input.compteCode,
        categorie: input.categorie,
        dateAcquisition: input.dateAcquisition,
        dateMiseEnService: input.dateMiseEnService ?? input.dateAcquisition,
        valeurHt: String(round2(toDecimal(input.valeurHt))),
        tauxAmortissement: String(input.tauxAmortissement),
        fournisseur: input.fournisseur ?? null,
        pieceRef: input.pieceRef ?? null,
        note: input.note ?? null,
      })
      .returning({ id: immobilisations.id });
    if (!row) throw new ComptaError("Création de l'immobilisation échouée", 500);
    return row.id;
  }

  async patchImmobilisation(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchImmobilisation']>[1],
  ): Promise<boolean> {
    const [row] = await this.db
      .update(immobilisations)
      .set({
        designation: patch.designation ?? undefined,
        compteCode: patch.compteCode ?? undefined,
        categorie: patch.categorie ?? undefined,
        dateMiseEnService: patch.dateMiseEnService,
        tauxAmortissement:
          patch.tauxAmortissement === undefined ? undefined : String(patch.tauxAmortissement),
        statut: patch.statut ?? undefined,
        dateSortie: patch.dateSortie,
        prixCession:
          patch.prixCession === undefined
            ? undefined
            : patch.prixCession === null
              ? null
              : String(patch.prixCession),
        note: patch.note,
      })
      .where(and(eq(immobilisations.id, id), isNull(immobilisations.deletedAt)))
      .returning({ id: immobilisations.id });
    return Boolean(row);
  }

  async deleteImmobilisation(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(immobilisations)
      .set({ deletedAt: new Date() })
      .where(and(eq(immobilisations.id, id), isNull(immobilisations.deletedAt)))
      .returning({ id: immobilisations.id });
    return Boolean(row);
  }

  // Banques.
  async listBanqueComptes(): Promise<BanqueCompteRecord[]> {
    const rows = await this.db.select().from(banqueComptes).orderBy(asc(banqueComptes.banque));
    const aggregates = await this.db
      .select({
        compteId: banqueMouvements.compteId,
        total: sql<string>`coalesce(sum(${banqueMouvements.montant}), 0)`,
        nonRapproches: sql<number>`count(*) filter (where not ${banqueMouvements.rapproche})::int`,
      })
      .from(banqueMouvements)
      .groupBy(banqueMouvements.compteId);
    const parCompte = new Map(aggregates.map((a) => [a.compteId, a]));
    return rows.map((row) => {
      const aggregate = parCompte.get(row.id);
      return {
        id: row.id,
        banque: row.banque,
        agence: row.agence,
        rib: row.rib,
        devise: row.devise,
        soldeInitial: num(row.soldeInitial),
        dateSoldeInitial: row.dateSoldeInitial,
        statut: row.statut,
        note: row.note,
        solde: round2(toDecimal(num(row.soldeInitial)).plus(num(aggregate?.total))),
        mouvementsNonRapproches: aggregate?.nonRapproches ?? 0,
      };
    });
  }

  async createBanqueCompte(
    input: Parameters<ComptaRegistresRepository['createBanqueCompte']>[0],
  ): Promise<string> {
    const [row] = await this.db
      .insert(banqueComptes)
      .values({
        banque: input.banque,
        agence: input.agence ?? null,
        rib: input.rib ?? null,
        soldeInitial: String(round2(toDecimal(input.soldeInitial))),
        dateSoldeInitial: input.dateSoldeInitial ?? null,
        note: input.note ?? null,
      })
      .returning({ id: banqueComptes.id });
    if (!row) throw new ComptaError('Création du compte bancaire échouée', 500);
    return row.id;
  }

  async listMouvements(compteId: string, limit: number): Promise<BanqueMouvementRecord[]> {
    const rows = await this.db
      .select()
      .from(banqueMouvements)
      .where(eq(banqueMouvements.compteId, compteId))
      .orderBy(desc(banqueMouvements.dateMouvement), desc(banqueMouvements.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      compteId: row.compteId,
      dateMouvement: row.dateMouvement,
      libelle: row.libelle,
      montant: num(row.montant),
      reference: row.reference,
      rapproche: row.rapproche,
      note: row.note,
    }));
  }

  async createMouvement(
    input: Parameters<ComptaRegistresRepository['createMouvement']>[0],
  ): Promise<string> {
    const [row] = await this.db
      .insert(banqueMouvements)
      .values({
        compteId: input.compteId,
        dateMouvement: input.dateMouvement,
        libelle: input.libelle,
        montant: String(round2(toDecimal(input.montant))),
        reference: input.reference ?? null,
        note: input.note ?? null,
      })
      .returning({ id: banqueMouvements.id });
    if (!row) throw new ComptaError('Création du mouvement échouée', 500);
    return row.id;
  }

  async toggleRapproche(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(banqueMouvements)
      .set({ rapproche: sql`not ${banqueMouvements.rapproche}` })
      .where(eq(banqueMouvements.id, id))
      .returning({ id: banqueMouvements.id });
    return Boolean(row);
  }

  async deleteMouvement(id: string): Promise<boolean> {
    const result = await this.db
      .delete(banqueMouvements)
      .where(eq(banqueMouvements.id, id))
      .returning({ id: banqueMouvements.id });
    return result.length > 0;
  }

  // Documents légaux.
  async listDocuments(type?: string): Promise<LegalDocumentRecord[]> {
    const conditions = [isNull(legalDocuments.deletedAt)];
    if (type) conditions.push(eq(legalDocuments.type, type));
    const rows = await this.db
      .select()
      .from(legalDocuments)
      .where(and(...conditions))
      .orderBy(desc(legalDocuments.createdAt));
    return rows.map(mapDocument);
  }

  async createDocument(
    input: Parameters<ComptaRegistresRepository['createDocument']>[0],
  ): Promise<LegalDocumentRecord> {
    const [row] = await this.db
      .insert(legalDocuments)
      .values({
        type: input.type,
        titre: input.titre,
        annee: input.annee ?? null,
        dateEmission: input.dateEmission ?? null,
        dateExpiration: input.dateExpiration ?? null,
        storageKey: input.storageKey ?? null,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        fileSize: input.fileSize ?? null,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) throw new ComptaError('Création du document échouée', 500);
    return mapDocument(row);
  }

  async getDocument(id: string): Promise<LegalDocumentRecord | null> {
    const [row] = await this.db
      .select()
      .from(legalDocuments)
      .where(and(eq(legalDocuments.id, id), isNull(legalDocuments.deletedAt)))
      .limit(1);
    return row ? mapDocument(row) : null;
  }

  async patchDocument(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchDocument']>[1],
  ): Promise<boolean> {
    const [row] = await this.db
      .update(legalDocuments)
      .set({
        titre: patch.titre ?? undefined,
        annee: patch.annee,
        dateEmission: patch.dateEmission,
        dateExpiration: patch.dateExpiration,
        note: patch.note,
      })
      .where(and(eq(legalDocuments.id, id), isNull(legalDocuments.deletedAt)))
      .returning({ id: legalDocuments.id });
    return Boolean(row);
  }

  async deleteDocument(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(legalDocuments)
      .set({ deletedAt: new Date() })
      .where(and(eq(legalDocuments.id, id), isNull(legalDocuments.deletedAt)))
      .returning({ id: legalDocuments.id });
    return Boolean(row);
  }

  // Obligations.
  async listObligations(annee: number): Promise<ObligationRecord[]> {
    const rows = await this.db
      .select()
      .from(obligationsLegales)
      .where(eq(obligationsLegales.annee, annee))
      .orderBy(asc(obligationsLegales.dateEcheance));
    return rows.map(mapObligation);
  }

  async genererObligations(annee: number): Promise<number> {
    const specs = generateObligationsLegales(annee);
    let crees = 0;
    for (const spec of specs) {
      const [inserted] = await this.db
        .insert(obligationsLegales)
        .values({
          annee,
          type: spec.type,
          label: spec.label,
          dateEcheance: spec.dateEcheance,
        })
        .onConflictDoNothing()
        .returning({ id: obligationsLegales.id });
      if (inserted) crees += 1;
    }
    return crees;
  }

  async patchObligation(
    id: string,
    patch: Parameters<ComptaRegistresRepository['patchObligation']>[1],
  ): Promise<ObligationRecord> {
    const [row] = await this.db
      .update(obligationsLegales)
      .set({
        statut: patch.statut ?? undefined,
        dateFait: patch.dateFait,
        note: patch.note,
        updatedAt: new Date(),
      })
      .where(eq(obligationsLegales.id, id))
      .returning();
    if (!row) throw new ComptaError('Obligation introuvable', 404);
    return mapObligation(row);
  }

  // Tableau de bord — toutes les échéances non soldées.
  async echeancesOuvertes(): Promise<EcheanceOuverte[]> {
    const [fiscales, tva, social, obligations, documents] = await Promise.all([
      this.db
        .select()
        .from(declarationsFiscales)
        .where(sql`${declarationsFiscales.statut} in ('a_venir','a_declarer','declaree')`),
      this.db
        .select()
        .from(tvaDeclarations)
        .where(sql`${tvaDeclarations.statut} in ('a_preparer','a_declarer','declaree')`),
      this.db
        .select()
        .from(socialDeclarations)
        .where(sql`${socialDeclarations.statut} in ('a_preparer','declaree')`),
      this.db.select().from(obligationsLegales).where(eq(obligationsLegales.statut, 'a_faire')),
      this.db
        .select()
        .from(legalDocuments)
        .where(
          and(isNull(legalDocuments.deletedAt), sql`${legalDocuments.dateExpiration} is not null`),
        ),
    ]);
    const items: EcheanceOuverte[] = [];
    for (const d of fiscales) {
      items.push({
        source: 'fiscal',
        id: d.id,
        label: d.label,
        dateEcheance: d.dateEcheance,
        statut: d.statut,
        montant: num(d.montant),
      });
    }
    for (const d of tva) {
      items.push({
        source: 'tva',
        id: d.id,
        label: `TVA ${d.periodeKey}`,
        dateEcheance: d.dateEcheance,
        statut: d.statut,
        montant: num(d.tvaDue),
      });
    }
    for (const d of social) {
      items.push({
        source: 'social',
        id: d.id,
        label: `CNSS ${d.periodeKey}`,
        dateEcheance: d.dateEcheance,
        statut: d.statut,
        montant: num(d.totalCotisations),
      });
    }
    for (const o of obligations) {
      items.push({
        source: 'obligation',
        id: o.id,
        label: o.label,
        dateEcheance: o.dateEcheance,
        statut: o.statut,
        montant: null,
      });
    }
    const today = isoLocal(new Date());
    const limite = new Date();
    limite.setDate(limite.getDate() + 45);
    const limiteIso = isoLocal(limite);
    for (const doc of documents) {
      if (!doc.dateExpiration) continue;
      // Une attestation expirée ou expirant sous 45 jours est une échéance.
      const expiration = isoLocal(doc.dateExpiration);
      if (expiration <= limiteIso) {
        items.push({
          source: 'document',
          id: doc.id,
          label: `${doc.titre} — expiration`,
          dateEcheance: doc.dateExpiration,
          statut: expiration < today ? 'expire' : 'a_renouveler',
          montant: null,
        });
      }
    }
    return items.sort((a, b) => a.dateEcheance.getTime() - b.dateEcheance.getTime());
  }
}
