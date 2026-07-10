'use server';

// Server actions Bons de commande — sync portail + espace de chiffrage.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { BdcLigne, BdcReponse } from '@/lib/bdc';

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
