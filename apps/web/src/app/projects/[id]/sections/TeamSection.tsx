import {
  fmtDays,
  fmtMad,
  fmtRate,
  type Employee,
  type ProjectLabor,
  type ProjectLaborLine,
  type TeamResponse,
} from '@/lib/projects';
import type { ProjectDetail, ProjectFormAction } from '../types';

/** Équipe roster — dues per member, pointage forms and the assignment form. */
export function TeamSection({
  project,
  team,
  labor,
  laborByEmployee,
  assignable,
  assignEmployee,
  logWorkDay,
  endAssignment,
}: {
  project: ProjectDetail;
  team: TeamResponse;
  labor: ProjectLabor;
  laborByEmployee: Map<string, ProjectLaborLine>;
  assignable: Employee[];
  assignEmployee: ProjectFormAction;
  logWorkDay: ProjectFormAction;
  endAssignment: ProjectFormAction;
}) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Équipe ({team.effectifActif} actif{team.effectifActif > 1 ? 's' : ''})
        </h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <span>
            Jours pointés{' '}
            <strong className="font-mono tabular-nums text-ink-2">
              {fmtDays(labor.totalDays)}
            </strong>
          </span>
          <span>
            Main-d&apos;œuvre due{' '}
            <strong className="font-mono tabular-nums text-ink-2">
              {fmtMad(labor.totalDuesMad)}
            </strong>
          </span>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {team.membres.map((member) => {
          const line = laborByEmployee.get(member.employeeId);
          const totalDays = line?.totalDays ?? 0;
          const duesMad = line?.duesMad ?? 0;
          const canLog =
            member.actif &&
            (project.status === 'en_cours' || project.status === 'suspendu');
          return (
            <li key={member.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{member.fullName}</p>
                  <p className="text-xs text-faint">
                    {member.metier} · depuis{' '}
                    {new Date(member.startDate).toLocaleDateString('fr-MA')}
                    {member.endDate &&
                      ` → ${new Date(member.endDate).toLocaleDateString('fr-MA')}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="text-muted">
                    Tarif{' '}
                    <strong className="font-mono tabular-nums text-ink-2">
                      {fmtRate(line?.rateType, line?.rateAmountMad)}
                    </strong>
                  </span>
                  <span className="text-muted">
                    Jours{' '}
                    <strong className="font-mono tabular-nums text-ink-2">
                      {fmtDays(totalDays)}
                    </strong>
                  </span>
                  <span className="text-muted">
                    Dû{' '}
                    <strong className="font-mono tabular-nums text-ink-2">
                      {fmtMad(duesMad)}
                    </strong>
                  </span>
                  {member.actif ? (
                    <form action={endAssignment}>
                      <input type="hidden" name="aid" value={member.id} />
                      <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                        Clôturer l&apos;affectation
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs text-muted">
                      Terminée
                    </span>
                  )}
                </div>
              </div>
              {canLog && (
                <form
                  action={logWorkDay}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="aid" value={member.id} />
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted">
                      Date du pointage
                    </span>
                    <input
                      type="date"
                      name="workDate"
                      required
                      className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted">
                      Jours travaillés
                    </span>
                    <input
                      type="number"
                      name="daysWorked"
                      required
                      min={0.5}
                      max={2}
                      step="0.5"
                      defaultValue={1}
                      className="w-24 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                    />
                  </label>
                  <label className="min-w-48 flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted">
                      Note (optionnel)
                    </span>
                    <input
                      type="text"
                      name="notes"
                      maxLength={1000}
                      className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                    />
                  </label>
                  <button className="rounded-md border border-line-2 px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-sand">
                    Pointer la journée
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {team.membres.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucune affectation — composer l&apos;équipe ci-dessous.
        </p>
      )}
      {assignable.length > 0 &&
        (project.status === 'en_cours' || project.status === 'preparation') && (
          <form
            action={assignEmployee}
            className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
          >
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Employé</span>
              <select
                name="employeeId"
                required
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                {assignable.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} — {employee.metier}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Début</span>
              <input
                type="date"
                name="startDate"
                required
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Base de paie (optionnel)
              </span>
              <select
                name="rateType"
                defaultValue=""
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">—</option>
                <option value="jour">Journalier</option>
                <option value="mois">Mensuel</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Tarif MAD (optionnel)
              </span>
              <input
                type="number"
                name="rateAmountMad"
                min={0}
                step="0.01"
                className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Affecter au chantier
            </button>
          </form>
        )}
    </section>
  );
}
