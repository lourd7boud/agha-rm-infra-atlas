// Gestion des Index BTP — la table mensuelle des index officiels qui alimente
// la révision des prix de tous les marchés, + les formules réutilisables et le
// journal d'audit des modifications (direction / admin-si).
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiDelete, apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { apiPut, fmtDate, type RevisionFormula, type RevisionIndexMonth } from '@/lib/btp';
import { isRedirectError } from '@/lib/next-redirect';
import { IndexBulletinImport } from './IndexBulletinImport';
import { CodeValueFields } from './CodeValueFields';
import { parseCodeValues } from './index-import-data';
import { applyIndexImport, readIndexImport, retryIndexImport, reviewIndexImport, startIndexImport } from './index-import-actions';
import type { IndexBulletinSource, IndexImportDraft } from './index-import-types';

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
  const manualOpen = query.manual === '1' || Boolean(query.import);
  const [indexes, formulas, audit, sources, recentDrafts, opened] = await Promise.all([
    apiGet<RevisionIndexMonth[]>('/btp/revision/indexes'),
    apiGet<RevisionFormula[]>('/btp/revision/formulas'),
    apiGet<AuditRow[]>('/btp/revision/indexes-audit').catch(() => [] as AuditRow[]),
    manualOpen ? apiGet<IndexBulletinSource[]>('/btp/revision/index-imports/sources').catch(() => undefined) : undefined,
    apiGet<IndexImportDraft[]>('/btp/revision/index-imports').catch(() => []),
    query.import ? readIndexImport(query.import) : Promise.resolve(undefined),
  ]);
  // Colonnes = union des noms d'index rencontrés (table générique, data-driven).
  const indexNames = [...new Set(indexes.flatMap((m) => Object.keys(m.indexValues)))].sort();
  const latestAutomatic = recentDrafts.find((draft) => draft.automatic);

  async function upsertMonth(formData: FormData) {
    'use server';
    const month = String(formData.get('month') ?? '');
    let values: Record<string, number>;
    try {
      values = parseCodeValues(formData, 'indexCode', 'indexValue');
    } catch {
      redirect('/projects/indexes?error=upsertMonth&code=invalid');
    }
    try {
      await apiPut('/btp/revision/indexes', {
        monthDate: `${month}-01`,
        indexValues: values,
        source: String(formData.get('source') ?? '') || undefined,
        publishedOn: String(formData.get('publishedOn') ?? ''),
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
    let weights: Record<string, number>;
    try {
      weights = parseCodeValues(formData, 'weightCode', 'weightValue', true);
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
      <a href="https://www.equipement.gov.ma/Ingenierie/Pages/Revision-des-prix-baremes-indexation.aspx"
        target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-cyan underline">
        Consulter les barèmes du ministère
      </a>

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
          {query.code === 'invalid' ? 'Vérifiez les champs, les codes et leurs valeurs.' : 'L’enregistrement a échoué. Réessayez.'}
        </div>
      )}

      <section className="mt-6 rounded-xl border border-line bg-paper-2 px-5 py-4 shadow-sm" aria-label="Synchronisation avec le ministère">
        <h2 className="text-sm font-bold">Synchronisation avec le ministère</h2>
        {latestAutomatic ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <p className={latestAutomatic.status === 'failed' ? 'text-clay' : 'text-muted'}>
              {latestAutomatic.status === 'applied' ? `Dernier bulletin synchronisé le ${fmtDate(latestAutomatic.appliedAt)}`
                : latestAutomatic.status === 'failed' ? 'Dernier bulletin en attente de validation automatique'
                  : 'Vérification du bulletin en cours'} · {latestAutomatic.reference ?? latestAutomatic.filename}
            </p>
            <a href={`/api/projects/index-bulletins/${latestAutomatic.id}`} className="font-semibold text-cyan underline"
              target="_blank" rel="noreferrer">PDF archivé</a>
            {latestAutomatic.status === 'failed' && (
              <Link href={`/projects/indexes?import=${latestAutomatic.id}`} className="font-semibold text-cyan underline">Voir le détail</Link>
            )}
          </div>
        ) : <p className="mt-2 text-sm text-muted">En attente du premier bulletin synchronisé.</p>}
      </section>

      {opened?.error && <p role="alert" className="mt-4 text-sm text-clay">{opened.error}</p>}
      {manualOpen ? (
        <details className="mt-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-muted">Import manuel et historique des bulletins</summary>
          <IndexBulletinImport sources={sources ?? []} recentDrafts={recentDrafts} initialDraft={opened?.value}
            unavailable={sources === undefined}
            actions={{ start: startIndexImport, read: readIndexImport, retry: retryIndexImport, review: reviewIndexImport, apply: applyIndexImport }} />
        </details>
      ) : (
        <Link href="/projects/indexes?manual=1" prefetch={false} className="mt-4 inline-block text-sm font-semibold text-muted hover:text-cyan">
          Import manuel et historique des bulletins
        </Link>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Table des mois */}
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm xl:col-span-2">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Index mensuels ({indexes.length} mois)
          </h2>
          {indexes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              En attente des premiers index mensuels.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-line bg-sand text-[10px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2.5">Mois</th>
                    <th className="px-3 py-2.5">Statut</th>
                    <th className="px-3 py-2.5">Bulletin</th>
                    {indexNames.map((name) => (
                      <th key={name} className="px-3 py-2.5 text-right font-mono">
                        {name}
                      </th>
                    ))}
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {indexes.map((month) => {
                    const key = month.monthDate.slice(0, 7);
                    const bulletinId = /^Import ([0-9a-f-]{36}) · /.exec(month.notes ?? '')?.[1];
                    return (
                      <tr key={month.id} className="transition hover:bg-sand/40">
                        <td className="px-3 py-2 font-mono font-bold text-cyan">{key}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              month.status === 'definitif'
                                ? 'bg-emerald-soft text-emerald'
                                : 'bg-ochre-soft text-ochre'
                            }`}
                          >
                            {month.status === 'definitif' ? 'Définitif *' : 'Provisoire **'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {bulletinId ? <a href={`/api/projects/index-bulletins/${bulletinId}`} target="_blank"
                            rel="noreferrer" className="font-semibold text-cyan underline">{month.source ?? 'PDF archivé'}</a>
                            : month.source || '—'}
                        </td>
                        {indexNames.map((name) => (
                          <td key={name} className="px-3 py-2 text-right font-mono tabular-nums">
                            {month.indexValues[name] ?? '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">
                          {!month.publishedOn && <form action={deleteMonth}>
                            <input type="hidden" name="month" value={key} />
                            <button className="text-[11px] font-semibold text-faint hover:text-clay">
                              Supprimer
                            </button>
                          </form>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Ajout / mise à jour */}
          <details className="border-t border-line">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-muted">Saisie manuelle d’un mois</summary>
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
            <div className="min-w-0 basis-full">
              <CodeValueFields codeName="indexCode" valueName="indexValue" />
            </div>
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
              Bulletin officiel
              <input
                name="source"
                required
                placeholder="DATRP/32/…"
                className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              Date de publication
              <input name="publishedOn" type="date" required className="mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
            </label>
            <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
              Enregistrer le mois
            </button>
          </form>
          </details>
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
              <div className="space-y-3">
                <label className="block text-xs text-muted">Partie fixe
                <input
                  type="number"
                  step="0.0001"
                  name="fixedPart"
                  required
                  placeholder="Partie fixe (0.15)"
                  className="w-36 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
                />
                </label>
                <CodeValueFields codeName="weightCode" valueName="weightValue" valueLabel="Coefficient" min="0" required={false} />
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
