'use server';

// Server actions of the BTP project detail (fiche, bordereau, périodes/métrés,
// décomptes, révision, registres, photothèque). Every action reads its ids from
// the form, calls Core under the session token, revalidates and redirects with
// a stable ?error= code on failure (house pattern).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiDelete, apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { apiPut, apiUpload, type BtpProject } from '@/lib/btp';
import { isRedirectError } from '@/lib/next-redirect';

function str(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function opt(formData: FormData, name: string): string | undefined {
  const value = str(formData, name);
  return value ? value : undefined;
}

function num(formData: FormData, name: string): number | undefined {
  const raw = str(formData, name);
  if (!raw) return undefined;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function backTo(formData: FormData, fallback: string): string {
  const target = str(formData, 'backTo');
  return target.startsWith('/') ? target : fallback;
}

function fail(target: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[btp] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  const code = status === 400 ? 'invalid' : status === 409 ? 'conflict' : 'failed';
  const sep = target.includes('?') ? '&' : '?';
  redirect(`${target}${sep}error=${action}&code=${code}`);
}

function done(target: string): never {
  revalidatePath('/projects');
  redirect(target);
}

// ─── Fiche marché ────────────────────────────────────────────────────────────

export async function updateFiche(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?tab=apercu`);
  try {
    await apiPatch(`/btp/projects/${id}`, {
      reference: opt(formData, 'reference'),
      name: opt(formData, 'objet')?.slice(0, 180),
      objet: opt(formData, 'objet'),
      buyerName: opt(formData, 'maitreOeuvre'),
      annee: opt(formData, 'annee'),
      societe: opt(formData, 'societe'),
      commune: opt(formData, 'commune'),
      typeMarche: opt(formData, 'typeMarche'),
      modePassation: opt(formData, 'modePassation'),
      rc: opt(formData, 'rc'),
      cb: opt(formData, 'cb'),
      cnss: opt(formData, 'cnss'),
      patente: opt(formData, 'patente'),
      programme: opt(formData, 'programme'),
      projetLibelle: opt(formData, 'projetLibelle'),
      ligneBudgetaire: opt(formData, 'ligneBudgetaire'),
      chapitre: opt(formData, 'chapitre'),
      assistanceTechnique: opt(formData, 'assistanceTechnique'),
      maitreOeuvre: opt(formData, 'maitreOeuvre'),
      dateOuverture: opt(formData, 'dateOuverture') ?? null,
      ordreServiceDate: opt(formData, 'osc') ?? null,
      delaiMois: num(formData, 'delaiMois') ?? null,
      receptionProvisoire: opt(formData, 'receptionProvisoire') ?? null,
      receptionDefinitive: opt(formData, 'receptionDefinitive') ?? null,
      achevementTravaux: opt(formData, 'achevementTravaux') ?? null,
    });
  } catch (error) {
    fail(target, 'updateFiche', error);
  }
  revalidatePath(`/projects/${id}`);
  done(`${target}${target.includes('?') ? '&' : '?'}saved=1`);
}

export async function transitionStatus(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?tab=apercu`);
  try {
    // Legacy endpoint keeps the chantier state machine authoritative.
    await apiPost(`/project/projects/${id}/transition`, { to: str(formData, 'to') });
  } catch (error) {
    fail(target, 'transitionStatus', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

function randomKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function addArret(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?tab=apercu`);
  const dateArret = str(formData, 'dateArret');
  if (!dateArret) fail(target, 'addArret', new AtlasApiError('arret', 400));
  try {
    const project = await apiGet<BtpProject>(`/btp/projects/${id}`);
    const arrets = [
      ...(project.arrets ?? []),
      {
        id: `arret-${randomKey()}`,
        dateArret,
        dateReprise: opt(formData, 'dateReprise') ?? null,
        motif: opt(formData, 'motif') ?? null,
      },
    ];
    await apiPatch(`/btp/projects/${id}`, { arrets });
  } catch (error) {
    fail(target, 'addArret', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function setArretReprise(formData: FormData) {
  const id = str(formData, 'projectId');
  const arretId = str(formData, 'arretId');
  const dateReprise = str(formData, 'dateReprise');
  const target = backTo(formData, `/projects/${id}?tab=apercu`);
  try {
    const project = await apiGet<BtpProject>(`/btp/projects/${id}`);
    const arrets = (project.arrets ?? []).map((arret) =>
      arret.id === arretId ? { ...arret, dateReprise: dateReprise || null } : arret,
    );
    await apiPatch(`/btp/projects/${id}`, { arrets });
  } catch (error) {
    fail(target, 'setArretReprise', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function removeArret(formData: FormData) {
  const id = str(formData, 'projectId');
  const arretId = str(formData, 'arretId');
  const target = backTo(formData, `/projects/${id}?tab=apercu`);
  try {
    const project = await apiGet<BtpProject>(`/btp/projects/${id}`);
    const arrets = (project.arrets ?? []).filter((arret) => arret.id !== arretId);
    await apiPatch(`/btp/projects/${id}`, { arrets });
  } catch (error) {
    fail(target, 'removeArret', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function softDeleteProject(formData: FormData) {
  const id = str(formData, 'projectId');
  try {
    await apiDelete(`/btp/projects/${id}`);
  } catch (error) {
    fail(`/projects/${id}?tab=apercu`, 'softDeleteProject', error);
  }
  done('/projects?deleted=1');
}

export async function restoreProject(formData: FormData) {
  const id = str(formData, 'projectId');
  try {
    await apiPost(`/btp/projects/${id}/restore`);
  } catch (error) {
    fail('/projects/corbeille', 'restoreProject', error);
  }
  done('/projects/corbeille?restored=1');
}

// ─── Bordereau ───────────────────────────────────────────────────────────────

export async function saveBordereau(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=bordereau`;
  let lignes: unknown;
  try {
    lignes = JSON.parse(str(formData, 'lignes'));
  } catch {
    fail(target, 'saveBordereau', new AtlasApiError('bordereau', 400));
  }
  try {
    await apiPut(`/btp/projects/${id}/bordereau`, {
      reference: opt(formData, 'reference'),
      designation: opt(formData, 'designation'),
      lignes,
    });
  } catch (error) {
    fail(target, 'saveBordereau', error);
  }
  revalidatePath(`/projects/${id}`);
  done(`${target}&saved=1`);
}

// ─── Périodes & métrés ───────────────────────────────────────────────────────

export async function createPeriode(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=metres`;
  let created: { periode: { id: string } };
  try {
    created = await apiPost(`/btp/projects/${id}/periodes`, {
      libelle: opt(formData, 'libelle'),
      dateDebut: opt(formData, 'dateDebut'),
      dateFin: opt(formData, 'dateFin'),
      tauxTva: num(formData, 'tauxTva'),
      tauxRetenue: num(formData, 'tauxRetenue'),
      isDecompteDernier: str(formData, 'isDecompteDernier') === 'on',
    });
  } catch (error) {
    fail(target, 'createPeriode', error);
  }
  revalidatePath(`/projects/${id}`);
  // Direct au travail: open the métré editor of the fresh période.
  done(`/projects/${id}/metres/${created.periode.id}`);
}

export async function patchPeriode(formData: FormData) {
  const id = str(formData, 'projectId');
  const periodeId = str(formData, 'periodeId');
  const target = backTo(formData, `/projects/${id}?tab=metres`);
  const patch: Record<string, unknown> = {};
  if (opt(formData, 'libelle')) patch.libelle = opt(formData, 'libelle');
  if (str(formData, 'dateDebut')) patch.dateDebut = str(formData, 'dateDebut');
  if (str(formData, 'dateFin')) patch.dateFin = str(formData, 'dateFin');
  if (num(formData, 'tauxTva') !== undefined) patch.tauxTva = num(formData, 'tauxTva');
  if (num(formData, 'tauxRetenue') !== undefined) patch.tauxRetenue = num(formData, 'tauxRetenue');
  if (formData.has('isDecompteDernierFlag')) {
    patch.isDecompteDernier = str(formData, 'isDecompteDernier') === 'on';
  }
  if (opt(formData, 'statut')) patch.statut = opt(formData, 'statut');
  if (formData.has('observations')) patch.observations = str(formData, 'observations');
  try {
    await apiPatch(`/btp/projects/${id}/periodes/${periodeId}`, patch);
  } catch (error) {
    fail(target, 'patchPeriode', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deletePeriode(formData: FormData) {
  const id = str(formData, 'projectId');
  const periodeId = str(formData, 'periodeId');
  const target = `/projects/${id}?tab=metres`;
  try {
    await apiDelete(`/btp/projects/${id}/periodes/${periodeId}`);
  } catch (error) {
    fail(target, 'deletePeriode', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function saveMetres(formData: FormData) {
  const id = str(formData, 'projectId');
  const periodeId = str(formData, 'periodeId');
  const target = `/projects/${id}/metres/${periodeId}`;
  let entries: unknown;
  try {
    entries = JSON.parse(str(formData, 'entries'));
  } catch {
    fail(target, 'saveMetres', new AtlasApiError('metres', 400));
  }
  try {
    // The core rebuilds the décompte chain inside the same transaction.
    await apiPut(`/btp/projects/${id}/periodes/${periodeId}/metres`, { entries });
  } catch (error) {
    fail(target, 'saveMetres', error);
  }
  revalidatePath(`/projects/${id}`);
  revalidatePath(target);
  done(`${target}?saved=1`);
}

// ─── Décomptes ───────────────────────────────────────────────────────────────

export async function patchDecompte(formData: FormData) {
  const id = str(formData, 'projectId');
  const decompteId = str(formData, 'decompteId');
  const target = backTo(formData, `/projects/${id}/decomptes/${decompteId}`);
  const patch: Record<string, unknown> = {};
  if (opt(formData, 'statut')) patch.statut = opt(formData, 'statut');
  if (formData.has('dateDecompte')) {
    patch.dateDecompte = opt(formData, 'dateDecompte') ?? null;
  }
  try {
    await apiPatch(`/btp/projects/${id}/decomptes/${decompteId}`, patch);
  } catch (error) {
    fail(target, 'patchDecompte', error);
  }
  revalidatePath(`/projects/${id}`);
  revalidatePath(target);
  done(target);
}

// ─── Révision des prix ───────────────────────────────────────────────────────

export async function saveRevisionConfig(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=revision`;
  let baseIndexes: Record<string, number> | undefined;
  const rawBase = str(formData, 'baseIndexes');
  if (rawBase) {
    try {
      baseIndexes = JSON.parse(rawBase) as Record<string, number>;
    } catch {
      fail(target, 'saveRevisionConfig', new AtlasApiError('revision', 400));
    }
  }
  try {
    await apiPut(`/btp/projects/${id}/revision/config`, {
      formulaId: opt(formData, 'formulaId') ?? null,
      baseIndexes,
      baseDate: opt(formData, 'baseDate') ?? null,
      isEnabled: str(formData, 'isEnabled') === 'on',
      notes: opt(formData, 'notes') ?? null,
    });
  } catch (error) {
    fail(target, 'saveRevisionConfig', error);
  }
  revalidatePath(`/projects/${id}`);
  done(`${target}&saved=1`);
}

// ─── Avenants ────────────────────────────────────────────────────────────────

export async function createAvenant(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=avenants`;
  try {
    await apiPost(`/btp/projects/${id}/avenants`, {
      objet: str(formData, 'objet'),
      reference: opt(formData, 'reference'),
      typeAvenant: opt(formData, 'typeAvenant'),
      dateAvenant: opt(formData, 'dateAvenant'),
      montantDeltaMad: num(formData, 'montantDeltaMad') ?? 0,
      delaiDeltaMois: num(formData, 'delaiDeltaMois') ?? 0,
      observations: opt(formData, 'observations'),
    });
  } catch (error) {
    fail(target, 'createAvenant', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function transitionAvenant(formData: FormData) {
  const id = str(formData, 'projectId');
  const avenantId = str(formData, 'avenantId');
  const target = `/projects/${id}?tab=avenants`;
  try {
    await apiPost(`/btp/projects/${id}/avenants/${avenantId}/transition`, {
      to: str(formData, 'to'),
    });
  } catch (error) {
    fail(target, 'transitionAvenant', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteAvenant(formData: FormData) {
  const id = str(formData, 'projectId');
  const avenantId = str(formData, 'avenantId');
  const target = `/projects/${id}?tab=avenants`;
  try {
    await apiDelete(`/btp/projects/${id}/avenants/${avenantId}`);
  } catch (error) {
    fail(target, 'deleteAvenant', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

// ─── Ordres de service ───────────────────────────────────────────────────────

export async function createOds(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=ods`;
  try {
    await apiPost(`/btp/projects/${id}/ods`, {
      type: opt(formData, 'type'),
      objet: str(formData, 'objet'),
      description: opt(formData, 'description'),
      motif: opt(formData, 'motif'),
      dateEmission: opt(formData, 'dateEmission'),
      dateEffet: opt(formData, 'dateEffet'),
      delaiJours: num(formData, 'delaiJours'),
      impactDelaiJours: num(formData, 'impactDelaiJours'),
      impactFinancierMad: num(formData, 'impactFinancierMad'),
      emetteur: opt(formData, 'emetteur'),
      destinataire: opt(formData, 'destinataire'),
    });
  } catch (error) {
    fail(target, 'createOds', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function actionOds(formData: FormData) {
  const id = str(formData, 'projectId');
  const odsId = str(formData, 'odsId');
  const target = `/projects/${id}?tab=ods`;
  try {
    await apiPost(`/btp/projects/${id}/ods/${odsId}/action`, {
      action: str(formData, 'action'),
      accusePar: opt(formData, 'accusePar'),
    });
  } catch (error) {
    fail(target, 'actionOds', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteOds(formData: FormData) {
  const id = str(formData, 'projectId');
  const odsId = str(formData, 'odsId');
  const target = `/projects/${id}?tab=ods`;
  try {
    await apiDelete(`/btp/projects/${id}/ods/${odsId}`);
  } catch (error) {
    fail(target, 'deleteOds', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

// ─── Pénalités / cautions / retenues ─────────────────────────────────────────

export async function createPenalite(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=penalites`;
  try {
    await apiPost(`/btp/projects/${id}/penalites`, {
      type: opt(formData, 'type'),
      dateDebut: opt(formData, 'dateDebut'),
      dateFin: opt(formData, 'dateFin'),
      nombreJours: num(formData, 'nombreJours') ?? 0,
      taux: num(formData, 'taux'),
      baseCalculMad: num(formData, 'baseCalculMad'),
      plafondPourcentage: num(formData, 'plafondPourcentage'),
      motif: opt(formData, 'motif'),
    });
  } catch (error) {
    fail(target, 'createPenalite', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function transitionPenalite(formData: FormData) {
  const id = str(formData, 'projectId');
  const penaliteId = str(formData, 'penaliteId');
  const target = `/projects/${id}?tab=penalites`;
  try {
    await apiPost(`/btp/projects/${id}/penalites/${penaliteId}/transition`, {
      to: str(formData, 'to'),
      referenceNotification: opt(formData, 'referenceNotification'),
    });
  } catch (error) {
    fail(target, 'transitionPenalite', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createCaution(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=penalites`;
  try {
    await apiPost(`/btp/projects/${id}/cautions`, {
      type: str(formData, 'type'),
      montantMad: num(formData, 'montantMad'),
      pourcentage: num(formData, 'pourcentage'),
      baseCalculMad: num(formData, 'baseCalculMad'),
      organisme: opt(formData, 'organisme'),
      referenceOrganisme: opt(formData, 'referenceOrganisme'),
      dateEmission: opt(formData, 'dateEmission'),
      dateExpiration: opt(formData, 'dateExpiration'),
    });
  } catch (error) {
    fail(target, 'createCaution', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function transitionCaution(formData: FormData) {
  const id = str(formData, 'projectId');
  const cautionId = str(formData, 'cautionId');
  const target = `/projects/${id}?tab=penalites`;
  try {
    await apiPost(`/btp/projects/${id}/cautions/${cautionId}/transition`, {
      to: str(formData, 'to'),
    });
  } catch (error) {
    fail(target, 'transitionCaution', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function libererRetenue(formData: FormData) {
  const id = str(formData, 'projectId');
  const retenueId = str(formData, 'retenueId');
  const target = `/projects/${id}?tab=penalites`;
  try {
    await apiPost(`/btp/projects/${id}/retenues/${retenueId}/liberer`);
  } catch (error) {
    fail(target, 'libererRetenue', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

// ─── Circuit de validation ───────────────────────────────────────────────────

export async function createValidation(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=validations`;
  const steps = [1, 2, 3]
    .map((i) => ({
      stepLabel: str(formData, `step${i}Label`),
      role: opt(formData, `step${i}Role`),
    }))
    .filter((step) => step.stepLabel.length >= 2);
  try {
    await apiPost(`/btp/projects/${id}/validations`, {
      documentType: str(formData, 'documentType'),
      documentReference: opt(formData, 'documentReference'),
      priority: opt(formData, 'priority'),
      dueDate: opt(formData, 'dueDate'),
      note: opt(formData, 'note'),
      montantMad: num(formData, 'montantMad'),
      steps: steps.length > 0 ? steps : undefined,
    });
  } catch (error) {
    fail(target, 'createValidation', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function decideValidation(formData: FormData) {
  const id = str(formData, 'projectId');
  const requestId = str(formData, 'requestId');
  const target = `/projects/${id}?tab=validations`;
  try {
    await apiPost(`/btp/validations/${requestId}/decision`, {
      decision: str(formData, 'decision'),
      comment: opt(formData, 'comment'),
    });
  } catch (error) {
    fail(target, 'decideValidation', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

// ─── Photothèque / documents ─────────────────────────────────────────────────

export async function createAlbum(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = `/projects/${id}?tab=photos`;
  try {
    await apiPost(`/btp/projects/${id}/albums`, {
      name: str(formData, 'name'),
      description: opt(formData, 'description'),
      color: opt(formData, 'color'),
    });
  } catch (error) {
    fail(target, 'createAlbum', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteAlbum(formData: FormData) {
  const id = str(formData, 'projectId');
  const albumId = str(formData, 'albumId');
  const target = `/projects/${id}?tab=photos`;
  try {
    await apiDelete(`/btp/projects/${id}/albums/${albumId}`);
  } catch (error) {
    fail(target, 'deleteAlbum', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function uploadAssets(formData: FormData) {
  const id = str(formData, 'projectId');
  const type = str(formData, 'type') || 'photo';
  const tab = type === 'photo' ? 'photos' : 'documents';
  const target = backTo(formData, `/projects/${id}?tab=${tab}`);
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    fail(target, 'uploadAssets', new AtlasApiError('upload', 400));
  }
  const upload = new FormData();
  for (const file of files) upload.append('files', file);
  upload.set('type', type);
  const albumId = str(formData, 'albumId');
  if (albumId) upload.set('albumId', albumId);
  const description = str(formData, 'description');
  if (description) upload.set('description', description);
  const pvType = str(formData, 'pvType');
  if (pvType) upload.set('metadata', JSON.stringify({ pvType }));
  try {
    await apiUpload(`/btp/projects/${id}/assets/upload`, upload, { timeoutMs: 180_000 });
  } catch (error) {
    fail(target, 'uploadAssets', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteAsset(formData: FormData) {
  const id = str(formData, 'projectId');
  const assetId = str(formData, 'assetId');
  const target = backTo(formData, `/projects/${id}?tab=photos`);
  try {
    await apiDelete(`/btp/projects/${id}/assets/${assetId}`);
  } catch (error) {
    fail(target, 'deleteAsset', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function moveAssetToAlbum(formData: FormData) {
  const id = str(formData, 'projectId');
  const assetId = str(formData, 'assetId');
  const target = `/projects/${id}?tab=photos`;
  try {
    await apiPatch(`/btp/projects/${id}/assets/${assetId}`, {
      albumId: opt(formData, 'albumId') ?? null,
    });
  } catch (error) {
    fail(target, 'moveAssetToAlbum', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

// ─── Terrain — saisie chantier ───────────────────────────────────────────────

export async function createRapportChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=rapports`);
  try {
    await apiPost(`/btp/projects/${id}/terrain/rapports`, {
      reportDate: str(formData, 'reportDate'),
      effectifs: num(formData, 'effectifs') ?? 0,
      travauxRealises: str(formData, 'travauxRealises'),
      materiel: opt(formData, 'materiel'),
      meteo: opt(formData, 'meteo'),
      blocages: opt(formData, 'blocages'),
      incidentsSecurite: num(formData, 'incidentsSecurite') ?? 0,
      heuresTravail: num(formData, 'heuresTravail'),
      visites: opt(formData, 'visites'),
      avancement: opt(formData, 'avancement'),
    });
  } catch (error) {
    fail(target, 'createRapportChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteRapportChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const rapportId = str(formData, 'rapportId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=rapports`);
  try {
    await apiDelete(`/btp/projects/${id}/terrain/rapports/${rapportId}`);
  } catch (error) {
    fail(target, 'deleteRapportChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createPointage(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=pointage`);
  try {
    await apiPost(`/btp/projects/${id}/terrain/pointage`, {
      assignmentId: str(formData, 'assignmentId'),
      workDate: str(formData, 'workDate'),
      daysWorked: num(formData, 'daysWorked') ?? 1,
      notes: opt(formData, 'notes'),
    });
  } catch (error) {
    fail(target, 'createPointage', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createMaterielChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=materiel`);
  try {
    await apiPost(`/btp/projects/${id}/terrain/materiel`, {
      date: str(formData, 'date'),
      engin: str(formData, 'engin'),
      regime: opt(formData, 'regime') ?? 'propre',
      heuresUtilisation: num(formData, 'heuresUtilisation'),
      carburantL: num(formData, 'carburantL'),
      coutCarburantMad: num(formData, 'coutCarburantMad') ?? 0,
      coutLocationMad: num(formData, 'coutLocationMad') ?? 0,
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createMaterielChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteMaterielChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const ligneId = str(formData, 'ligneId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=materiel`);
  try {
    await apiDelete(`/btp/projects/${id}/terrain/materiel/${ligneId}`);
  } catch (error) {
    fail(target, 'deleteMaterielChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createConsommation(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=consommations`);
  try {
    await apiPost(`/btp/projects/${id}/terrain/consommations`, {
      date: str(formData, 'date'),
      article: str(formData, 'article'),
      unite: opt(formData, 'unite') ?? 'u',
      quantite: num(formData, 'quantite') ?? 0,
      prixUnitaireMad: num(formData, 'prixUnitaireMad'),
      coutMad: num(formData, 'coutMad') ?? 0,
      fournisseur: opt(formData, 'fournisseur'),
      bonLivraison: opt(formData, 'bonLivraison'),
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createConsommation', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteConsommation(formData: FormData) {
  const id = str(formData, 'projectId');
  const ligneId = str(formData, 'ligneId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=consommations`);
  try {
    await apiDelete(`/btp/projects/${id}/terrain/consommations/${ligneId}`);
  } catch (error) {
    fail(target, 'deleteConsommation', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createDepenseChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=depenses`);
  try {
    // Justificatif photo (facultatif): d'abord l'asset, puis la dépense liée.
    let justificatifAssetId: string | undefined;
    const justificatif = formData.get('justificatif');
    if (justificatif instanceof File && justificatif.size > 0) {
      const upload = new FormData();
      upload.append('files', justificatif);
      upload.append('type', justificatif.type.startsWith('image/') ? 'photo' : 'document');
      upload.append('description', `Justificatif — ${str(formData, 'label')}`);
      const created = await apiUpload<Array<{ id: string }>>(
        `/btp/projects/${id}/assets/upload`,
        upload,
      );
      justificatifAssetId = created[0]?.id;
    }
    await apiPost(`/btp/projects/${id}/terrain/depenses`, {
      spentAt: str(formData, 'spentAt'),
      category: str(formData, 'category'),
      label: str(formData, 'label'),
      amountMad: num(formData, 'amountMad') ?? 0,
      method: opt(formData, 'method'),
      reference: opt(formData, 'reference'),
      notes: opt(formData, 'notes'),
      justificatifAssetId,
    });
  } catch (error) {
    fail(target, 'createDepenseChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteDepenseChantier(formData: FormData) {
  const id = str(formData, 'projectId');
  const depenseId = str(formData, 'depenseId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=depenses`);
  try {
    await apiDelete(`/btp/projects/${id}/terrain/depenses/${depenseId}`);
  } catch (error) {
    fail(target, 'deleteDepenseChantier', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function createAttachementTerrain(formData: FormData) {
  const id = str(formData, 'projectId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=attachements`);
  try {
    // Le select encode la ligne du bordereau: id:::numero:::unite:::designation
    // — un seul champ pour le chef, le snapshot se déduit ici.
    const [ligneId, numeroPrix, unite, ...designationParts] = str(formData, 'ligne').split(':::');
    await apiPost(`/btp/projects/${id}/terrain/attachements`, {
      date: str(formData, 'date'),
      ligneId: ligneId || 'inconnu',
      numeroPrix: numeroPrix || undefined,
      designation: designationParts.join(':::') || '—',
      unite: unite || 'u',
      quantite: num(formData, 'quantite') ?? 0,
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createAttachementTerrain', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function integrerAttachement(formData: FormData) {
  const id = str(formData, 'projectId');
  const attachementId = str(formData, 'attachementId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=attachements`);
  try {
    await apiPost(`/btp/projects/${id}/terrain/attachements/${attachementId}/integrer`);
  } catch (error) {
    fail(target, 'integrerAttachement', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}

export async function deleteAttachementTerrain(formData: FormData) {
  const id = str(formData, 'projectId');
  const attachementId = str(formData, 'attachementId');
  const target = backTo(formData, `/projects/${id}?section=terrain&tab=attachements`);
  try {
    await apiDelete(`/btp/projects/${id}/terrain/attachements/${attachementId}`);
  } catch (error) {
    fail(target, 'deleteAttachementTerrain', error);
  }
  revalidatePath(`/projects/${id}`);
  done(target);
}
