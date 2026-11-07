'use server';
import { revalidatePath } from 'next/cache';
import { apiGet, apiPatch, AtlasApiError } from '@/lib/api';
import { dailyIdentity } from './daily-actions';
import type {
  ExpenseReconciliationInput,
  ExpenseReconciliationRecord,
} from './reconciliation-types';
export async function reconcileExpense(
  projectId: string,
  expenseId: string,
  accountScope: string,
  input: ExpenseReconciliationInput,
): Promise<
  | { ok: true; record: ExpenseReconciliationRecord }
  | {
      ok: false;
      message: string;
      code?: 'conflict';
      current?: ExpenseReconciliationRecord;
    }
> {
  try {
    const identity = await dailyIdentity();
    if (identity.accountScope !== accountScope)
      return {
        ok: false,
        message:
          'Le compte actif a changé. Rechargez cette page avec le compte attendu.',
      };
    if (!identity.canReview)
      return { ok: false, message: 'Le rapprochement est réservé au bureau.' };
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      !['standalone', 'linked_resource', 'non_cost'].includes(
        input.treatment,
      ) ||
      input.note.trim().length < 3 ||
      input.note.length > 2000 ||
      (input.treatment === 'linked_resource' &&
        (!input.resourceId ||
          !input.resourceKind ||
          !['main_oeuvre', 'materiel', 'consommation'].includes(
            input.resourceKind,
          )))
    )
      return {
        ok: false,
        message:
          'Choisissez un traitement, la ressource si nécessaire et une note de 3 à 2000 caractères.',
      };
    const record = await apiPatch<ExpenseReconciliationRecord>(
      `/btp/projects/${encodeURIComponent(projectId)}/terrain/depenses/${encodeURIComponent(expenseId)}/rapprocher`,
      input,
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, record };
  } catch (error) {
    const status = error instanceof AtlasApiError ? error.status : 0;
    if (status === 409) {
      const current = await apiGet<ExpenseReconciliationRecord[]>(
        `/btp/projects/${encodeURIComponent(projectId)}/terrain/depenses/rapprochements`,
      )
        .then((rows) => rows.find((r) => r.expenseId === expenseId))
        .catch(() => undefined);
      return {
        ok: false,
        code: 'conflict',
        current,
        message:
          'La décision a changé sur le serveur. Vos choix sont conservés. Comparez puis chargez la décision serveur avant de la corriger.',
      };
    }
    return {
      ok: false,
      message:
        status === 401
          ? 'Session expirée. Reconnectez-vous puis réessayez ; votre sélection reste ici.'
          : status === 400 || status === 409
            ? 'Rapprochement refusé. Vérifiez le chantier, la valorisation de la ressource et les montants. Si les montants diffèrent, expliquez l’écart en au moins 20 caractères.'
            : status === 403
              ? 'Votre compte ne peut pas rapprocher ces dépenses.'
              : 'Connexion interrompue. Vos choix sont conservés ; réessayez.',
    };
  }
}
