import { type JournalResponse } from '@/lib/projects';
import type { ProjectDetail, ProjectFormAction } from '../types';

/** Journal de chantier — daily field reports + the consignation form. */
export function JournalSection({
  project,
  journal,
  createDailyLog,
}: {
  project: ProjectDetail;
  journal: JournalResponse;
  createDailyLog: ProjectFormAction;
}) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Journal de chantier ({journal.summary.jours} jour
          {journal.summary.jours > 1 ? 's' : ''})
        </h2>
        <div className="flex gap-4 text-xs text-muted">
          <span>
            Effectif moyen{' '}
            <strong className="font-mono tabular-nums">
              {journal.summary.effectifMoyen}
            </strong>
          </span>
          <span>
            Incidents{' '}
            <strong
              className={`font-mono tabular-nums ${journal.summary.totalIncidents > 0 ? 'text-clay' : ''}`}
            >
              {journal.summary.totalIncidents}
            </strong>
          </span>
          <span>
            Blocages{' '}
            <strong
              className={`font-mono tabular-nums ${journal.summary.blocagesOuverts > 0 ? 'text-amber-600' : ''}`}
            >
              {journal.summary.blocagesOuverts}
            </strong>
          </span>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {journal.items.map((log) => (
          <li key={log.id} className="px-5 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-faint">
              <span className="font-mono font-semibold tabular-nums text-muted">
                {new Date(log.reportDate).toLocaleDateString('fr-MA')}
              </span>
              <span>{log.effectifs} ouvriers</span>
              {log.meteo && <span>{log.meteo}</span>}
              <span>par {log.createdBy}</span>
              {log.incidentsSecurite > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-clay">
                  {log.incidentsSecurite} incident
                  {log.incidentsSecurite > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-ink-2">{log.travauxRealises}</p>
            {log.blocages && (
              <p className="mt-1 text-sm font-medium text-cyan">
                ⚠ {log.blocages}
              </p>
            )}
          </li>
        ))}
      </ul>
      {journal.items.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucun rapport — le terrain remplit le journal quotidiennement.
        </p>
      )}
      {(project.status === 'en_cours' || project.status === 'suspendu') && (
        <form
          action={createDailyLog}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Date</span>
            <input
              type="date"
              name="reportDate"
              required
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Effectifs</span>
            <input
              type="number"
              name="effectifs"
              required
              min={0}
              className="w-24 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Incidents</span>
            <input
              type="number"
              name="incidentsSecurite"
              min={0}
              defaultValue={0}
              className="w-20 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">
              Travaux réalisés
            </span>
            <input
              type="text"
              name="travauxRealises"
              required
              minLength={10}
              maxLength={5000}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">
              Blocages (optionnel)
            </span>
            <input
              type="text"
              name="blocages"
              maxLength={2000}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Consigner
          </button>
        </form>
      )}
    </section>
  );
}
