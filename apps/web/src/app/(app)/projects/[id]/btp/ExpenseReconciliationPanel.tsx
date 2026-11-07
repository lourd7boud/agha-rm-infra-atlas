import { apiGet } from '@/lib/api';
import type {
  TerrainConsommation,
  TerrainDepense,
  TerrainMateriel,
  TerrainPointage,
} from '@/lib/btp-shared';
import { dailyIdentity } from './daily-actions';
import { ExpenseReconciliation } from './ExpenseReconciliation';
import type {
  ExpenseReconciliationRecord,
  ReconciliationResource,
} from './reconciliation-types';
export async function ExpenseReconciliationPanel({
  projectId,
  expenses,
}: {
  projectId: string;
  expenses: TerrainDepense[];
}) {
  const identity = await dailyIdentity();
  if (!identity.canReview) return null;
  try {
    const base = `/btp/projects/${projectId}/terrain`;
    const [records, pointage, equipment, materials] = await Promise.all([
      apiGet<ExpenseReconciliationRecord[]>(`${base}/depenses/rapprochements`),
      apiGet<{ pointages: TerrainPointage[] }>(`${base}/pointage?history=all`),
      apiGet<TerrainMateriel[]>(`${base}/materiel`),
      apiGet<TerrainConsommation[]>(`${base}/consommations`),
    ]);
    const resources: ReconciliationResource[] = [
      ...pointage.pointages
        .filter((p) => p.coutMad !== null)
        .map((p) => ({
          id: p.id,
          kind: 'main_oeuvre' as const,
          label: `${p.workDate} · ${p.employeeName}`,
          amount: p.coutMad!,
        })),
      ...equipment
        .filter(
          (e) => e.coutCarburantMad !== null && e.coutLocationMad !== null,
        )
        .map((e) => ({
          id: e.id,
          kind: 'materiel' as const,
          label: `${e.date} · ${e.engin}`,
          amount: e.coutCarburantMad! + e.coutLocationMad!,
        })),
      ...materials
        .filter((m) => m.coutMad !== null)
        .map((m) => ({
          id: m.id,
          kind: 'consommation' as const,
          label: `${m.date} · ${m.article}`,
          amount: m.coutMad!,
        })),
    ];
    return (
      <ExpenseReconciliation
        projectId={projectId}
        accountScope={identity.accountScope}
        expenses={expenses}
        records={records}
        resources={resources}
      />
    );
  } catch {
    return (
      <p className="rounded-xl border border-clay bg-paper p-4 text-sm">
        Le rapprochement et ses ressources n’ont pas pu être chargés.
        Enregistrez votre saisie puis rechargez cet onglet pour réessayer.
      </p>
    );
  }
}
