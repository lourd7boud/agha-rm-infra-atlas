import {
  TASK_STATUS_BADGES,
  TASK_STATUS_OPTIONS,
  type TasksResponse,
} from '@/lib/projects';
import type { ProjectDetail, ProjectFormAction } from '../types';

/** Task list with physical-progress rollup, per-task update forms and the
 *  add-task form (while the chantier is still active). */
export function TasksSection({
  project,
  taskData,
  createTask,
  updateTask,
}: {
  project: ProjectDetail;
  taskData: TasksResponse;
  createTask: ProjectFormAction;
  updateTask: ProjectFormAction;
}) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Tâches ({taskData.tasks.length})
        </h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <span>
            Avancement physique{' '}
            <strong className="font-mono tabular-nums text-ink-2">
              {taskData.physicalProgressPct.toFixed(1)}%
            </strong>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {TASK_STATUS_OPTIONS.map((option) => (
              <span
                key={option.value}
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TASK_STATUS_BADGES[option.value].classes}`}
              >
                {option.label} {taskData.statusSummary[option.value]}
              </span>
            ))}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {taskData.tasks.map((task) => {
          const tBadge = TASK_STATUS_BADGES[task.status];
          return (
            <li key={task.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{task.label}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tBadge.classes}`}
                    >
                      {tBadge.label}
                    </span>
                    {task.dueDate && (
                      <span className="font-mono text-xs tabular-nums text-faint">
                        échéance{' '}
                        {new Date(task.dueDate).toLocaleDateString('fr-MA')}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="mt-1 text-sm text-ink-2">{task.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 w-48 max-w-full overflow-hidden rounded-full bg-sand">
                      <div
                        className="h-full rounded-full bg-cyan-deep"
                        style={{
                          width: `${Math.min(100, Math.max(0, task.progressPct))}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted">
                      {task.progressPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <form
                  action={updateTask}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="taskId" value={task.id} />
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted">
                      Avancement
                    </span>
                    <input
                      type="number"
                      name="progressPct"
                      required
                      min={0}
                      max={100}
                      step="1"
                      defaultValue={task.progressPct}
                      className="w-20 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted">Statut</span>
                    <select
                      name="status"
                      defaultValue={task.status}
                      className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
                    >
                      {TASK_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="rounded-md border border-line-2 px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-sand">
                    Mettre à jour
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      {taskData.tasks.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucune tâche — découpez le chantier en tâches ci-dessous.
        </p>
      )}
      {(project.status === 'en_cours' ||
        project.status === 'preparation' ||
        project.status === 'suspendu') && (
        <form
          action={createTask}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Intitulé</span>
            <input
              type="text"
              name="label"
              required
              minLength={3}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">
              Description (optionnel)
            </span>
            <input
              type="text"
              name="description"
              maxLength={2000}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Échéance (optionnel)
            </span>
            <input
              type="date"
              name="dueDate"
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Ajouter la tâche
          </button>
        </form>
      )}
    </section>
  );
}
