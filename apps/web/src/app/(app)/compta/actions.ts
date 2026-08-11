'use server';

// Server actions du module Comptabilité — toutes les mutations passent par
// l'API core (bearer) puis revalident /compta. Convention d'erreur identique
// aux actions BTP : redirect ?error=<action>&code=<invalid|conflict|failed>.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AtlasApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { apiUpload } from '@/lib/btp';

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function opt(formData: FormData, key: string): string | undefined {
  const value = str(formData, key);
  return value === '' ? undefined : value;
}

function optNull(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value === '' ? null : value;
}

function num(formData: FormData, key: string): number {
  const value = Number(String(formData.get(key) ?? '').replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

function backTo(formData: FormData, fallback: string): string {
  const target = str(formData, 'backTo');
  return target.startsWith('/') ? target : fallback;
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

function fail(target: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[compta] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  const code = status === 400 ? 'invalid' : status === 409 ? 'conflict' : 'failed';
  const sep = target.includes('?') ? '&' : '?';
  redirect(`${target}${sep}error=${action}&code=${code}`);
}

function done(target: string): never {
  revalidatePath('/compta', 'layout');
  const sep = target.includes('?') ? '&' : '?';
  redirect(`${target}${sep}saved=1`);
}

// ── Profil & exercices ───────────────────────────────────────────────────────

export async function updateProfil(formData: FormData) {
  const target = backTo(formData, '/compta/parametres');
  try {
    await apiPatch('/compta/profil', {
      raisonSociale: opt(formData, 'raisonSociale'),
      formeJuridique: opt(formData, 'formeJuridique'),
      capitalSocial: opt(formData, 'capitalSocial') ? num(formData, 'capitalSocial') : null,
      registreCommerce: optNull(formData, 'registreCommerce'),
      identifiantFiscal: optNull(formData, 'identifiantFiscal'),
      ice: optNull(formData, 'ice'),
      taxeProfessionnelle: optNull(formData, 'taxeProfessionnelle'),
      cnssAffiliation: optNull(formData, 'cnssAffiliation'),
      adresse: optNull(formData, 'adresse'),
      ville: optNull(formData, 'ville'),
      gerant: optNull(formData, 'gerant'),
      dateCreation: optNull(formData, 'dateCreation'),
      regimeTva: opt(formData, 'regimeTva'),
      prorataTva: opt(formData, 'prorataTva') ? num(formData, 'prorataTva') : undefined,
      tauxIs: opt(formData, 'tauxIs') ? num(formData, 'tauxIs') : undefined,
      tauxCotisationMinimale: opt(formData, 'tauxCotisationMinimale')
        ? num(formData, 'tauxCotisationMinimale')
        : undefined,
      effectif: opt(formData, 'effectif') ? Math.round(num(formData, 'effectif')) : null,
      assujettiTp: formData.get('assujettiTp') === 'on',
      exonerationTpJusquau: optNull(formData, 'exonerationTpJusquau'),
      notes: optNull(formData, 'notes'),
    });
  } catch (error) {
    fail(target, 'updateProfil', error);
  }
  done(target);
}

export async function createExercice(formData: FormData) {
  const target = backTo(formData, '/compta/parametres');
  try {
    await apiPost('/compta/exercices', { annee: Math.round(num(formData, 'annee')) });
  } catch (error) {
    fail(target, 'createExercice', error);
  }
  done(target);
}

export async function setExerciceStatut(formData: FormData) {
  const target = backTo(formData, '/compta/parametres');
  try {
    await apiPatch(`/compta/exercices/${str(formData, 'annee')}`, {
      statut: str(formData, 'statut'),
    });
  } catch (error) {
    fail(target, 'setExerciceStatut', error);
  }
  done(target);
}

// ── Plan comptable ───────────────────────────────────────────────────────────

export async function createCompte(formData: FormData) {
  const target = backTo(formData, '/compta/plan');
  try {
    await apiPost('/compta/plan', {
      code: str(formData, 'code'),
      intitule: str(formData, 'intitule'),
    });
  } catch (error) {
    fail(target, 'createCompte', error);
  }
  done(target);
}

export async function toggleCompte(formData: FormData) {
  const target = backTo(formData, '/compta/plan');
  try {
    await apiPatch(`/compta/plan/${str(formData, 'code')}`, {
      actif: formData.get('actif') === '1',
    });
  } catch (error) {
    fail(target, 'toggleCompte', error);
  }
  done(target);
}

// ── Écritures ────────────────────────────────────────────────────────────────

interface LignePayload {
  compteCode: string;
  libelle?: string;
  debit: number;
  credit: number;
  tiers?: string;
}

function parseLignes(formData: FormData): LignePayload[] {
  try {
    const parsed = JSON.parse(str(formData, 'lignes')) as LignePayload[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function createEcriture(formData: FormData) {
  const target = backTo(formData, '/compta/ecritures');
  try {
    await apiPost('/compta/ecritures', {
      journalCode: str(formData, 'journalCode'),
      dateEcriture: str(formData, 'dateEcriture'),
      pieceRef: opt(formData, 'pieceRef'),
      libelle: str(formData, 'libelle'),
      lignes: parseLignes(formData),
    });
  } catch (error) {
    fail(target, 'createEcriture', error);
  }
  done(target);
}

export async function updateEcriture(formData: FormData) {
  const id = str(formData, 'id');
  const target = backTo(formData, `/compta/ecritures?ecriture=${id}`);
  try {
    await apiPatch(`/compta/ecritures/${id}`, {
      journalCode: str(formData, 'journalCode'),
      dateEcriture: str(formData, 'dateEcriture'),
      pieceRef: opt(formData, 'pieceRef'),
      libelle: str(formData, 'libelle'),
      lignes: parseLignes(formData),
    });
  } catch (error) {
    fail(target, 'updateEcriture', error);
  }
  done(target);
}

export async function validerEcriture(formData: FormData) {
  const target = backTo(formData, '/compta/ecritures');
  try {
    await apiPost(`/compta/ecritures/${str(formData, 'id')}/valider`, {});
  } catch (error) {
    fail(target, 'validerEcriture', error);
  }
  done(target);
}

export async function deleteEcriture(formData: FormData) {
  const target = backTo(formData, '/compta/ecritures');
  try {
    await apiDelete(`/compta/ecritures/${str(formData, 'id')}`);
  } catch (error) {
    fail(target, 'deleteEcriture', error);
  }
  done(target);
}

export async function genererEcrituresVentes(formData: FormData) {
  const target = backTo(formData, '/compta/ecritures');
  try {
    await apiPost('/compta/ecritures/generer-ventes', {
      annee: Math.round(num(formData, 'annee')),
    });
  } catch (error) {
    fail(target, 'genererEcrituresVentes', error);
  }
  done(target);
}

// ── TVA ──────────────────────────────────────────────────────────────────────

export async function patchTva(formData: FormData) {
  const id = str(formData, 'id');
  const target = backTo(formData, '/compta/tva');
  const payload: Record<string, unknown> = {};
  for (const key of [
    'tvaCollectee',
    'tvaDeductibleCharges',
    'tvaDeductibleImmo',
    'creditAnterieur',
  ]) {
    if (opt(formData, key) !== undefined) payload[key] = num(formData, key);
  }
  if (opt(formData, 'statut')) payload['statut'] = str(formData, 'statut');
  if (str(formData, '_dates') === '1') {
    payload['dateDeclaration'] = optNull(formData, 'dateDeclaration');
    payload['datePaiement'] = optNull(formData, 'datePaiement');
    payload['reference'] = optNull(formData, 'reference');
  }
  try {
    await apiPatch(`/compta/tva/${id}`, payload);
  } catch (error) {
    fail(target, 'patchTva', error);
  }
  done(target);
}

export async function calculerTva(formData: FormData) {
  const target = backTo(formData, '/compta/tva');
  try {
    await apiPost(`/compta/tva/${str(formData, 'id')}/calculer`, {});
  } catch (error) {
    fail(target, 'calculerTva', error);
  }
  done(target);
}

// ── Échéancier fiscal ────────────────────────────────────────────────────────

export async function genererEcheancier(formData: FormData) {
  const target = backTo(formData, '/compta/impots');
  try {
    await apiPost('/compta/declarations/generer', { annee: Math.round(num(formData, 'annee')) });
  } catch (error) {
    fail(target, 'genererEcheancier', error);
  }
  done(target);
}

export async function appliquerAcomptes(formData: FormData) {
  const target = backTo(formData, '/compta/impots');
  try {
    await apiPost('/compta/declarations/acomptes', {
      annee: Math.round(num(formData, 'annee')),
      isN1: num(formData, 'isN1'),
      cotisationMinimaleN1: num(formData, 'cotisationMinimaleN1'),
    });
  } catch (error) {
    fail(target, 'appliquerAcomptes', error);
  }
  done(target);
}

export async function patchDeclaration(formData: FormData) {
  const id = str(formData, 'id');
  const target = backTo(formData, '/compta/impots');
  const payload: Record<string, unknown> = {};
  if (opt(formData, 'montant') !== undefined) payload['montant'] = num(formData, 'montant');
  if (opt(formData, 'statut')) payload['statut'] = str(formData, 'statut');
  if (str(formData, '_dates') === '1') {
    payload['dateDeclaration'] = optNull(formData, 'dateDeclaration');
    payload['datePaiement'] = optNull(formData, 'datePaiement');
    payload['reference'] = optNull(formData, 'reference');
  }
  try {
    await apiPatch(`/compta/declarations/${id}`, payload);
  } catch (error) {
    fail(target, 'patchDeclaration', error);
  }
  done(target);
}

export async function createDeclaration(formData: FormData) {
  const target = backTo(formData, '/compta/impots');
  try {
    await apiPost('/compta/declarations', {
      type: 'autre',
      annee: Math.round(num(formData, 'annee')),
      label: str(formData, 'label'),
      montant: num(formData, 'montant'),
      dateEcheance: str(formData, 'dateEcheance'),
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createDeclaration', error);
  }
  done(target);
}

// ── Social ───────────────────────────────────────────────────────────────────

export async function patchSocial(formData: FormData) {
  const id = str(formData, 'id');
  const target = backTo(formData, '/compta/social');
  const payload: Record<string, unknown> = {};
  if (opt(formData, 'masseSalariale') !== undefined) {
    payload['masseSalariale'] = num(formData, 'masseSalariale');
  }
  if (opt(formData, 'massePlafonnee') !== undefined) {
    payload['massePlafonnee'] = num(formData, 'massePlafonnee');
  }
  if (opt(formData, 'effectif') !== undefined) {
    payload['effectif'] = Math.round(num(formData, 'effectif'));
  }
  if (opt(formData, 'statut')) payload['statut'] = str(formData, 'statut');
  if (str(formData, '_dates') === '1') {
    payload['dateDeclaration'] = optNull(formData, 'dateDeclaration');
    payload['datePaiement'] = optNull(formData, 'datePaiement');
    payload['reference'] = optNull(formData, 'reference');
  }
  try {
    await apiPatch(`/compta/social/${id}`, payload);
  } catch (error) {
    fail(target, 'patchSocial', error);
  }
  done(target);
}

// ── Immobilisations ──────────────────────────────────────────────────────────

export async function createImmobilisation(formData: FormData) {
  const target = backTo(formData, '/compta/immobilisations');
  try {
    await apiPost('/compta/immobilisations', {
      designation: str(formData, 'designation'),
      compteCode: str(formData, 'compteCode'),
      categorie: str(formData, 'categorie'),
      dateAcquisition: str(formData, 'dateAcquisition'),
      dateMiseEnService: opt(formData, 'dateMiseEnService'),
      valeurHt: num(formData, 'valeurHt'),
      tauxAmortissement: num(formData, 'tauxAmortissement'),
      fournisseur: opt(formData, 'fournisseur'),
      pieceRef: opt(formData, 'pieceRef'),
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createImmobilisation', error);
  }
  done(target);
}

export async function cederImmobilisation(formData: FormData) {
  const target = backTo(formData, '/compta/immobilisations');
  try {
    await apiPatch(`/compta/immobilisations/${str(formData, 'id')}`, {
      statut: str(formData, 'statut') || 'cede',
      dateSortie: optNull(formData, 'dateSortie'),
      prixCession: opt(formData, 'prixCession') ? num(formData, 'prixCession') : null,
    });
  } catch (error) {
    fail(target, 'cederImmobilisation', error);
  }
  done(target);
}

export async function deleteImmobilisation(formData: FormData) {
  const target = backTo(formData, '/compta/immobilisations');
  try {
    await apiDelete(`/compta/immobilisations/${str(formData, 'id')}`);
  } catch (error) {
    fail(target, 'deleteImmobilisation', error);
  }
  done(target);
}

// ── Banques ──────────────────────────────────────────────────────────────────

export async function createBanque(formData: FormData) {
  const target = backTo(formData, '/compta/banques');
  try {
    await apiPost('/compta/banques', {
      banque: str(formData, 'banque'),
      agence: opt(formData, 'agence'),
      rib: opt(formData, 'rib'),
      soldeInitial: num(formData, 'soldeInitial'),
      dateSoldeInitial: opt(formData, 'dateSoldeInitial'),
      note: opt(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'createBanque', error);
  }
  done(target);
}

export async function createMouvement(formData: FormData) {
  const compteId = str(formData, 'compteId');
  const target = backTo(formData, `/compta/banques?compte=${compteId}`);
  const sens = str(formData, 'sens') === 'debit' ? -1 : 1;
  try {
    await apiPost(`/compta/banques/${compteId}/mouvements`, {
      dateMouvement: str(formData, 'dateMouvement'),
      libelle: str(formData, 'libelle'),
      montant: Math.abs(num(formData, 'montant')) * sens,
      reference: opt(formData, 'reference'),
    });
  } catch (error) {
    fail(target, 'createMouvement', error);
  }
  done(target);
}

export async function toggleRapproche(formData: FormData) {
  const target = backTo(formData, '/compta/banques');
  try {
    await apiPost(`/compta/mouvements/${str(formData, 'id')}/rapprocher`, {});
  } catch (error) {
    fail(target, 'toggleRapproche', error);
  }
  done(target);
}

export async function deleteMouvement(formData: FormData) {
  const target = backTo(formData, '/compta/banques');
  try {
    await apiDelete(`/compta/mouvements/${str(formData, 'id')}`);
  } catch (error) {
    fail(target, 'deleteMouvement', error);
  }
  done(target);
}

// ── Documents légaux & obligations ───────────────────────────────────────────

export async function uploadLegalDocument(formData: FormData) {
  const target = backTo(formData, '/compta/legal');
  const files = formData.getAll('file');
  const file = files.find((f): f is File => f instanceof File && f.size > 0);
  if (!file) fail(target, 'uploadLegalDocument', new AtlasApiError('document', 400));
  const payload = new FormData();
  payload.set('file', file);
  for (const key of ['type', 'titre', 'annee', 'dateEmission', 'dateExpiration', 'note']) {
    const value = opt(formData, key);
    if (value) payload.set(key, value);
  }
  try {
    await apiUpload('/compta/documents/upload', payload, { timeoutMs: 120_000 });
  } catch (error) {
    fail(target, 'uploadLegalDocument', error);
  }
  done(target);
}

export async function patchDocument(formData: FormData) {
  const target = backTo(formData, '/compta/legal');
  try {
    await apiPatch(`/compta/documents/${str(formData, 'id')}`, {
      dateExpiration: optNull(formData, 'dateExpiration'),
      note: optNull(formData, 'note'),
    });
  } catch (error) {
    fail(target, 'patchDocument', error);
  }
  done(target);
}

export async function deleteDocument(formData: FormData) {
  const target = backTo(formData, '/compta/legal');
  try {
    await apiDelete(`/compta/documents/${str(formData, 'id')}`);
  } catch (error) {
    fail(target, 'deleteDocument', error);
  }
  done(target);
}

export async function patchObligation(formData: FormData) {
  const target = backTo(formData, '/compta/legal');
  try {
    await apiPatch(`/compta/obligations/${str(formData, 'id')}`, {
      statut: str(formData, 'statut'),
      dateFait: optNull(formData, 'dateFait'),
    });
  } catch (error) {
    fail(target, 'patchObligation', error);
  }
  done(target);
}

// Utilisé par le tableau de bord pour tout générer d'un coup (année en cours).
export async function initialiserAnnee(formData: FormData) {
  const target = backTo(formData, '/compta');
  try {
    await apiPost('/compta/declarations/generer', { annee: Math.round(num(formData, 'annee')) });
  } catch (error) {
    fail(target, 'initialiserAnnee', error);
  }
  done(target);
}
