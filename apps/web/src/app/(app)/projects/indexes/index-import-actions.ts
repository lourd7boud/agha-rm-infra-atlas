'use server';

import { revalidatePath } from 'next/cache';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { reviewedIndexImport } from './index-import-data';
import type { IndexImportDraft, IndexImportReceipt, IndexImportResult } from './index-import-types';

const endpoint = '/btp/revision/index-imports';

function failure(error: unknown): { error: string } {
  if (error instanceof AtlasApiError) {
    if (error.status === 401 || error.status === 403) return { error: 'Reconnectez-vous avec un compte autorisé à gérer les indices.' };
    if (error.status === 409) return { error: 'Le bulletin a déjà été traité ou ses valeurs entrent en conflit avec le registre. Actualisez le brouillon avant de réessayer.' };
    if (error.status === 400) return { error: 'Vérifiez la source officielle, la publication et les valeurs des mois sélectionnés.' };
  }
  return { error: 'Le service n’a pas pu confirmer cette opération. Réessayez.' };
}

export async function startIndexImport(sourceUrl: string): Promise<IndexImportResult<IndexImportDraft>> {
  try { return { value: await apiPost<IndexImportDraft>(endpoint, { sourceUrl }) }; }
  catch (error) { return failure(error); }
}

export async function readIndexImport(id: string): Promise<IndexImportResult<IndexImportDraft>> {
  try { return { value: await apiGet<IndexImportDraft>(`${endpoint}/${encodeURIComponent(id)}`) }; }
  catch (error) { return failure(error); }
}

export async function retryIndexImport(id: string): Promise<IndexImportResult<IndexImportDraft>> {
  try { return { value: await apiPost<IndexImportDraft>(`${endpoint}/${encodeURIComponent(id)}/retry`, {}) }; }
  catch (error) { return failure(error); }
}

export async function reviewIndexImport(id: string): Promise<IndexImportResult<IndexImportDraft>> {
  try { return { value: await apiPost<IndexImportDraft>(`${endpoint}/${encodeURIComponent(id)}/review`, {}) }; }
  catch (error) { return failure(error); }
}

export async function applyIndexImport(id: string, form: FormData): Promise<IndexImportResult<IndexImportReceipt>> {
  let payload;
  try { payload = reviewedIndexImport(form); }
  catch (error) { return { error: error instanceof Error ? error.message : 'Vérifiez les mois sélectionnés.' }; }
  try {
    const value = await apiPost<IndexImportReceipt>(`${endpoint}/${encodeURIComponent(id)}/apply`, payload);
    revalidatePath('/projects/indexes');
    revalidatePath('/projects', 'layout');
    return { value };
  } catch (error) { return failure(error); }
}
