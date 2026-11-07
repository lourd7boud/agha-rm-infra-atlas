'use server';

import { createHash } from 'node:crypto';
import { auth } from '@/auth';
import {
  apiGet,
  apiPost,
  AtlasApiError,
  API_WRITE_TIMEOUT_MS,
} from '@/lib/api';
import { revalidatePath } from 'next/cache';
import {
  terrainJourneeSaveSchema,
  type TerrainJourneePayload,
  type TerrainJourneeRecord,
} from '@atlas/contracts';

export type DailyResult =
  | { ok: true; record: TerrainJourneeRecord }
  | {
      ok: false;
      code: 'conflict' | 'invalid' | 'session' | 'forbidden' | 'network';
      message: string;
      current?: TerrainJourneeRecord;
    };
export interface DailySettlement {
  attendanceMapping: Array<{ lineId: string; assignmentId: string }>;
  productionMapping: Array<{ lineId: string; bpuLigneId: string }>;
  reason: string;
}
const officeRoles = ['travaux', 'direction', 'marches', 'admin-si'];

export async function dailyIdentity() {
  const session = await auth();
  if (!session?.accessToken || session.error)
    throw new AtlasApiError('/terrain/journees', 401);
  const claims = JSON.parse(
    Buffer.from(session.accessToken.split('.')[1], 'base64url').toString(),
  ) as { sub?: string; iss?: string };
  if (!claims.sub) throw new Error('Identité du compte indisponible.');
  return {
    accountScope: createHash('sha256')
      .update(`${claims.iss ?? session.issuer}:${claims.sub}`)
      .digest('hex'),
    canReview: (session.roles ?? []).some((r) => officeRoles.includes(r)),
  };
}

export async function dailyRecords(projectId: string) {
  return apiGet<TerrainJourneeRecord[]>(
    `/btp/projects/${encodeURIComponent(projectId)}/terrain/journees`,
  );
}

export async function writeDaily(
  projectId: string,
  id: string,
  expectedVersion: number,
  operation:
    | 'save'
    | 'submit'
    | 'review'
    | 'return'
    | 'reopen'
    | 'resolve'
    | 'settle',
  payload?: TerrainJourneePayload,
  reason?: string,
  expectedAccountScope?: string,
  blockerId?: string,
  settlement?: DailySettlement,
): Promise<DailyResult> {
  const base = `/btp/projects/${encodeURIComponent(projectId)}/terrain/journees`;
  try {
    const identity = await dailyIdentity();
    if (!expectedAccountScope || identity.accountScope !== expectedAccountScope)
      return {
        ok: false,
        code: 'session',
        message:
          'Le compte actif a changé. Téléchargez votre saisie puis rechargez cette page avec le compte attendu.',
      };
    let record: TerrainJourneeRecord;
    if (operation === 'save') {
      const parsed = terrainJourneeSaveSchema.safeParse({
        expectedVersion,
        payload,
      });
      if (!parsed.success)
        return {
          ok: false,
          code: 'invalid',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.')} : ${i.message}`)
            .join(' · '),
        };
      const session = await auth();
      if (!session?.accessToken || session.error)
        return {
          ok: false,
          code: 'session',
          message:
            'Session expirée. Reconnectez-vous puis réessayez ; votre saisie reste ici.',
        };
      const response = await fetch(
        `${process.env.ATLAS_API_URL ?? 'http://localhost:3000/api'}${base}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify(parsed.data),
          cache: 'no-store',
          signal: AbortSignal.timeout(API_WRITE_TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new AtlasApiError(base, response.status);
      record = (await response.json()) as TerrainJourneeRecord;
    } else {
      if (
        (operation === 'review' ||
          operation === 'return' ||
          operation === 'reopen' ||
          operation === 'settle') &&
        !(await dailyIdentity()).canReview
      )
        return {
          ok: false,
          code: 'forbidden',
          message: 'Cette action est réservée au bureau.',
        };
      const suffix =
        operation === 'resolve'
          ? `blockers/${encodeURIComponent(blockerId ?? '')}/resolve`
          : operation;
      record = await apiPost<TerrainJourneeRecord>(
        `${base}/${encodeURIComponent(id)}/${suffix}`,
        {
          expectedVersion,
          ...(['return', 'reopen'].includes(operation) ? { reason } : {}),
          ...(operation === 'settle' ? settlement : {}),
        },
      );
    }
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, record };
  } catch (error) {
    const status = error instanceof AtlasApiError ? error.status : 0;
    if (status === 409) {
      const current = await dailyRecords(projectId)
        .then(
          (rows) =>
            rows.find((r) => r.id === id) ??
            rows.find((r) => payload && r.payload.date === payload.date),
        )
        .catch(() => undefined);
      if (current?.version === expectedVersion)
        return {
          ok: false,
          code: 'invalid',
          message:
            operation === 'reopen'
              ? 'Réouverture refusée : cette journée peut être liée à des écritures, des dépenses ou des métrés déjà engagés. Le bureau doit appliquer une correction officielle.'
              : 'Cette action est refusée dans l’état actuel de la journée. Vérifiez son statut et ses références avant de réessayer.',
        };
      return {
        ok: false,
        code: 'conflict',
        message:
          'La journée a changé sur le serveur. Votre saisie est conservée. Comparez les versions avant de poursuivre.',
        current,
      };
    }
    return {
      ok: false,
      code:
        status === 401
          ? 'session'
          : status === 403
            ? 'forbidden'
            : status === 400
              ? 'invalid'
              : 'network',
      message:
        status === 401
          ? 'Session expirée. Reconnectez-vous puis réessayez.'
          : status === 403
            ? 'Votre compte ne peut pas effectuer cette action.'
            : status === 400
              ? 'Vérifiez les champs obligatoires et les références du chantier.'
              : 'Le serveur est injoignable. Gardez cette page ouverte ou reprenez le brouillon local, puis réessayez.',
    };
  }
}
