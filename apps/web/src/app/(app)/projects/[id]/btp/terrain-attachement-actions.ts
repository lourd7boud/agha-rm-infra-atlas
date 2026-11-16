'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, AtlasApiError } from '@/lib/api';

export type TerrainBatchResult =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; count: number; periodeId: string };

export async function integrateTerrainBatch(
  projectId: string,
  _previous: TerrainBatchResult,
  form: FormData,
): Promise<TerrainBatchResult> {
  const periodeId = form.get('periodeId');
  const attachementIds = form.getAll('attachementId').filter((id): id is string => typeof id === 'string');
  if (typeof periodeId !== 'string' || !periodeId || attachementIds.length === 0 || attachementIds.length > 100) {
    return { status: 'error', message: 'Choisissez un métré et sélectionnez entre 1 et 100 attachements.' };
  }

  try {
    const result = await apiPost<{ periodeId: string; attachements: unknown[] }>(
      `/btp/projects/${projectId}/terrain/attachements/integrer`, { periodeId, attachementIds },
    );
    revalidatePath(`/projects/${projectId}`);
    return { status: 'success', count: result.attachements.length, periodeId: result.periodeId };
  } catch (error) {
    const code = error instanceof AtlasApiError ? error.status : undefined;
    const message = code === 401 || code === 403
      ? 'Le bureau doit disposer d’une session autorisée pour intégrer les attachements.'
      : code === 409
        ? 'Vérifiez la période, le bordereau et le statut des attachements. L’intégration est refusée si ces données ne correspondent plus.'
        : 'L’intégration n’a pas pu être confirmée. Réessayez avec la même sélection.';
    return { status: 'error', message };
  }
}
