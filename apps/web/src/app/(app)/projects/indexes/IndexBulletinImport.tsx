'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/btp-shared';
import { CodeValueFields } from './CodeValueFields';
import type { IndexBulletinSource, IndexImportDraft, IndexImportEvidence, IndexImportReceipt, IndexImportResult } from './index-import-types';

export interface IndexImportActions {
  start: (sourceUrl: string) => Promise<IndexImportResult<IndexImportDraft>>;
  read: (id: string) => Promise<IndexImportResult<IndexImportDraft>>;
  retry: (id: string) => Promise<IndexImportResult<IndexImportDraft>>;
  review?: (id: string) => Promise<IndexImportResult<IndexImportDraft>>;
  apply: (id: string, form: FormData) => Promise<IndexImportResult<IndexImportReceipt>>;
}

const field = 'mt-1 block w-full min-w-0 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink';
const button = 'rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50';
const statusLabel = { extracting: 'Lecture en cours', review: 'À vérifier', failed: 'Lecture interrompue', applied: 'Mois enregistrés' };

export function IndexBulletinImport({ sources, recentDrafts, initialDraft, actions, unavailable }: {
  sources: IndexBulletinSource[];
  recentDrafts: IndexImportDraft[];
  initialDraft?: IndexImportDraft;
  actions: IndexImportActions;
  unavailable?: boolean;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, startTransition] = useTransition();
  const resumable = draft && !recentDrafts.some((item) => item.id === draft.id) ? [draft, ...recentDrafts] : recentDrafts;

  function opened(value: IndexImportDraft) {
    setDraft(value);
    setError('');
    setPollError('');
    const url = new URL(window.location.href);
    url.searchParams.set('import', value.id);
    window.history.replaceState(null, '', url);
  }

  function run(operation: () => Promise<IndexImportResult<IndexImportDraft>>) {
    setError('');
    startTransition(async () => {
      try {
        const result = await operation();
        if (result.error) setError(result.error);
        else if (result.value) opened(result.value);
      } catch { setError('La lecture du bulletin n’a pas pu être confirmée. Réessayez.'); }
    });
  }

  useEffect(() => {
    if (draft?.status !== 'extracting') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await actions.read(draft!.id);
        if (stopped) return;
        if (result.value) { setDraft(result.value); setPollError(''); }
        else setPollError(result.error);
      } catch { if (!stopped) setPollError('Le suivi de la lecture est momentanément indisponible.'); }
      if (!stopped) timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [draft?.id, draft?.status, actions.read]);

  return <section className="mt-6 min-w-0 rounded-xl border border-line bg-paper-2 p-4 shadow-sm sm:p-5" aria-label="Importer un bulletin officiel">
    <h2 className="text-lg font-bold">Importer un bulletin officiel</h2>
    <div className="mt-4 grid items-end gap-3 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)]">
      <label className="min-w-0 text-sm font-medium">Bulletin du ministère
        <select value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={busy || unavailable} className={field}>
          <option value="">Choisir un bulletin</option>
          {sources.map((source) => <option key={source.url} value={source.url}>{source.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || !sourceUrl} className={button} onClick={() => run(() => actions.start(sourceUrl))}>{busy ? 'Ouverture…' : 'Lire le bulletin'}</button>
      {resumable.length > 0 && <label className="min-w-0 text-sm font-medium">Reprendre une lecture
        <select className={field} value={draft?.id ?? ''} disabled={busy} onChange={(event) => {
          if (event.target.value) run(() => actions.read(event.target.value));
        }}>
          <option value="">Choisir une lecture enregistrée</option>
          {resumable.map((item) => <option key={item.id} value={item.id}>{item.reference || item.filename} · {statusLabel[item.status]}</option>)}
        </select>
      </label>}
    </div>
    {unavailable && <p role="alert" className="mt-3 text-sm text-clay">La liste des bulletins est indisponible. Rechargez la page pour réessayer.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-clay">{error}</p>}
    {draft && <div className="mt-5 min-w-0 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words font-semibold">{draft.filename || draft.reference || 'Bulletin sélectionné'}</h3>
          <p className="mt-1 text-xs text-muted">Document daté du {fmtDate(draft.documentDate)} · copie observée le {fmtDate(draft.observedAt)}</p>
        </div>
        <a href={draft.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan underline">Ouvrir le bulletin officiel ↗</a>
      </div>
      {draft.issues.length > 0 && <ul className="mt-3 space-y-1 rounded-lg border border-ochre-soft bg-ochre-soft/20 p-3 text-sm text-ochre">
        {draft.issues.map((issue, index) => <li key={index}>{issue}</li>)}
      </ul>}
      {draft.status === 'extracting' && <div className="mt-4 flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-muted">Lecture des pages en cours. Les mois seront proposés pour vérification lorsque la lecture sera terminée.</p>
        <button type="button" className="text-xs font-semibold text-cyan underline" disabled={busy} onClick={() => run(() => actions.read(draft.id))}>Actualiser le suivi</button>
      </div>}
      {pollError && <p role="alert" className="mt-2 text-sm text-clay">{pollError}</p>}
      {draft.status === 'failed' && <div className="mt-4 space-y-3">
        <p role="alert" className="text-sm text-clay">{draft.failure || 'La lecture du bulletin a été interrompue.'}</p>
        {draft.retryAvailable !== false && <button type="button" disabled={busy} className={button} onClick={() => run(() => actions.retry(draft.id))}>Relancer la lecture</button>}
      </div>}
      {draft.status === 'review' && <IndexDraftReview key={draft.id} draft={draft} apply={actions.apply} reopening={busy}
        onReopen={actions.review ? () => run(() => actions.review!(draft.id)) : undefined} />}
      {draft.status === 'applied' && <div className="mt-4 space-y-3">
        <p role="status" className="text-sm font-semibold text-emerald">Les mois vérifiés de cette lecture ont été enregistrés le {fmtDate(draft.appliedAt)}. Consultez le registre ci-dessous.</p>
        {actions.review && <button type="button" disabled={busy} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-cyan" onClick={() => run(() => actions.review!(draft.id))}>Revoir les valeurs de cette version</button>}
      </div>}
    </div>}
  </section>;
}

function IndexDraftReview({ draft, apply, onReopen, reopening }: {
  draft: IndexImportDraft;
  apply: IndexImportActions['apply'];
  onReopen?: () => void;
  reopening: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [evidence, setEvidence] = useState<IndexImportEvidence | null>(null);
  const [missingSource, setMissingSource] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<IndexImportReceipt>();
  const [busy, startTransition] = useTransition();
  const sourcePage = draft.ocrPages?.find((page) => page.num === evidence?.page);

  function showSource(month: IndexImportDraft['months'][number], code: string) {
    const match = month.evidence.find((item) => item.code === code);
    setEvidence(match ?? null);
    setMissingSource(match ? '' : `Aucune ligne OCR n’est associée au code ${code}. Vérifiez sa valeur dans le bulletin officiel.`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    startTransition(async () => {
      try {
        const result = await apply(draft.id, form);
        if (result.value) { setReceipt(result.value); router.refresh(); }
        else setError(result.error);
      } catch { setError('L’enregistrement n’a pas pu être confirmé. Réessayez avec les mêmes mois.'); }
    });
  }

  return <form noValidate onSubmit={submit} className="mt-4 min-w-0 space-y-4">
    {receipt && <div className="space-y-3"><p role="status" className="rounded-lg border border-emerald-soft bg-emerald-soft/20 p-3 text-sm text-emerald">
      Mois enregistrés : {receipt.months.map((month) => month.slice(0, 7)).join(', ')}.
    </p>{onReopen && <button type="button" disabled={reopening} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-cyan" onClick={onReopen}>Revoir les valeurs de cette version</button>}</div>}
    <fieldset disabled={busy || !!receipt} className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Référence du bulletin *
          <input name="reference" required defaultValue={draft.reference ?? ''} className={field} />
        </label>
        <label className="min-w-0 text-sm font-medium">Date de publication établie *
          <input name="publishedOn" type="date" required className={field} />
        </label>
        <label className="min-w-0 text-sm font-medium sm:col-span-2">Pièce ou mention établissant la date de publication *
          <textarea name="publicationEvidence" rows={2} required defaultValue={draft.publicationEvidence ?? ''} placeholder="Référence, page ou lien où la date de publication est établie" className={field} />
          <span className="mt-1 block text-xs font-normal text-muted">Vérifiez cette date dans la source de publication. La date portée sur le bulletin et la date de collecte sont affichées ci-dessus.</span>
        </label>
      </div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="min-w-0 space-y-3">
          {draft.months.length === 0 && <p className="rounded-lg border border-line p-3 text-sm text-muted">Aucun mois exploitable n’a été extrait. Consultez la source et complétez le registre manuellement.</p>}
          {draft.months.map((month, index) => <section key={index} className="min-w-0 rounded-lg border border-line p-3">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-sm font-semibold">Mois extrait
                <input name={`month:${index}`} type="month" required={selected.has(index)} defaultValue={month.month.slice(0, 7)} className={field} />
              </label>
              <label className="min-w-0 text-sm font-medium">Statut indiqué dans le bulletin
                <select name={`status:${index}`} defaultValue={month.status ?? ''} required={selected.has(index)} className={field}>
                  <option value="">À vérifier</option><option value="provisoire">Provisoire **</option><option value="definitif">Définitif *</option>
                </select>
              </label>
            </div>
            <CodeValueFields codeName={`code:${index}`} valueName={`value:${index}`} initialValues={month.values} required={selected.has(index)} onSource={(code) => showSource(month, code)} />
            <label className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-sm font-semibold">
              <input type="checkbox" name="reviewedMonth" value={index} checked={selected.has(index)} className="mt-1 accent-cyan" onChange={(event) => {
                const checked = event.target.checked;
                setSelected((previous) => { const next = new Set(previous); if (checked) next.add(index); else next.delete(index); return next; });
              }} />
              Enregistrer ce mois après vérification des valeurs et du statut
            </label>
          </section>)}
        </div>
        <aside className="min-w-0 space-y-3 rounded-lg border border-line bg-paper p-3 xl:sticky xl:top-4" aria-label="Texte du bulletin">
          <h4 className="text-sm font-semibold">Vérification dans le bulletin</h4>
          {missingSource && <p className="text-sm text-ochre">{missingSource}</p>}
          {evidence ? <div className="space-y-2 text-xs">
            <p className="font-semibold">{evidence.code} · valeur lue {evidence.value} · page {evidence.page}</p>
            <blockquote className="whitespace-pre-wrap break-words rounded border border-line p-2 font-mono">{evidence.line}</blockquote>
            <a href={`${draft.sourceUrl.split('#')[0]}#page=${evidence.page}`} target="_blank" rel="noreferrer" className="inline-block font-semibold text-cyan underline">Ouvrir la page du bulletin ↗</a>
          </div> : !missingSource && <p className="text-xs text-muted">Choisissez « Voir la ligne source » sous une valeur extraite.</p>}
          {sourcePage && <details><summary className="cursor-pointer text-xs font-semibold text-cyan">Texte lu sur la page {sourcePage.num}</summary><pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-[11px]">{sourcePage.text}</pre></details>}
          {!evidence && draft.ocrPages?.map((page) => <details key={page.num}><summary className="cursor-pointer text-xs font-semibold text-cyan">Texte lu sur la page {page.num}</summary><pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[11px]">{page.text}</pre></details>)}
        </aside>
      </div>
      <button type="submit" disabled={!selected.size || !!receipt} className={button}>{busy ? 'Enregistrement…' : `Enregistrer les ${selected.size} mois vérifiés`}</button>
    </fieldset>
    {error && <p role="alert" className="rounded-lg border border-clay-soft bg-clay-soft/20 p-3 text-sm text-clay">{error}</p>}
  </form>;
}
