'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMad, type TerrainDepense } from '@/lib/btp-shared';
import { reconcileExpense } from './reconciliation-actions';
import type {
  ExpenseReconciliationRecord,
  ExpenseTreatment,
  ReconciliationResource,
} from './reconciliation-types';
const input =
  'mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';
const labels: Record<ExpenseTreatment, string> = {
  standalone: 'Dépense complémentaire (coût à ajouter)',
  linked_resource: 'Déjà incluse dans une ressource',
  non_cost: 'Hors coût du chantier',
};
function ExpenseDecision({
  expense,
  current,
  resources,
  projectId,
  accountScope,
}: {
  expense: TerrainDepense;
  current?: ExpenseReconciliationRecord;
  resources: ReconciliationResource[];
  projectId: string;
  accountScope: string;
}) {
  const router = useRouter();
  const [treatment, setTreatment] = useState<ExpenseTreatment | ''>(
    current?.treatment ?? '',
  );
  const [resource, setResource] = useState(
    current?.resourceId ? `${current.resourceKind}:${current.resourceId}` : '',
  );
  const [note, setNote] = useState(current?.note ?? '');
  const [record, setRecord] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<ExpenseReconciliationRecord | null>(
    null,
  );
  const selected = resources.find((r) => `${r.kind}:${r.id}` === resource);
  const discrepancy =
    selected && Math.abs(selected.amount - expense.amountMad) > 0.01;
  async function save() {
    if (!treatment) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await reconcileExpense(
        projectId,
        expense.id,
        accountScope,
        {
          treatment,
          expectedVersion: record?.version ?? 0,
          note,
          ...(treatment === 'linked_resource' && selected
            ? { resourceKind: selected.kind, resourceId: selected.id }
            : {}),
        },
      );
      if (result.ok) {
        setRecord(result.record);
        setMessage('Rapprochement enregistré. Les totaux ont été actualisés.');
        router.refresh();
      } else {
        setMessage(result.message);
        if (result.code === 'conflict') setConflict(result.current ?? null);
      }
    } catch {
      setMessage(
        'Connexion interrompue. Vos choix restent affichés. Réessayez.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-lg border border-line bg-paper p-4">
      <summary className="min-h-11 cursor-pointer text-sm">
        <strong>{expense.label}</strong> · {fmtMad(expense.amountMad)}
        <span className="ml-2 text-muted">
          {record ? labels[record.treatment] : 'À rapprocher'}
        </span>
      </summary>
      <fieldset disabled={busy} className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Traitement *
          <select
            className={input}
            value={treatment}
            onChange={(e) =>
              setTreatment(e.target.value as ExpenseTreatment | '')
            }
          >
            <option value="">Choisir le traitement</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {treatment === 'linked_resource' && (
          <label className="text-sm font-semibold">
            Ressource déjà valorisée *
            <select
              className={input}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">Choisir une ressource du chantier</option>
              {resources.map((r) => (
                <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`}>
                  {r.label} · {fmtMad(r.amount)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm font-semibold sm:col-span-2">
          Justification *
          <textarea
            className={input}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder={
              discrepancy
                ? 'Expliquez l’écart entre les montants (20 caractères minimum)…'
                : 'Motif du rapprochement…'
            }
          />
        </label>
        {discrepancy && (
          <p className="text-sm text-clay sm:col-span-2">
            Les montants diffèrent : dépense {fmtMad(expense.amountMad)},
            ressource {fmtMad(selected.amount)}. Justifiez cet écart en au moins
            20 caractères.
          </p>
        )}
        <button
          type="button"
          disabled={
            busy ||
            !!conflict ||
            !treatment ||
            note.trim().length < (discrepancy ? 20 : 3) ||
            (treatment === 'linked_resource' && !selected)
          }
          onClick={save}
          className="min-h-11 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50"
        >
          {busy ? 'Enregistrement…' : 'Confirmer le rapprochement'}
        </button>
      </fieldset>
      <p className="mt-3 text-sm" aria-live="polite">
        {message}
      </p>
      {conflict && (
        <div
          className="mt-3 rounded-lg border border-clay p-3 text-sm"
          role="alert"
        >
          <p>
            Décision serveur · v{conflict.version} :{' '}
            {labels[conflict.treatment]} · {conflict.actor} · {conflict.note}
          </p>
          <p className="mt-2">
            Vos choix restent dans le formulaire. Charger la décision serveur
            les remplace.
          </p>
          <button
            className="mt-3 min-h-11 rounded-lg border border-line px-3 font-semibold focus-visible:outline-2 focus-visible:outline-cyan"
            onClick={() => {
              setRecord(conflict);
              setTreatment(conflict.treatment);
              setResource(
                conflict.resourceId
                  ? `${conflict.resourceKind}:${conflict.resourceId}`
                  : '',
              );
              setNote(conflict.note);
              setConflict(null);
              setMessage(
                'Décision serveur chargée. Vous pouvez maintenant saisir une correction motivée.',
              );
            }}
          >
            Charger la décision serveur
          </button>
        </div>
      )}
      {record && (
        <div className="mt-3 text-xs text-muted">
          <p>
            Décision du {new Date(record.updatedAt).toLocaleString('fr-MA')} ·{' '}
            {record.actor} · {record.note}
          </p>
          {record.history.length > 0 && (
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer">
                Historique des décisions ({record.history.length})
              </summary>
              <ul className="space-y-2">
                {record.history.map((entry, i) => (
                  <li key={i}>
                    {new Date(entry.updatedAt).toLocaleString('fr-MA')} ·{' '}
                    {labels[entry.treatment]} · {entry.actor} · {entry.note}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </details>
  );
}
export function ExpenseReconciliation({
  projectId,
  accountScope,
  expenses,
  records,
  resources,
}: {
  projectId: string;
  accountScope: string;
  expenses: TerrainDepense[];
  records: ExpenseReconciliationRecord[];
  resources: ReconciliationResource[];
}) {
  return (
    <section className="rounded-xl border border-line bg-paper-2 p-5">
      <h3 className="text-lg font-bold">Rapprochement des dépenses · bureau</h3>
      <p className="mt-2 text-sm text-muted">
        Vérifiez chaque dépense pour éviter de recompter une ressource déjà
        valorisée. Toute décision et ses corrections sont tracées.
      </p>
      <div className="mt-4 space-y-3">
        {expenses.length ? (
          expenses.map((expense) => (
            <ExpenseDecision
              key={expense.id}
              expense={expense}
              current={records.find((r) => r.expenseId === expense.id)}
              resources={resources}
              projectId={projectId}
              accountScope={accountScope}
            />
          ))
        ) : (
          <p className="text-sm text-muted">Aucune dépense à rapprocher.</p>
        )}
      </div>
    </section>
  );
}
