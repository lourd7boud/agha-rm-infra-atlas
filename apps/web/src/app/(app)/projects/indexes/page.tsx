// Gestion des Index BTP — la table mensuelle des index officiels qui alimente
// la révision des prix de tous les marchés, + les formules réutilisables et le
// journal d'audit des modifications (direction / admin-si).
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiDelete, apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { apiPut, fmtDate, type RevisionFormula, type RevisionIndexMonth } from '@/lib/btp';
import { isRedirectError } from '@/lib/next-redirect';

export const metadata = { title: 'Index BTP — Révision des prix' };

interface AuditRow {
  id: string;
  monthDate: string | null;
  action: string;
  actorName: string | null;
  changes: unknown;
  createdAt: string;
}

function fail(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(`[btp-indexes] "${action}" failed${status ? ` (HTTP ${status})` : ''}`, error);
  redirect(`/projects/indexes?error=${action}&code=${status === 400 ? 'invalid' : 'failed'}`);
}

export default async function IndexesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const [indexes, formulas, audit] = await Promise.all([
    apiGet<RevisionIndexMonth[]>('/btp/revision/indexes'),
    apiGet<RevisionFormula[]>('/btp/revision/formulas'),
    apiGet<AuditRow[]>('/btp/revision/indexes-audit').catch(() => [] as AuditRow[]),
  ]);
  // Colonnes = union des noms d'index rencontrés (table générique, data-driven).
  const indexNames = [...new Set(indexes.flatMap((m) => Object.keys(m.indexValues)))].sort();

  async function upsertMonth(formData: FormData) {
    'use server';
    const month = String(formData.get('month') ?? '');
    const raw = String(formData.get('indexValues') ?? '').trim();
    let values: Record<string, number>;
    try {
      values = JSON.parse(raw) as Record<string, number>;
    } catch {
      redirect('/projects/indexes?error=upsertMonth&code=invalid');
    }
    try {
      await apiPut('/btp/revision/indexes', {
        monthDate: `${month}-01`,
        indexValues: values,
        source: String(formData.get('source') ?? '') || undefined,
        status: String(formData.get('status') ?? 'provisoire'),
      });
    } catch (error) {
      fail('upsertMonth', error);
    }
    revalidatePath('/projects/indexes');
    redirect('/projects/indexes?saved=1');
  }

  async function deleteMonth(formData: FormData) {
    'use server';
    const month = String(formData.get('month') ?? '');
    try {
      await apiDelete(`/btp/revision/indexes/${month}`);
    } catch (error) {
      fail('deleteMonth', error);
    }
    revalidatePath('/projects/indexes');
    redirect('/projects/indexes');
  }

  async function saveFormula(formData: FormData) {
    'use server';
    const raw = String(formData.get('weights') ?? '').trim();
    let weights: Record<string, number>;
    try {
      weights = JSON.parse(raw) as Record<string, number>;
    } catch {
      redirect('/projects/indexes?error=saveFormula&code=invalid');
    }
    try {
      await apiPost('/btp/revision/formulas', {
        name: String(formData.get('name') ?? ''),
        description: String(formData.get('description') ?? '') || undefined,
        fixedPart: Number(formData.get('fixedPart')),
        weights,
        isDefault: formData.get('isDefault') === 'on',
      });
    } catch (error) {
      fail('saveFormula', error);
    }
    revalidatePath('/projects/indexes');
    redirect('/projects/indexes?saved=1');
  }

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Marchés de travaux
      </Link>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Index BTP — révision des prix</h1>
      <p className="mt-1 text-sm text-muted">
        Un mois = une ligne de valeurs officielles. Provisoire (**) tant que le Définitif (*) n'est
        pas publié. Chaque modification est auditée.
      </p>

      {query.saved && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          Enregistré.
        </div>
      )}
      {query.error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay"
        >
          {query.error} — {query.code === 'invalid' ? 'JSON ou champs invalides.' : 'échec.'}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Table des mois */}
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm xl:col-span-2">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Index mensuels ({indexes.length} mois)
          </h2>
          {indexes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Aucun mois — ajoutez les premières valeurs ci-dessous.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-line bg-sand text-[10px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2.5">Mois</th>
                    {indexNames.map((name) => (
                      <th key={name} className="px-3 py-2.5 text-right font-mono">
                        {name}
                      </th>
                    ))}
                    <th className="px-3 py-2.5">Statut</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {indexes.map((month) => {
                    const key = month.monthDate.slice(0, 7);
                    return (
                      <tr key={month.id} className="transition hover:bg-sand/40">
                        <td className="px-3 py-2 font-mono font-bold text-cyan">{key}</td>
                        {indexNames.map((name) => (
                          <td key={name} className="px-3 py-2 text-right font-mono tabular-nums">
                            {month.indexValues[name] ?? '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              month.status === 'definitif'
                                ? 'bg-emerald-soft text-emerald'
                                : 'bg-ochre-soft text-ochre'
                            }`}
                          >
                            {month.status === 'definitif' ? 'Définitif *' : 'Provisoire **'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <form action={deleteMonth}>
                            <input type="hidden" name="month" value={key} />
                            <button className="text-[11px] font-semibold text-faint hover:text-clay">
                              Supprimer
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Ajout / mise à jour */}
          <form
            action={upsertMonth}
            className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
          >
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Mois
              <input
                type="month"
                name="month"
                required
                className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
            </label>
            <label className="min-w-72 flex-1 text-[11px] font-semibold uppercase tracking-widest text-faint">
              Valeurs (JSON)
              <input
                name="indexValues"
                required
                placeholder='{"At": 306.7, "Cs": 134.6, "Mc1": 106.0, "S": 97.0}'
                className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Statut
              <select
                name="status"
                className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              >
                <option value="provisoire">Provisoire **</option>
                <option value="definitif">Définitif *</option>
              </select>
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Source
              <input
                name="source"
                placeholder="Circulaire…"
                className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
            </label>
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              Enregistrer le mois
            </button>
          </form>
        </section>

        {/* Formules + audit */}
        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Formules de révision
            </h2>
            <ul className="mt-3 space-y-2">
              {formulas.map((formula) => (
                <li key={formula.id} className="rounded-lg border border-line bg-paper px-3 py-2">
                  <p className="text-xs font-bold text-ink-2">
                    {formula.name}
                    {formula.isDefault && (
                      <span className="ml-2 rounded-full bg-cyan-soft px-1.5 py-0.5 text-[10px] font-bold text-cyan">
                        défaut
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    a={formula.fixedPart} ·{' '}
                    {Object.entries(formula.weights)
                      .map(([k, w]) => `${k}:${w}`)
                      .join(' ')}
                  </p>
                </li>
              ))}
            </ul>
            <form action={saveFormula} className="mt-4 space-y-2 border-t border-line pt-3">
              <input
                name="name"
                required
                placeholder="Nom de la formule"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.0001"
                  name="fixedPart"
                  required
                  placeholder="Partie fixe (0.15)"
                  className="w-36 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
                />
                <input
                  name="weights"
                  required
                  placeholder='{"At":0.20,"Cs":0.25,"Mc1":0.25,"S":0.15}'
                  className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                <input type="checkbox" name="isDefault" className="accent-cyan" /> Formule par
                défaut
              </label>
              <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
                + Ajouter la formule
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Journal d'audit
            </h2>
            {audit.length === 0 ? (
              <p className="mt-3 text-xs text-faint">Aucune modification enregistrée.</p>
            ) : (
              <ul className="mt-3 max-h-72 space-y-1.5 overflow-auto text-[11px] text-muted">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2">
                    <span>
                      <strong
                        className={
                          entry.action === 'delete'
                            ? 'text-clay'
                            : entry.action === 'create'
                              ? 'text-emerald'
                              : 'text-cyan'
                        }
                      >
                        {entry.action}
                      </strong>{' '}
                      {entry.monthDate?.slice(0, 7) ?? ''} — {entry.actorName ?? 'système'}
                    </span>
                    <span className="font-mono text-faint">{fmtDate(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
