'use server';

// Server actions Radar proactif — relance du scoring + décision de l'opérateur
// (poursuivre / écarter / vu) sur une opportunité scorée.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';

function fail(target: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[radar] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  const sep = target.includes('?') ? '&' : '?';
  redirect(`${target}${sep}error=${action}`);
}

/** Relance manuelle du scoring (le cron horaire le fait tout seul). */
export async function scanRadar(formData: FormData) {
  const back = String(formData.get('backTo') ?? '/tenders/radar');
  try {
    await apiPost('/radar/scan', undefined, { timeoutMs: 240_000 });
  } catch (error) {
    fail(back, 'scanRadar', error);
  }
  revalidatePath('/tenders/radar');
  redirect(`${back}${back.includes('?') ? '&' : '?'}scanned=1`);
}

/** L'opérateur poursuit / écarte / marque vu une opportunité. */
export async function setCandidatStatut(formData: FormData) {
  const tenderId = String(formData.get('tenderId') ?? '');
  const statut = String(formData.get('statut') ?? '');
  const back = String(formData.get('backTo') ?? '/tenders/radar');
  try {
    await apiPatch(`/radar/candidates/${tenderId}/statut`, { statut });
  } catch (error) {
    fail(back, 'setCandidatStatut', error);
  }
  revalidatePath('/tenders/radar');
  redirect(back);
}
