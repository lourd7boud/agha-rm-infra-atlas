// Migration btpdb → module BTP natif.
//
// Prérequis (sur le VPS):
//   1. docker exec atlas-projects-postgres pg_dump -U btpuser -d btpdb -Fc -f /tmp/btpdb.dump
//      docker cp atlas-projects-postgres:/tmp/btpdb.dump /tmp/btpdb.dump
//   2. Restore dans la base ATLAS sous le schéma btp_legacy (voir le runbook du
//      déploiement: create schema btp_legacy + pg_restore avec remap de schéma).
//   3. docker compose -f docker-compose.apps.yml run --rm \
//        -v /opt/atlas/projects-data/uploads:/legacy-uploads:ro \
//        --entrypoint sh core -c "cd /app/apps/core && npx tsx scripts/migrate-btp.ts"
//
// Politique: les valeurs HISTORIQUES (décomptes, acomptes) sont copiées telles
// quelles — le moteur ne recalcule PAS le passé; il reprendra la main à la
// prochaine sauvegarde de métré. Idempotent: relançable (wipe + reinsert des
// satellites BTP des projets migrés, upsert par id ailleurs).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  S3ObjectStorage,
  sanitizeFilename,
  type ObjectStorage,
} from '../src/modules/vault/storage';

const L = process.env.LEGACY_SCHEMA ?? 'btp_legacy';
const UPLOADS_DIR = process.env.LEGACY_UPLOADS ?? '/legacy-uploads';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL manquant');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

function md5Uuid(input: string): string {
  const h = createHash('md5').update(input).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const STATUS_MAP: Record<string, string> = {
  draft: 'preparation',
  active: 'en_cours',
  completed: 'receptionne',
  archived: 'clos',
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function trunc2(value: number): number {
  return Math.trunc(value * 100) / 100;
}

interface Counts {
  [k: string]: number;
}
const counts: Counts = {};
function bump(key: string, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

function buildStorage(): ObjectStorage | null {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET ?? 'atlas-vault';
  if (!endpoint || !accessKey || !secretKey) return null;
  return new S3ObjectStorage(bucket, { endpoint, accessKey, secretKey });
}

// ─── Révision (référentiel global) ──────────────────────────────────────────

async function migrateRevisionReference(): Promise<Map<number, string>> {
  const formulaIdMap = new Map<number, string>();
  const formulas = await q(`select * from "${L}".revision_formulas`);
  for (const f of formulas) {
    const id = md5Uuid(`formula:${f.id}`);
    formulaIdMap.set(Number(f.id), id);
    await pool.query(
      `insert into project.revision_formula (id, name, description, fixed_part, weights, is_default)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name=excluded.name, description=excluded.description,
         fixed_part=excluded.fixed_part, weights=excluded.weights, is_default=excluded.is_default`,
      [
        id,
        f.name,
        f.description ?? null,
        f.fixed_part ?? 0.15,
        f.weights ?? {},
        f.is_default ?? false,
      ],
    );
    bump('formulas');
  }
  const indexes = await q(`select * from "${L}".revision_indexes`);
  for (const i of indexes) {
    await pool.query(
      `insert into project.revision_index (id, month_date, index_values, source, notes, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (month_date) do update set index_values=excluded.index_values,
         source=excluded.source, notes=excluded.notes, status=excluded.status, updated_at=now()`,
      [
        md5Uuid(`index:${i.id}`),
        i.month_date,
        i.index_values ?? {},
        i.source ?? null,
        (i as { notes?: string }).notes ?? null,
        i.status ?? 'provisoire',
        i.created_by ? String(i.created_by) : null,
      ],
    );
    bump('indexMonths');
  }
  return formulaIdMap;
}

// ─── Projets + chaîne d'exécution ────────────────────────────────────────────

interface LegacyProject {
  id: string;
  [k: string]: unknown;
}

async function resolveNativeProjectId(lp: LegacyProject): Promise<string | null> {
  const byLegacy = await q<{ id: string }>(
    `select id from project.project where legacy_project_id = $1 limit 1`,
    [lp.id],
  );
  if (byLegacy[0]) return byLegacy[0].id;
  const reference = String(lp.marche_no ?? '').trim();
  if (reference) {
    const byRef = await q<{ id: string }>(
      `select id from project.project where reference = $1 order by created_at asc limit 1`,
      [reference],
    );
    if (byRef[0]) return byRef[0].id;
  }
  return null;
}

async function upsertProject(lp: LegacyProject): Promise<string> {
  const existingId = await resolveNativeProjectId(lp);
  const objet = String(lp.objet ?? '').trim() || String(lp.marche_no ?? 'Marché');
  const values = [
    String(lp.marche_no ?? '').trim() || `LEGACY-${String(lp.id).slice(0, 8)}`,
    objet.slice(0, 180),
    String(lp.maitre_oeuvre ?? '').trim() || '—',
    num(lp.montant),
    STATUS_MAP[String(lp.status ?? 'draft')] ?? 'preparation',
    objet,
    lp.annee ? String(lp.annee) : null,
    (lp.societe as string) ?? null,
    (lp.commune as string) ?? null,
    (lp.type_marche as string) ?? 'normal',
    lp.date_ouverture ?? null,
    lp.osc ?? null,
    lp.delais_execution != null ? num(lp.delais_execution) : null,
    lp.date_reception_provisoire ?? null,
    lp.date_reception_definitive ?? null,
    lp.achevement_travaux ?? null,
    (lp.assistance_technique as string) ?? null,
    (lp.maitre_oeuvre as string) ?? null,
    (lp.rc as string) ?? (lp.rcn as string) ?? null,
    (lp.cb as string) ?? (lp.cbn as string) ?? null,
    (lp.cnss as string) ?? (lp.snss as string) ?? null,
    (lp.patente as string) ?? null,
    (lp.programme as string) ?? null,
    (lp.projet as string) ?? null,
    (lp.ligne as string) ?? null,
    (lp.chapitre as string) ?? null,
    JSON.stringify(lp.arrets ?? []),
    lp.user_id ?? null,
    lp.id,
    lp.deleted_at ?? null,
  ];
  if (existingId) {
    await pool.query(
      `update project.project set
         reference=$2, name=$3, buyer_name=$4, montant_marche_mad=$5, status=$6, objet=$7,
         annee=$8, societe=$9, commune=$10, type_marche=$11, date_ouverture=$12,
         ordre_service_date=$13, delai_mois=$14, reception_provisoire=$15,
         reception_definitive=$16, achevement_travaux=$17, assistance_technique=$18,
         maitre_oeuvre=$19, rc=$20, cb=$21, cnss=$22, patente=$23, programme=$24,
         projet_libelle=$25, ligne_budgetaire=$26, chapitre=$27, arrets=$28,
         legacy_user_id=$29, legacy_project_id=$30, deleted_at=$31, updated_at=now()
       where id=$1`,
      [existingId, ...values],
    );
    bump('projectsUpdated');
    return existingId;
  }
  const inserted = await q<{ id: string }>(
    `insert into project.project (
       reference, name, buyer_name, montant_marche_mad, status, objet, annee, societe,
       commune, type_marche, date_ouverture, ordre_service_date, delai_mois,
       reception_provisoire, reception_definitive, achevement_travaux,
       assistance_technique, maitre_oeuvre, rc, cb, cnss, patente, programme,
       projet_libelle, ligne_budgetaire, chapitre, arrets, legacy_user_id,
       legacy_project_id, deleted_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     returning id`,
    [...values, lp.created_at ?? new Date()],
  );
  bump('projectsInserted');
  return inserted[0]!.id;
}

async function wipeSatellites(projectId: string): Promise<void> {
  await pool.query(
    `delete from project.decompte_revision where decompte_id in (select id from project.decompte where project_id=$1)`,
    [projectId],
  );
  for (const table of [
    'retenue',
    'decompte',
    'metre',
    'periode',
    'bordereau',
    'project_revision_config',
    'ordre_service',
    'penalite',
    'caution',
    'project_asset',
    'photo_album',
  ]) {
    await pool.query(`delete from project."${table}" where project_id=$1`, [projectId]);
  }
}

interface BordereauLigne {
  id: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

async function migrateChain(lp: LegacyProject, projectId: string): Promise<void> {
  // Bordereau (le premier non supprimé).
  const bordereaux = await q(
    `select * from "${L}".bordereaux where project_id=$1 and deleted_at is null order by created_at asc`,
    [lp.id],
  );
  let bordereauLignes: BordereauLigne[] = [];
  const bordereau = bordereaux[0];
  if (bordereau) {
    const rawLignes = (bordereau.lignes as Record<string, unknown>[]) ?? [];
    bordereauLignes = rawLignes.map((ligne, i) => {
      const numero = num(ligne.numero) || i + 1;
      return {
        // La clé de jointure des métrés legacy: "{bordereauId}-ligne-{numero}".
        id: `${bordereau.id}-ligne-${numero}`,
        numero,
        designation: String(ligne.designation ?? ''),
        unite: String(ligne.unite ?? 'U'),
        quantite: num(ligne.quantite),
        prixUnitaire: num(ligne.prixUnitaire),
        montant: round2(num(ligne.quantite) * num(ligne.prixUnitaire)),
      };
    });
    const montantHt = round2(bordereauLignes.reduce((s, l) => s + l.quantite * l.prixUnitaire, 0));
    await pool.query(
      `insert into project.bordereau (id, project_id, reference, designation, lignes, montant_total_mad, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        bordereau.id,
        projectId,
        bordereau.reference ?? null,
        bordereau.designation ?? null,
        JSON.stringify(bordereauLignes),
        montantHt,
        bordereau.created_at ?? new Date(),
        bordereau.updated_at ?? new Date(),
      ],
    );
    bump('bordereaux');
  }
  const marcheTtc = bordereauLignes.reduce((s, l) => s + l.quantite * l.prixUnitaire * 1.2, 0);

  // Périodes.
  const periodes = await q(
    `select * from "${L}".periodes where project_id=$1 and deleted_at is null order by numero asc`,
    [lp.id],
  );
  for (const p of periodes) {
    await pool.query(
      `insert into project.periode (id, project_id, numero, libelle, date_debut, date_fin,
         taux_tva, taux_retenue, is_decompte_dernier, statut, observations, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        p.id,
        projectId,
        num(p.numero),
        p.libelle ?? null,
        p.date_debut ?? null,
        p.date_fin ?? null,
        p.taux_tva ?? 20,
        p.taux_retenue ?? 10,
        p.is_decompte_dernier ?? false,
        p.statut ?? 'en_cours',
        p.observations ?? null,
        p.created_at ?? new Date(),
        p.updated_at ?? new Date(),
      ],
    );
    bump('periodes');
  }

  // Métrés.
  const metres = await q(`select * from "${L}".metres where project_id=$1 and deleted_at is null`, [
    lp.id,
  ]);
  for (const m of metres) {
    if (!m.periode_id || !m.bordereau_ligne_id) continue;
    await pool.query(
      `insert into project.metre (id, project_id, periode_id, bordereau_ligne_id,
         designation_bordereau, unite, sections, sous_sections, lignes,
         total_partiel, total_cumule, quantite_bordereau, pourcentage_realisation, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        m.id,
        projectId,
        m.periode_id,
        m.bordereau_ligne_id,
        m.designation_bordereau ?? null,
        m.unite ?? null,
        JSON.stringify(m.sections ?? []),
        JSON.stringify(m.sub_sections ?? []),
        JSON.stringify(m.lignes ?? []),
        num(m.total_partiel),
        num(m.total_cumule),
        num(m.quantite_bordereau),
        num(m.pourcentage_realisation),
        m.created_at ?? new Date(),
        m.updated_at ?? new Date(),
      ],
    );
    bump('metres');
  }

  // Décomptes — valeurs historiques conservées; champs dérivés reconstitués.
  const periodeById = new Map(periodes.map((p) => [String(p.id), p]));
  const decomptes = await q(
    `select * from "${L}".decompts where project_id=$1 and deleted_at is null order by numero asc`,
    [lp.id],
  );
  const priorAcomptes: { montant: number; annee: number }[] = [];
  let dernierTtc = 0;
  for (const d of decomptes) {
    const periode = d.periode_id ? periodeById.get(String(d.periode_id)) : undefined;
    const lignes = ((d.lignes as Record<string, unknown>[]) ?? []).map((l) => ({
      prixNo: num(l.prixNo),
      designation: String(l.designation ?? ''),
      unite: String(l.unite ?? ''),
      quantiteBordereau: num(l.quantiteBordereau),
      quantiteRealisee: num(l.quantiteRealisee),
      prixUnitaireHT: num(l.prixUnitaireHT),
      montantHT: num(l.montantHT),
      bordereauLigneId: String(l.bordereauLigneId ?? ''),
    }));
    const totalHt = round2(lignes.reduce((s, l) => s + l.montantHT, 0));
    const totalTtc = num(d.total_general_ttc) || num(d.total_ttc);
    const montantAcompte = num(d.montant_total);
    const annee = periode?.date_debut
      ? new Date(periode.date_debut as string).getFullYear()
      : new Date((d.created_at as string) ?? Date.now()).getFullYear();
    let anterieurs = 0;
    let precedents = 0;
    for (const prior of priorAcomptes) {
      if (prior.annee < annee) anterieurs += prior.montant;
      else precedents += prior.montant;
    }
    const retenue = Math.min(trunc2(totalTtc * 0.1), trunc2(marcheTtc * 0.07));
    await pool.query(
      `insert into project.decompte (id, project_id, periode_id, numero, date_decompte, lignes,
         taux_tva, total_ht_mad, revision_montant_mad, montant_tva_mad, total_ttc_mad,
         depenses_anterieures_mad, decomptes_precedents_mad, retenue_garantie_mad,
         montant_acompte_mad, is_dernier, statut, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        d.id,
        projectId,
        d.periode_id ?? null,
        num(d.numero),
        d.date_decompte ?? null,
        JSON.stringify(lignes),
        periode?.taux_tva ?? 20,
        totalHt,
        0,
        round2(Math.max(0, totalTtc - totalHt)),
        totalTtc,
        round2(anterieurs),
        round2(precedents),
        retenue,
        montantAcompte,
        (periode?.is_decompte_dernier as boolean) ?? Boolean(d.is_dernier),
        String(d.statut ?? 'draft'),
        d.created_at ?? new Date(),
        d.updated_at ?? new Date(),
      ],
    );
    priorAcomptes.push({ montant: montantAcompte, annee });
    dernierTtc = totalTtc;
    bump('decomptes');
  }

  // Avancement financier (formule source: dernier TTC ÷ marché TTC).
  const progress = marcheTtc > 0 ? round2((dernierTtc / marcheTtc) * 100) : 0;
  await pool.query(`update project.project set progress_pct=$2 where id=$1`, [projectId, progress]);
}

async function migrateRevisionConfig(
  lp: LegacyProject,
  projectId: string,
  formulaIdMap: Map<number, string>,
): Promise<void> {
  const configs = await q(`select * from "${L}".project_revision_config where project_id=$1`, [
    lp.id,
  ]);
  const config = configs[0];
  if (!config) return;
  await pool.query(
    `insert into project.project_revision_config (id, project_id, formula_id, base_indexes, base_date, is_enabled, notes)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (project_id) do update set formula_id=excluded.formula_id,
       base_indexes=excluded.base_indexes, base_date=excluded.base_date,
       is_enabled=excluded.is_enabled, notes=excluded.notes, updated_at=now()`,
    [
      md5Uuid(`revcfg:${config.id}`),
      projectId,
      config.formula_id != null ? (formulaIdMap.get(Number(config.formula_id)) ?? null) : null,
      config.base_indexes ?? {},
      config.base_date ?? null,
      config.is_enabled ?? true,
      config.notes ?? null,
    ],
  );
  bump('revisionConfigs');
}

async function migrateRegistres(lp: LegacyProject, projectId: string): Promise<void> {
  // Avenants (upsert par id — préserve les avenants natifs).
  const avenants = await q(
    `select * from "${L}".avenants where project_id=$1 and deleted_at is null`,
    [lp.id],
  ).catch(() => [] as Record<string, unknown>[]);
  for (const a of avenants) {
    await pool.query(
      `insert into project.avenant (id, project_id, numero, objet, montant_delta_mad,
         delai_delta_mois, approved_at, reference, type_avenant, statut, date_avenant,
         date_notification, date_approbation, montant_initial_mad, montant_nouveau_mad,
         pourcentage_variation, modifications, prix_nouveaux, observations, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (id) do update set statut=excluded.statut, objet=excluded.objet,
         montant_delta_mad=excluded.montant_delta_mad, updated_at=now()`,
      [
        a.id,
        projectId,
        num(a.numero),
        a.objet ?? '—',
        num(a.montant_avenant),
        num(a.delais_supplementaire),
        a.statut === 'approuve' ? (a.date_approbation ?? a.created_at) : null,
        a.reference ?? null,
        a.type_avenant ?? 'modification',
        a.statut ?? 'brouillon',
        a.date_avenant ?? null,
        a.date_notification ?? null,
        a.date_approbation ?? null,
        a.montant_initial != null ? num(a.montant_initial) : null,
        a.montant_nouveau != null ? num(a.montant_nouveau) : null,
        a.pourcentage_variation != null ? num(a.pourcentage_variation) : null,
        JSON.stringify(a.modifications ?? []),
        JSON.stringify(a.prix_nouveaux ?? []),
        a.observations ?? null,
        a.created_at ?? new Date(),
      ],
    );
    bump('avenants');
  }

  // ODS.
  const odsList = await q(`select * from "${L}".ordres_service where project_id=$1`, [lp.id]).catch(
    () => [] as Record<string, unknown>[],
  );
  for (const o of odsList) {
    await pool.query(
      `insert into project.ordre_service (id, project_id, numero, reference, type, objet,
         description, motif, date_emission, date_effet, date_fin, delai_jours,
         impact_financier_mad, impact_delai_jours, emetteur, emetteur_fonction, destinataire,
         statut, date_notification, date_accuse_reception, accuse_par,
         observations_destinataire, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        o.id,
        projectId,
        num(o.numero),
        o.reference ?? null,
        o.type ?? 'autre',
        o.objet ?? '—',
        o.description ?? null,
        o.motif ?? null,
        o.date_emission ?? null,
        o.date_effet ?? null,
        o.date_fin ?? null,
        o.delai_jours != null ? num(o.delai_jours) : null,
        num(o.impact_financier),
        num(o.impact_delai),
        o.emetteur ?? null,
        o.emetteur_fonction ?? null,
        o.destinataire ?? null,
        o.statut ?? 'brouillon',
        o.date_notification ?? null,
        o.date_accuse_reception ?? null,
        o.accuse_par ?? null,
        o.observations_destinataire ?? null,
        o.created_at ?? new Date(),
      ],
    );
    bump('ods');
  }

  // Pénalités / cautions / retenues.
  const penalites = await q(`select * from "${L}".penalties where project_id=$1`, [lp.id]).catch(
    () => [] as Record<string, unknown>[],
  );
  for (const p of penalites) {
    await pool.query(
      `insert into project.penalite (id, project_id, type, date_debut, date_fin, nombre_jours,
         taux, base_calcul_mad, montant_penalite_mad, plafond_pourcentage, montant_plafond_mad,
         montant_applique_mad, statut, reference_notification, date_notification, motif,
         observations, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        p.id,
        projectId,
        p.type ?? 'retard',
        p.date_debut ?? null,
        p.date_fin ?? null,
        num(p.nombre_jours),
        num(p.taux) || 0.001,
        p.base_calcul != null ? num(p.base_calcul) : null,
        num(p.montant_penalite),
        num(p.plafond_pourcentage) || 10,
        p.montant_plafond != null ? num(p.montant_plafond) : null,
        num(p.montant_applique),
        p.statut ?? 'calculee',
        p.reference_notification ?? null,
        p.date_notification ?? null,
        p.motif ?? null,
        p.observations ?? null,
        p.created_at ?? new Date(),
      ],
    );
    bump('penalites');
  }
  const cautions = await q(`select * from "${L}".bonds where project_id=$1`, [lp.id]).catch(
    () => [] as Record<string, unknown>[],
  );
  for (const b of cautions) {
    await pool.query(
      `insert into project.caution (id, project_id, type, montant_mad, pourcentage,
         base_calcul_mad, organisme, reference_organisme, date_emission, date_expiration,
         date_mainlevee, statut, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        b.id,
        projectId,
        b.type ?? 'caution_definitive',
        num(b.montant),
        b.pourcentage != null ? num(b.pourcentage) : null,
        b.base_calcul != null ? num(b.base_calcul) : null,
        b.organisme ?? null,
        b.reference_organisme ?? null,
        b.date_emission ?? null,
        b.date_expiration ?? null,
        b.date_mainlevee ?? null,
        b.statut ?? 'active',
        b.created_at ?? new Date(),
      ],
    );
    bump('cautions');
  }
  const retenues = await q(`select * from "${L}".retentions where project_id=$1`, [lp.id]).catch(
    () => [] as Record<string, unknown>[],
  );
  for (const r of retenues) {
    await pool.query(
      `insert into project.retenue (id, project_id, caution_id, decompte_id, decompte_numero,
         montant_decompte_mad, taux_retenue, montant_retenue_mad, montant_cumule_mad,
         liberee, date_liberation, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        r.id,
        projectId,
        r.bond_id ?? null,
        r.decompt_id ?? null,
        r.decompt_numero != null ? num(r.decompt_numero) : null,
        r.montant_decompt != null ? num(r.montant_decompt) : null,
        num(r.taux_retenue) || 7,
        num(r.montant_retenue),
        r.montant_cumule != null ? num(r.montant_cumule) : null,
        Boolean(r.liberee),
        r.date_liberation ?? null,
        r.created_at ?? new Date(),
      ],
    );
    bump('retenues');
  }
}

// ─── Photothèque / PV / documents ────────────────────────────────────────────

async function migrateAssets(
  lp: LegacyProject,
  projectId: string,
  storage: ObjectStorage | null,
): Promise<void> {
  // Albums d'abord (les photos y font référence).
  const albums = await q(`select * from "${L}".photo_albums where project_id=$1`, [lp.id]).catch(
    () => [] as Record<string, unknown>[],
  );
  for (const album of albums) {
    await pool.query(
      `insert into project.photo_album (id, project_id, name, description, color, icon,
         sort_order, periode_id, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
      [
        album.id,
        projectId,
        album.name ?? 'Album',
        album.description ?? null,
        album.color ?? '#22d3ee',
        album.icon ?? 'folder',
        num(album.sort_order),
        album.periode_id ?? null,
        album.created_by ? String(album.created_by) : null,
        album.created_at ?? new Date(),
      ],
    );
    bump('albums');
  }

  const migratedPaths = new Set<string>();
  async function pushAsset(row: {
    id: string;
    type: string;
    fileName: string | null;
    originalName: string | null;
    mime: string | null;
    size: number | null;
    relPath: string | null;
    albumId?: string | null;
    metadata?: Record<string, unknown>;
    createdBy?: string | null;
    createdAt?: unknown;
  }): Promise<void> {
    let storageKey: string | null = null;
    let sha: string | null = null;
    if (row.relPath) {
      const rel = row.relPath.replace(/^\/?uploads\//, '').replace(/^\//, '');
      migratedPaths.add(rel);
      if (storage) {
        const absolute = path.join(UPLOADS_DIR, rel);
        if (existsSync(absolute)) {
          try {
            const body = await readFile(absolute);
            const fileName = sanitizeFilename(row.fileName ?? path.basename(rel));
            storageKey = `btp/${projectId}/${row.id}/${fileName}`;
            const stored = await storage.put(
              storageKey,
              body,
              row.mime ?? 'application/octet-stream',
            );
            sha = stored.sha256;
            bump('filesUploaded');
          } catch (error) {
            console.warn(`  ! upload raté ${rel}:`, (error as Error).message);
            storageKey = null;
          }
        } else {
          bump('filesMissing');
        }
      }
    }
    await pool.query(
      `insert into project.project_asset (id, project_id, type, file_name, original_name,
         mime_type, file_size, storage_key, sha256, album_id, metadata, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing`,
      [
        row.id,
        projectId,
        row.type,
        row.fileName,
        row.originalName,
        row.mime,
        row.size,
        storageKey,
        sha,
        row.albumId ?? null,
        JSON.stringify(row.metadata ?? {}),
        row.createdBy ?? null,
        row.createdAt ?? new Date(),
      ],
    );
    bump(`assets:${row.type}`);
  }

  // Système v2 (project_assets) — la source de vérité récente.
  const v2 = await q(
    `select * from "${L}".project_assets where project_id=$1 and deleted_at is null`,
    [lp.id],
  ).catch(() => [] as Record<string, unknown>[]);
  for (const asset of v2) {
    const metadata = (asset.metadata as Record<string, unknown>) ?? {};
    await pushAsset({
      id: String(asset.id),
      type: ['photo', 'pv', 'document'].includes(String(asset.type))
        ? String(asset.type)
        : 'document',
      fileName: (asset.file_name as string) ?? null,
      originalName: (asset.original_name as string) ?? null,
      mime: (asset.mime_type as string) ?? null,
      size: asset.file_size != null ? num(asset.file_size) : null,
      relPath: (asset.storage_path as string) ?? null,
      albumId: (metadata.albumId as string) ?? null,
      metadata,
      createdBy: asset.created_by ? String(asset.created_by) : null,
      createdAt: asset.created_at,
    });
  }

  // Système v1 (photos historiques) — seulement les fichiers non déjà migrés.
  const v1Photos = await q(
    `select * from "${L}".photos where project_id=$1 and deleted_at is null`,
    [lp.id],
  ).catch(() => [] as Record<string, unknown>[]);
  for (const photo of v1Photos) {
    const rel = String(photo.file_path ?? '')
      .replace(/^\/?uploads\//, '')
      .replace(/^\//, '');
    if (!rel || migratedPaths.has(rel)) continue;
    await pushAsset({
      id: String(photo.id),
      type: 'photo',
      fileName: (photo.file_name as string) ?? null,
      originalName: (photo.file_name as string) ?? null,
      mime: (photo.mime_type as string) ?? 'image/jpeg',
      size: photo.file_size != null ? num(photo.file_size) : null,
      relPath: rel,
      metadata: { description: photo.description ?? undefined, legacy: 'photos-v1' },
      createdAt: photo.created_at,
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Migration btpdb (schéma "${L}") → module BTP natif`);
  const storage = buildStorage();
  if (!storage) console.warn('S3_* non configuré — fichiers ignorés (rows sans storage_key).');
  if (!existsSync(UPLOADS_DIR)) {
    console.warn(`${UPLOADS_DIR} introuvable — les fichiers seront marqués manquants.`);
  }

  const formulaIdMap = await migrateRevisionReference();

  const legacyProjects = await q<LegacyProject>(
    `select * from "${L}".projects order by created_at asc`,
  );
  console.log(`${legacyProjects.length} projets legacy à traiter…`);
  for (const lp of legacyProjects) {
    const label = String(lp.marche_no ?? lp.id);
    try {
      const projectId = await upsertProject(lp);
      await wipeSatellites(projectId);
      await migrateChain(lp, projectId);
      await migrateRevisionConfig(lp, projectId, formulaIdMap);
      await migrateRegistres(lp, projectId);
      await migrateAssets(lp, projectId, storage);
      console.log(`  ✔ ${label}`);
    } catch (error) {
      bump('projectErrors');
      console.error(`  ✖ ${label}:`, (error as Error).message);
    }
  }

  console.log('\nRésumé:', JSON.stringify(counts, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error('Migration échouée:', error);
  process.exit(1);
});
