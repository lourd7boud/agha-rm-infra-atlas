// Accès données compta — profil fiscal, exercices, plan comptable, journaux,
// écritures en partie double (avec génération depuis les factures de vente)
// et livres (grand livre, balance, états de synthèse). Même architecture que
// les repositories BTP : token + interface + implémentation Drizzle.
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  banqueComptes,
  banqueMouvements,
  comptaExercices,
  comptaProfil,
  comptes,
  clients as salesClients,
  ecritureLignes,
  ecritures,
  expenses,
  invoices as salesInvoices,
  journaux,
  projects,
} from '../../db/schema';
import {
  computeBalance,
  computeEtatsSynthese,
  validateEcriture,
  type BalanceRow,
  type EtatsSynthese,
  type LigneInput,
} from './compta-livres.domain';
import { round2, toDecimal } from './compta-fiscal.domain';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Date civile locale (YYYY-MM-DD) — toISOString décalerait d'un jour en UTC+1. */
export function isoLocal(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface ProfilRecord {
  id: string;
  raisonSociale: string;
  formeJuridique: string;
  capitalSocial: number | null;
  registreCommerce: string | null;
  identifiantFiscal: string | null;
  ice: string | null;
  taxeProfessionnelle: string | null;
  cnssAffiliation: string | null;
  adresse: string | null;
  ville: string | null;
  gerant: string | null;
  dateCreation: Date | null;
  exerciceClotureMois: number;
  regimeTva: string;
  prorataTva: number;
  tauxIs: number;
  tauxCotisationMinimale: number;
  effectif: number | null;
  assujettiTp: boolean;
  exonerationTpJusquau: Date | null;
  notes: string | null;
}

export interface ExerciceRecord {
  id: string;
  annee: number;
  dateDebut: Date;
  dateFin: Date;
  statut: string;
  resultatNet: number | null;
}

export interface CompteRecord {
  code: string;
  intitule: string;
  classe: number;
  parentCode: string | null;
  isCustom: boolean;
  actif: boolean;
}

export interface JournalRecord {
  code: string;
  intitule: string;
  type: string;
  actif: boolean;
}

export interface EcritureLigneRecord {
  id: string;
  compteCode: string;
  compteIntitule?: string;
  libelle: string | null;
  debit: number;
  credit: number;
  tiers: string | null;
  ordre: number;
}

export interface EcritureRecord {
  id: string;
  exerciceId: string;
  journalCode: string;
  numero: number;
  dateEcriture: Date;
  pieceRef: string | null;
  libelle: string;
  statut: string;
  source: string;
  totalDebit: number;
  totalCredit: number;
  createdBy: string | null;
  createdAt: Date;
  lignes?: EcritureLigneRecord[];
}

export interface GrandLivreLigne {
  ecritureId: string;
  journalCode: string;
  numero: number;
  dateEcriture: Date;
  pieceRef: string | null;
  libelle: string;
  debit: number;
  credit: number;
  solde: number;
}

export interface EcritureInput {
  journalCode: string;
  dateEcriture: Date;
  pieceRef?: string;
  libelle: string;
  lignes: LigneInput[];
}

export class ComptaError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ComptaRepository {
  getProfil(): Promise<ProfilRecord>;
  updateProfil(patch: Partial<Omit<ProfilRecord, 'id'>>): Promise<ProfilRecord>;

  listExercices(): Promise<ExerciceRecord[]>;
  getExercice(annee: number): Promise<ExerciceRecord | null>;
  ensureExercice(annee: number): Promise<ExerciceRecord>;
  setExerciceStatut(annee: number, statut: 'ouvert' | 'cloture'): Promise<ExerciceRecord>;

  listComptes(params?: { q?: string; classe?: number; actifsSeulement?: boolean }): Promise<
    CompteRecord[]
  >;
  createCompte(input: {
    code: string;
    intitule: string;
    parentCode?: string;
  }): Promise<CompteRecord>;
  patchCompte(
    code: string,
    patch: { intitule?: string; actif?: boolean },
  ): Promise<CompteRecord | null>;

  listJournaux(): Promise<JournalRecord[]>;

  listEcritures(params: {
    annee: number;
    journalCode?: string;
    q?: string;
    statut?: string;
    page: number;
    limit: number;
  }): Promise<{ items: EcritureRecord[]; total: number }>;
  getEcriture(id: string): Promise<EcritureRecord | null>;
  createEcriture(input: EcritureInput, createdBy: string | null): Promise<EcritureRecord>;
  updateEcriture(id: string, input: EcritureInput): Promise<EcritureRecord>;
  validerEcriture(id: string): Promise<EcritureRecord>;
  deleteEcriture(id: string): Promise<boolean>;
  genererEcrituresVentes(annee: number, createdBy: string | null): Promise<number>;
  /** Dépenses chantier/terrain (finance.expense) → écritures CAI/BQ/ACH. */
  genererEcrituresDepenses(annee: number, createdBy: string | null): Promise<number>;

  grandLivre(params: { compteCode: string; annee: number }): Promise<GrandLivreLigne[]>;
  balance(annee: number): Promise<BalanceRow[]>;
  etatsSynthese(annee: number): Promise<EtatsSynthese>;
  /** Lignes brutes d'une plage de dates (pré-remplissage TVA). */
  lignesEntre(du: Date, au: Date): Promise<
    Array<{ compteCode: string; debit: number; credit: number }>
  >;
}

export const COMPTA_REPOSITORY = Symbol('COMPTA_REPOSITORY');

/** Proxy fail-fast quand DATABASE_URL manque (pas de fallback mémoire). */
export function unavailableComptaRepository<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return () => {
        throw new ComptaError(`${name} indisponible: DATABASE_URL non configurée`, 503);
      };
    },
  });
}

// ── Pont dépenses chantier → plan CGNC (comptes tous présents au seed) ──────
const DEPENSE_COMPTES: Record<string, string> = {
  carburant: '61255',
  materiaux: '6121',
  location_materiel: '6131',
  main_oeuvre: '6135',
  transport: '6142',
  petit_outillage: '61253',
  reparation: '6133',
  repas: '6143',
  administratif: '6125',
  taxes: '6161',
  sous_traitance: '6126',
  autre: '6125',
};

const DEPENSE_CONTREPARTIES: Record<string, string> = {
  especes: '5161',
  carte: '5141',
  virement: '5141',
  cheque: '5141',
  credit: '4411',
};

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapProfil(row: typeof comptaProfil.$inferSelect): ProfilRecord {
  return {
    id: row.id,
    raisonSociale: row.raisonSociale,
    formeJuridique: row.formeJuridique,
    capitalSocial: row.capitalSocial === null ? null : num(row.capitalSocial),
    registreCommerce: row.registreCommerce,
    identifiantFiscal: row.identifiantFiscal,
    ice: row.ice,
    taxeProfessionnelle: row.taxeProfessionnelle,
    cnssAffiliation: row.cnssAffiliation,
    adresse: row.adresse,
    ville: row.ville,
    gerant: row.gerant,
    dateCreation: row.dateCreation,
    exerciceClotureMois: row.exerciceClotureMois,
    regimeTva: row.regimeTva,
    prorataTva: num(row.prorataTva),
    tauxIs: num(row.tauxIs),
    tauxCotisationMinimale: num(row.tauxCotisationMinimale),
    effectif: row.effectif,
    assujettiTp: row.assujettiTp,
    exonerationTpJusquau: row.exonerationTpJusquau,
    notes: row.notes,
  };
}

function mapExercice(row: typeof comptaExercices.$inferSelect): ExerciceRecord {
  return {
    id: row.id,
    annee: row.annee,
    dateDebut: row.dateDebut,
    dateFin: row.dateFin,
    statut: row.statut,
    resultatNet: row.resultatNet === null ? null : num(row.resultatNet),
  };
}

function mapCompte(row: typeof comptes.$inferSelect): CompteRecord {
  return {
    code: row.code,
    intitule: row.intitule,
    classe: row.classe,
    parentCode: row.parentCode,
    isCustom: row.isCustom,
    actif: row.actif,
  };
}

function mapEcriture(row: typeof ecritures.$inferSelect): EcritureRecord {
  return {
    id: row.id,
    exerciceId: row.exerciceId,
    journalCode: row.journalCode,
    numero: row.numero,
    dateEcriture: row.dateEcriture,
    pieceRef: row.pieceRef,
    libelle: row.libelle,
    statut: row.statut,
    source: row.source,
    totalDebit: num(row.totalDebit),
    totalCredit: num(row.totalCredit),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

// ── Implémentation Drizzle ───────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleComptaRepository implements ComptaRepository {
  constructor(private readonly db: Db) {}

  // Profil (ligne unique, créée par le seed).
  async getProfil(): Promise<ProfilRecord> {
    const [row] = await this.db.select().from(comptaProfil).limit(1);
    if (!row) {
      const [inserted] = await this.db
        .insert(comptaProfil)
        .values({ id: 'agha-rm-infra' })
        .onConflictDoNothing()
        .returning();
      if (inserted) return mapProfil(inserted);
      throw new ComptaError('Profil comptable introuvable', 500);
    }
    return mapProfil(row);
  }

  async updateProfil(patch: Partial<Omit<ProfilRecord, 'id'>>): Promise<ProfilRecord> {
    const current = await this.getProfil();
    const [row] = await this.db
      .update(comptaProfil)
      .set({
        raisonSociale: patch.raisonSociale ?? undefined,
        formeJuridique: patch.formeJuridique ?? undefined,
        capitalSocial:
          patch.capitalSocial === undefined ? undefined : String(patch.capitalSocial ?? 0),
        registreCommerce: patch.registreCommerce,
        identifiantFiscal: patch.identifiantFiscal,
        ice: patch.ice,
        taxeProfessionnelle: patch.taxeProfessionnelle,
        cnssAffiliation: patch.cnssAffiliation,
        adresse: patch.adresse,
        ville: patch.ville,
        gerant: patch.gerant,
        dateCreation: patch.dateCreation,
        exerciceClotureMois: patch.exerciceClotureMois ?? undefined,
        regimeTva: patch.regimeTva ?? undefined,
        prorataTva: patch.prorataTva === undefined ? undefined : String(patch.prorataTva),
        tauxIs: patch.tauxIs === undefined ? undefined : String(patch.tauxIs),
        tauxCotisationMinimale:
          patch.tauxCotisationMinimale === undefined
            ? undefined
            : String(patch.tauxCotisationMinimale),
        effectif: patch.effectif,
        assujettiTp: patch.assujettiTp ?? undefined,
        exonerationTpJusquau: patch.exonerationTpJusquau,
        notes: patch.notes,
        updatedAt: new Date(),
      })
      .where(eq(comptaProfil.id, current.id))
      .returning();
    if (!row) throw new ComptaError('Profil comptable introuvable', 404);
    return mapProfil(row);
  }

  // Exercices.
  async listExercices(): Promise<ExerciceRecord[]> {
    const rows = await this.db
      .select()
      .from(comptaExercices)
      .orderBy(desc(comptaExercices.annee));
    return rows.map(mapExercice);
  }

  async getExercice(annee: number): Promise<ExerciceRecord | null> {
    const [row] = await this.db
      .select()
      .from(comptaExercices)
      .where(eq(comptaExercices.annee, annee))
      .limit(1);
    return row ? mapExercice(row) : null;
  }

  async ensureExercice(annee: number): Promise<ExerciceRecord> {
    const existing = await this.getExercice(annee);
    if (existing) return existing;
    const [row] = await this.db
      .insert(comptaExercices)
      .values({
        annee,
        dateDebut: new Date(annee, 0, 1),
        dateFin: new Date(annee, 11, 31),
      })
      .onConflictDoNothing()
      .returning();
    if (row) return mapExercice(row);
    const retry = await this.getExercice(annee);
    if (!retry) throw new ComptaError(`Exercice ${annee} introuvable`, 500);
    return retry;
  }

  async setExerciceStatut(annee: number, statut: 'ouvert' | 'cloture'): Promise<ExerciceRecord> {
    const values: { statut: string; resultatNet?: string } = { statut };
    if (statut === 'cloture') {
      const etats = await this.etatsSynthese(annee);
      values.resultatNet = String(etats.cpc.resultatNet);
    }
    const [row] = await this.db
      .update(comptaExercices)
      .set(values)
      .where(eq(comptaExercices.annee, annee))
      .returning();
    if (!row) throw new ComptaError(`Exercice ${annee} introuvable`, 404);
    return mapExercice(row);
  }

  // Plan comptable.
  async listComptes(params?: {
    q?: string;
    classe?: number;
    actifsSeulement?: boolean;
  }): Promise<CompteRecord[]> {
    const conditions = [];
    if (params?.classe) conditions.push(eq(comptes.classe, params.classe));
    if (params?.actifsSeulement) conditions.push(eq(comptes.actif, true));
    if (params?.q) {
      conditions.push(
        or(ilike(comptes.code, `${params.q}%`), ilike(comptes.intitule, `%${params.q}%`)),
      );
    }
    const rows = await this.db
      .select()
      .from(comptes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(comptes.code));
    return rows.map(mapCompte);
  }

  async createCompte(input: {
    code: string;
    intitule: string;
    parentCode?: string;
  }): Promise<CompteRecord> {
    if (!/^\d{4,6}$/.test(input.code)) {
      throw new ComptaError('Le code compte est numérique (4 à 6 chiffres).');
    }
    const classe = Number(input.code[0]);
    if (classe < 1 || classe > 8) throw new ComptaError('Classe CGNC invalide (1-8).');
    const [row] = await this.db
      .insert(comptes)
      .values({
        code: input.code,
        intitule: input.intitule,
        classe,
        parentCode: input.parentCode ?? input.code.slice(0, 2),
        isCustom: true,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ComptaError(`Le compte ${input.code} existe déjà.`, 409);
    return mapCompte(row);
  }

  async patchCompte(
    code: string,
    patch: { intitule?: string; actif?: boolean },
  ): Promise<CompteRecord | null> {
    const [row] = await this.db
      .update(comptes)
      .set({ intitule: patch.intitule ?? undefined, actif: patch.actif ?? undefined })
      .where(eq(comptes.code, code))
      .returning();
    return row ? mapCompte(row) : null;
  }

  async listJournaux(): Promise<JournalRecord[]> {
    return this.db.select().from(journaux).orderBy(asc(journaux.code));
  }

  // Écritures.
  async listEcritures(params: {
    annee: number;
    journalCode?: string;
    q?: string;
    statut?: string;
    page: number;
    limit: number;
  }): Promise<{ items: EcritureRecord[]; total: number }> {
    const exercice = await this.ensureExercice(params.annee);
    const conditions = [eq(ecritures.exerciceId, exercice.id), isNull(ecritures.deletedAt)];
    if (params.journalCode) conditions.push(eq(ecritures.journalCode, params.journalCode));
    if (params.statut) conditions.push(eq(ecritures.statut, params.statut));
    if (params.q) {
      const clause = or(
        ilike(ecritures.libelle, `%${params.q}%`),
        ilike(ecritures.pieceRef, `%${params.q}%`),
      );
      if (clause) conditions.push(clause);
    }
    const where = and(...conditions);
    const [rows, [aggregate]] = await Promise.all([
      this.db
        .select()
        .from(ecritures)
        .where(where)
        .orderBy(desc(ecritures.dateEcriture), desc(ecritures.numero))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(ecritures).where(where),
    ]);
    return { items: rows.map(mapEcriture), total: aggregate?.count ?? 0 };
  }

  async getEcriture(id: string): Promise<EcritureRecord | null> {
    const [row] = await this.db
      .select()
      .from(ecritures)
      .where(and(eq(ecritures.id, id), isNull(ecritures.deletedAt)))
      .limit(1);
    if (!row) return null;
    const lignes = await this.db
      .select({
        id: ecritureLignes.id,
        compteCode: ecritureLignes.compteCode,
        compteIntitule: comptes.intitule,
        libelle: ecritureLignes.libelle,
        debit: ecritureLignes.debit,
        credit: ecritureLignes.credit,
        tiers: ecritureLignes.tiers,
        ordre: ecritureLignes.ordre,
      })
      .from(ecritureLignes)
      .leftJoin(comptes, eq(comptes.code, ecritureLignes.compteCode))
      .where(eq(ecritureLignes.ecritureId, id))
      .orderBy(asc(ecritureLignes.ordre));
    return {
      ...mapEcriture(row),
      lignes: lignes.map((l) => ({
        id: l.id,
        compteCode: l.compteCode,
        compteIntitule: l.compteIntitule ?? undefined,
        libelle: l.libelle,
        debit: num(l.debit),
        credit: num(l.credit),
        tiers: l.tiers,
        ordre: l.ordre,
      })),
    };
  }

  private async assertComptesExistent(tx: Tx, lignes: readonly LigneInput[]): Promise<void> {
    const codes = [...new Set(lignes.map((l) => l.compteCode))];
    const rows = await tx
      .select({ code: comptes.code })
      .from(comptes)
      .where(and(inArray(comptes.code, codes), eq(comptes.actif, true)));
    const connus = new Set(rows.map((r) => r.code));
    const inconnu = codes.find((c) => !connus.has(c));
    if (inconnu) {
      throw new ComptaError(
        `Compte ${inconnu} inconnu ou inactif — créez-le d'abord dans le plan comptable.`,
      );
    }
  }

  private async insertEcritureTx(
    tx: Tx,
    exerciceId: string,
    input: EcritureInput,
    createdBy: string | null,
    source: string,
    sourceId: string | null,
  ): Promise<string> {
    const totals = validateEcriture(input.lignes);
    await this.assertComptesExistent(tx, input.lignes);
    const [aggregate] = await tx
      .select({ maxNumero: sql<number>`coalesce(max(numero), 0)::int` })
      .from(ecritures)
      .where(
        and(eq(ecritures.exerciceId, exerciceId), eq(ecritures.journalCode, input.journalCode)),
      );
    const [inserted] = await tx
      .insert(ecritures)
      .values({
        exerciceId,
        journalCode: input.journalCode,
        numero: (aggregate?.maxNumero ?? 0) + 1,
        dateEcriture: input.dateEcriture,
        pieceRef: input.pieceRef ?? null,
        libelle: input.libelle,
        source,
        sourceId,
        totalDebit: String(totals.totalDebit),
        totalCredit: String(totals.totalCredit),
        createdBy,
      })
      .returning({ id: ecritures.id });
    if (!inserted) throw new ComptaError("Création de l'écriture échouée", 500);
    await tx.insert(ecritureLignes).values(
      input.lignes.map((ligne, index) => ({
        ecritureId: inserted.id,
        compteCode: ligne.compteCode,
        libelle: ligne.libelle ?? null,
        debit: String(round2(toDecimal(ligne.debit))),
        credit: String(round2(toDecimal(ligne.credit))),
        tiers: ligne.tiers ?? null,
        ordre: index,
      })),
    );
    return inserted.id;
  }

  async createEcriture(input: EcritureInput, createdBy: string | null): Promise<EcritureRecord> {
    const exercice = await this.ensureExercice(input.dateEcriture.getFullYear());
    if (exercice.statut === 'cloture') {
      throw new ComptaError(`L'exercice ${exercice.annee} est clôturé.`, 409);
    }
    const id = await this.db.transaction((tx) =>
      this.insertEcritureTx(tx, exercice.id, input, createdBy, 'manuel', null),
    );
    const created = await this.getEcriture(id);
    if (!created) throw new ComptaError('Écriture introuvable après création', 500);
    return created;
  }

  async updateEcriture(id: string, input: EcritureInput): Promise<EcritureRecord> {
    const existing = await this.getEcriture(id);
    if (!existing) throw new ComptaError('Écriture introuvable', 404);
    if (existing.statut !== 'brouillon') {
      throw new ComptaError('Écriture validée — contre-passez au lieu de modifier.', 409);
    }
    const exercice = await this.ensureExercice(input.dateEcriture.getFullYear());
    if (exercice.id !== existing.exerciceId) {
      throw new ComptaError("La date doit rester dans l'exercice d'origine.");
    }
    const totals = validateEcriture(input.lignes);
    await this.db.transaction(async (tx) => {
      await this.assertComptesExistent(tx, input.lignes);
      await tx
        .update(ecritures)
        .set({
          dateEcriture: input.dateEcriture,
          pieceRef: input.pieceRef ?? null,
          libelle: input.libelle,
          totalDebit: String(totals.totalDebit),
          totalCredit: String(totals.totalCredit),
          updatedAt: new Date(),
        })
        .where(eq(ecritures.id, id));
      await tx.delete(ecritureLignes).where(eq(ecritureLignes.ecritureId, id));
      await tx.insert(ecritureLignes).values(
        input.lignes.map((ligne, index) => ({
          ecritureId: id,
          compteCode: ligne.compteCode,
          libelle: ligne.libelle ?? null,
          debit: String(round2(toDecimal(ligne.debit))),
          credit: String(round2(toDecimal(ligne.credit))),
          tiers: ligne.tiers ?? null,
          ordre: index,
        })),
      );
    });
    const updated = await this.getEcriture(id);
    if (!updated) throw new ComptaError('Écriture introuvable', 404);
    return updated;
  }

  async validerEcriture(id: string): Promise<EcritureRecord> {
    const [row] = await this.db
      .update(ecritures)
      .set({ statut: 'validee', updatedAt: new Date() })
      .where(and(eq(ecritures.id, id), isNull(ecritures.deletedAt)))
      .returning();
    if (!row) throw new ComptaError('Écriture introuvable', 404);
    return mapEcriture(row);
  }

  async deleteEcriture(id: string): Promise<boolean> {
    const existing = await this.getEcriture(id);
    if (!existing) return false;
    if (existing.statut !== 'brouillon') {
      throw new ComptaError('Écriture validée — contre-passez au lieu de supprimer.', 409);
    }
    await this.db
      .update(ecritures)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(ecritures.id, id));
    return true;
  }

  /**
   * Génère au journal VTE les écritures des factures de vente (module sales)
   * de l'année qui n'en ont pas encore : D 3421 (TTC) / C 71242 (HT) /
   * C 4455 (TVA). Statut brouillon — le comptable relit puis valide.
   */
  async genererEcrituresVentes(annee: number, createdBy: string | null): Promise<number> {
    const exercice = await this.ensureExercice(annee);
    if (exercice.statut === 'cloture') {
      throw new ComptaError(`L'exercice ${annee} est clôturé.`, 409);
    }
    const rows = await this.db
      .select({
        id: salesInvoices.id,
        reference: salesInvoices.reference,
        invoiceDate: salesInvoices.invoiceDate,
        totalHt: salesInvoices.totalHtMad,
        totalTtc: salesInvoices.totalTtcMad,
        clientName: salesClients.name,
      })
      .from(salesInvoices)
      .innerJoin(salesClients, eq(salesClients.id, salesInvoices.clientId))
      .where(
        and(
          sql`${salesInvoices.status} <> 'brouillon'`,
          sql`extract(year from ${salesInvoices.invoiceDate}) = ${annee}`,
          sql`not exists (
            select 1 from "compta"."ecriture" e
            where e.source = 'vente' and e.source_id = ${salesInvoices.id}
              and e.deleted_at is null
          )`,
        ),
      )
      .orderBy(asc(salesInvoices.invoiceDate));

    let crees = 0;
    for (const invoice of rows) {
      const ht = num(invoice.totalHt);
      const ttc = num(invoice.totalTtc);
      const tva = round2(toDecimal(ttc).minus(ht));
      if (ttc <= 0) continue;
      const lignes: LigneInput[] = [
        { compteCode: '3421', debit: ttc, credit: 0, tiers: invoice.clientName },
        { compteCode: '71242', debit: 0, credit: ht },
      ];
      if (tva > 0) lignes.push({ compteCode: '4455', debit: 0, credit: tva });
      await this.db.transaction((tx) =>
        this.insertEcritureTx(
          tx,
          exercice.id,
          {
            journalCode: 'VTE',
            dateEcriture: invoice.invoiceDate,
            pieceRef: invoice.reference,
            libelle: `Facture ${invoice.reference} — ${invoice.clientName}`,
            lignes,
          },
          createdBy,
          'vente',
          invoice.id,
        ),
      );
      crees += 1;
    }
    return crees;
  }

  async genererEcrituresDepenses(annee: number, createdBy: string | null): Promise<number> {
    const exercice = await this.ensureExercice(annee);
    if (exercice.statut === 'cloture') {
      throw new ComptaError(`L'exercice ${annee} est clôturé.`, 409);
    }
    const rows = await this.db
      .select({
        id: expenses.id,
        label: expenses.label,
        amountMad: expenses.amountMad,
        method: expenses.method,
        reference: expenses.reference,
        spentAt: expenses.spentAt,
        category: expenses.category,
        projetRef: projects.reference,
      })
      .from(expenses)
      .leftJoin(projects, eq(projects.id, expenses.projectId))
      .where(
        and(
          sql`extract(year from ${expenses.spentAt}) = ${annee}`,
          sql`not exists (
            select 1 from "compta"."ecriture" e
            where e.source = 'depense' and e.source_id = ${expenses.id}
              and e.deleted_at is null
          )`,
        ),
      )
      .orderBy(asc(expenses.spentAt));

    let crees = 0;
    for (const dep of rows) {
      const montant = num(dep.amountMad);
      if (montant <= 0) continue;
      const compteCharge = DEPENSE_COMPTES[dep.category] ?? '6125';
      const contrepartie = DEPENSE_CONTREPARTIES[dep.method ?? 'especes'] ?? '5161';
      const journalCode =
        contrepartie === '4411' ? 'ACH' : contrepartie === '5141' ? 'BQ' : 'CAI';
      await this.db.transaction((tx) =>
        this.insertEcritureTx(
          tx,
          exercice.id,
          {
            journalCode,
            dateEcriture: dep.spentAt,
            pieceRef: dep.reference ?? undefined,
            libelle: `Dépense${dep.projetRef ? ` chantier ${dep.projetRef}` : ''} — ${dep.label}`,
            lignes: [
              { compteCode: compteCharge, debit: montant, credit: 0 },
              { compteCode: contrepartie, debit: 0, credit: montant },
            ],
          },
          createdBy,
          'depense',
          dep.id,
        ),
      );
      crees += 1;
    }
    return crees;
  }

  // Livres.
  async grandLivre(params: { compteCode: string; annee: number }): Promise<GrandLivreLigne[]> {
    const exercice = await this.ensureExercice(params.annee);
    const rows = await this.db
      .select({
        ecritureId: ecritures.id,
        journalCode: ecritures.journalCode,
        numero: ecritures.numero,
        dateEcriture: ecritures.dateEcriture,
        pieceRef: ecritures.pieceRef,
        libelle: sql<string>`coalesce(${ecritureLignes.libelle}, ${ecritures.libelle})`,
        debit: ecritureLignes.debit,
        credit: ecritureLignes.credit,
      })
      .from(ecritureLignes)
      .innerJoin(ecritures, eq(ecritures.id, ecritureLignes.ecritureId))
      .where(
        and(
          eq(ecritures.exerciceId, exercice.id),
          isNull(ecritures.deletedAt),
          params.compteCode.length >= 4
            ? eq(ecritureLignes.compteCode, params.compteCode)
            : ilike(ecritureLignes.compteCode, `${params.compteCode}%`),
        ),
      )
      .orderBy(asc(ecritures.dateEcriture), asc(ecritures.numero));
    let solde = toDecimal(0);
    return rows.map((row) => {
      solde = solde.plus(num(row.debit)).minus(num(row.credit));
      return {
        ecritureId: row.ecritureId,
        journalCode: row.journalCode,
        numero: row.numero,
        dateEcriture: row.dateEcriture,
        pieceRef: row.pieceRef,
        libelle: row.libelle,
        debit: num(row.debit),
        credit: num(row.credit),
        solde: round2(solde),
      };
    });
  }

  async balance(annee: number): Promise<BalanceRow[]> {
    const exercice = await this.ensureExercice(annee);
    const [lignes, plan] = await Promise.all([
      this.db
        .select({
          compteCode: ecritureLignes.compteCode,
          debit: ecritureLignes.debit,
          credit: ecritureLignes.credit,
        })
        .from(ecritureLignes)
        .innerJoin(ecritures, eq(ecritures.id, ecritureLignes.ecritureId))
        .where(and(eq(ecritures.exerciceId, exercice.id), isNull(ecritures.deletedAt))),
      this.db.select().from(comptes),
    ]);
    const intitules = new Map(
      plan.map((c) => [c.code, { intitule: c.intitule, classe: c.classe }]),
    );
    return computeBalance(
      lignes.map((l) => ({
        compteCode: l.compteCode,
        debit: num(l.debit),
        credit: num(l.credit),
      })),
      intitules,
    );
  }

  async etatsSynthese(annee: number): Promise<EtatsSynthese> {
    return computeEtatsSynthese(await this.balance(annee));
  }

  async lignesEntre(
    du: Date,
    au: Date,
  ): Promise<Array<{ compteCode: string; debit: number; credit: number }>> {
    const rows = await this.db
      .select({
        compteCode: ecritureLignes.compteCode,
        debit: ecritureLignes.debit,
        credit: ecritureLignes.credit,
      })
      .from(ecritureLignes)
      .innerJoin(ecritures, eq(ecritures.id, ecritureLignes.ecritureId))
      .where(
        and(
          isNull(ecritures.deletedAt),
          sql`${ecritures.dateEcriture} between ${isoLocal(du)} and ${isoLocal(au)}`,
        ),
      );
    return rows.map((l) => ({
      compteCode: l.compteCode,
      debit: num(l.debit),
      credit: num(l.credit),
    }));
  }
}

// Solde bancaire consolidé (utilisé par le contrôleur banques du module).
export async function soldeBancaire(db: Db, compteId: string): Promise<number> {
  const [compte] = await db
    .select()
    .from(banqueComptes)
    .where(eq(banqueComptes.id, compteId))
    .limit(1);
  if (!compte) return 0;
  const [aggregate] = await db
    .select({ total: sql<string>`coalesce(sum(${banqueMouvements.montant}), 0)` })
    .from(banqueMouvements)
    .where(eq(banqueMouvements.compteId, compteId));
  return round2(toDecimal(num(compte.soldeInitial)).plus(num(aggregate?.total)));
}
