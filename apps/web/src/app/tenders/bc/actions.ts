'use server';

// Server actions Bons de commande — sync portail + espace de chiffrage.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { BdcLigne, BdcProposerResume, BdcReponse } from '@/lib/bdc';
import { MARKETPLACE_CATALOG } from '@/lib/marketplace-catalog';

function fail(target: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[bdc] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  const sep = target.includes('?') ? '&' : '?';
  redirect(`${target}${sep}error=${action}`);
}

/** Balaye le portail (liste + détails manquants) puis recharge la page. */
export async function syncBdc(formData: FormData) {
  const back = String(formData.get('backTo') ?? '/tenders/bc');
  try {
    await apiPost('/bdc/sweep', { pages: 5, details: 30 }, { timeoutMs: 240_000 });
  } catch (error) {
    fail(back, 'syncBdc', error);
  }
  revalidatePath('/tenders/bc');
  redirect(`${back}${back.includes('?') ? '&' : '?'}synced=1`);
}

/** Crée (si besoin) l'espace de chiffrage puis revient sur la fiche. */
export async function creerReponse(formData: FormData) {
  const avisId = String(formData.get('avisId') ?? '');
  const target = `/tenders/bc/${avisId}`;
  try {
    await apiPost(`/bdc/avis/${avisId}/reponse`);
  } catch (error) {
    fail(target, 'creerReponse', error);
  }
  revalidatePath(target);
  redirect(target);
}

interface CatalogueCandidate {
  designation: string;
  unite: string | null;
  prixHt: number;
  source: 'catalogue';
  sourceRef: string;
}

/** Aplatis une seule fois: 139 variantes marketplace → candidats de prix. */
let catalogueCandidatesCache: CatalogueCandidate[] | null = null;
function catalogueCandidates(): CatalogueCandidate[] {
  if (catalogueCandidatesCache) return catalogueCandidatesCache;
  const flat: CatalogueCandidate[] = [];
  for (const category of MARKETPLACE_CATALOG) {
    for (const product of category.products) {
      for (const variante of product.variantes) {
        const prixHt = variante.price ?? variante.offers[0]?.price ?? null;
        if (!prixHt || prixHt <= 0) continue;
        const designation = variante.name.toLowerCase().includes(product.name.toLowerCase())
          ? variante.name
          : `${product.name} ${variante.name}`;
        flat.push({
          designation: designation.slice(0, 400),
          unite: variante.unit || null,
          prixHt,
          source: 'catalogue',
          sourceRef: `Catalogue LF: ${variante.name}`.slice(0, 200),
        });
      }
    }
  }
  catalogueCandidatesCache = flat;
  return flat;
}

/**
 * Chiffrage automatique — le core matche l'historique société (BPU, devis,
 * réponses BDC) + les candidats catalogue envoyés d'ici. Retourne la réponse
 * sauvegardée et le résumé des propositions.
 */
export async function proposerPrixAuto(
  avisId: string,
): Promise<{ reponse: BdcReponse; resume: BdcProposerResume }> {
  const result = await apiPost<{ reponse: BdcReponse; resume: BdcProposerResume }>(
    `/bdc/avis/${avisId}/proposer`,
    { candidatesExtra: catalogueCandidates() },
    { timeoutMs: 60_000 },
  );
  revalidatePath(`/tenders/bc/${avisId}`);
  return result;
}

/** Sauvegarde du chiffrage (appelée par le client BdcPricer). */
export async function sauverReponse(
  avisId: string,
  payload: { margePct: number; lignes: BdcLigne[]; notes?: string },
): Promise<BdcReponse> {
  const saved = await apiPatch<BdcReponse>(`/bdc/avis/${avisId}/reponse`, payload);
  revalidatePath(`/tenders/bc/${avisId}`);
  return saved;
}

/** Transition de statut de la réponse (prête / déposée / gagnée / perdue). */
export async function setReponseStatut(formData: FormData) {
  const avisId = String(formData.get('avisId') ?? '');
  const statut = String(formData.get('statut') ?? '');
  const target = `/tenders/bc/${avisId}`;
  try {
    await apiPatch(`/bdc/avis/${avisId}/reponse`, { statut });
  } catch (error) {
    fail(target, 'setReponseStatut', error);
  }
  revalidatePath(target);
  redirect(target);
}
