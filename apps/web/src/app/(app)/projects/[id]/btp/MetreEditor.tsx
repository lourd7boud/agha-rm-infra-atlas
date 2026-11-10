'use client';

// Éditeur de métré — un bloc par ligne de bordereau. Hiérarchie fidèle au
// système source : sections (lieu/douar) → sous-sections (élément, avec
// multiplicateur nombreElements pour le ferraillage) → lignes de mesures aux
// colonnes dépendantes de l'unité. Sur les lignes acier (KG/T) chaque mesure
// porte son propre « Nombre d’éléments » (éléments structurels identiques
// répétés : 8 poteaux, 6 poutres…) à côté du « Nombre » (barres dans UN
// élément) — vide = 1, donc les métrés antérieurs gardent leur résultat. Les
// périodes précédentes s'affichent en lecture seule (badge P{n});
// « Enregistrer tout » envoie l'ensemble au moteur qui régénère le décompte.
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  computeLignePartielClient,
  DIAMETRES_DISPONIBLES,
  metreOpenStateKey,
  metreCalcType,
  normaliseNombreElements,
  POIDS_ACIER,
  restoreMetreOpenState,
  round2Client,
  serializeMetreOpenState,
  type MetreContext,
  type MetreLigne,
  type MetreSection,
  type MetreSousSection,
} from '@/lib/btp-shared';
import { DIMENSION_COLUMNS, fmtMetreQty as fmtQ } from '@/lib/metre-details';
import { PreviousPeriodes } from './PreviousPeriodes';
import { fmtMetreMoney, matchesMetreSearch, measurementIncomplete, METRE_FORMULAS, metreArticleSummary } from '@/lib/metre-workspace';
import { MetreArticleIndex, MetreToolbar, MetreWorkspaceSummary, type MetreFilter } from './MetreWorkspaceChrome';
import { MetreEntryDialog } from './MetreEntryDialog';
import { MetreSelectionBar } from './MetreSelectionBar';
import { MetreReviewPanel } from './MetreReviewPanel';
import { reviewMetreArticle } from '@/lib/metre-review';
import type { MeasurementDraft, NumericMeasureField } from '@/lib/metre-entry';

const NumericValidity = createContext<{ drafts: Record<string, string>; report: (id: string, draft: string | null) => void }>({ drafts: {}, report: () => {} });

interface EntryState {
  bordereauLigneId: string;
  /** True when Core already has a row, so clearing its last measure must be persisted. */
  persisted: boolean;
  sections: MetreSection[];
  sousSections: MetreSousSection[];
  lignes: MetreLigne[];
}

export function buildMetreSavePayload(entries: Record<string, EntryState>) {
  return Object.values(entries)
    .filter(
      (entry) =>
        entry.persisted || entry.lignes.length > 0 || entry.sections.length > 0,
    )
    .map((entry) => ({
      bordereauLigneId: entry.bordereauLigneId,
      sections: entry.sections,
      sousSections: entry.sousSections,
      lignes: entry.lignes,
    }));
}

export function markPersistedMetreEntries(
  entries: Record<string, EntryState>,
  persistedIds: ReadonlySet<string>,
): Record<string, EntryState> {
  let next = entries;
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry.persisted && persistedIds.has(entry.bordereauLigneId)) {
      if (next === entries) next = { ...entries };
      next[key] = { ...entry, persisted: true };
    }
  }
  return next;
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseNum(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Champ numérique tolérant à la virgule française ("1,5") et au point ("1.5").
 * Un <input> contrôlé par une valeur number ré-injecte le nombre parsé à chaque
 * frappe, ce qui avale immédiatement le séparateur saisi ("1," → parse → 1 →
 * le champ redevient "1"). Ici on garde un brouillon texte pendant la frappe,
 * on ne re-normalise l'affichage qu'au blur, et on remonte la valeur analysée
 * à chaque frappe pour que les totaux restent à jour.
 */
function DecimalInput({
  value,
  onCommit,
  inputMode = 'decimal',
  className,
  title,
  fieldId,
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  inputMode?: 'decimal' | 'numeric';
  className?: string;
  title?: string;
  fieldId?: string;
}) {
  const validity = useContext(NumericValidity);
  const [draft, setDraft] = useState(() =>
    fieldId && validity.drafts[fieldId] || (value == null ? '' : String(value).replace('.', ',')),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(fieldId && validity.drafts[fieldId] || (value == null ? '' : String(value).replace('.', ',')));
  }, [value, focused, fieldId, validity.drafts]);

  return (
    <input
      inputMode={inputMode}
      title={title}
      aria-label={title}
      aria-invalid={draft.trim() !== '' && parseNum(draft) === undefined || undefined}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseNum(e.target.value);
        const invalid = e.target.value.trim() !== '' && parsed === undefined;
        if (fieldId) validity.report(fieldId, invalid ? e.target.value : null);
        if (!invalid) onCommit(parsed);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

const SECTION_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];

/**
 * Saisie d'un comptage d'éléments : entier non nul, avec signe négatif pour une
 * déduction. Les valeurs vides, nulles ou invalides retombent à 1 comme dans le
 * moteur serveur.
 */
function IntegerInput({
  value,
  onCommit,
  className,
  title,
  fieldId,
}: {
  value: number | undefined;
  onCommit: (value: number) => void;
  className?: string;
  title?: string;
  fieldId?: string;
}) {
  const validity = useContext(NumericValidity);
  const [draft, setDraft] = useState(() =>
    fieldId && validity.drafts[fieldId] || (value == null ? '' : String(value).replace('.', ',')),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(fieldId && validity.drafts[fieldId] || (value == null ? '' : String(value).replace('.', ',')));
  }, [value, focused, fieldId, validity.drafts]);

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="1"
      title={title}
      aria-label={title}
      aria-invalid={draft.trim() !== '' && parseNum(draft) === undefined || undefined}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const invalid = raw.trim() !== '' && parseNum(raw) === undefined;
        if (fieldId) validity.report(fieldId, invalid ? raw : null);
        // Vide / 0 / invalide → 1 ; le signe d'une déduction est conservé.
        if (!invalid) onCommit(normaliseNombreElements(parseNum(raw)));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

/** Rappel affiché sous chaque table de ferraillage. */
const ACIER_LEGENDE =
  'Nombre = barres / pièces dans UN élément · Nombre d’éléments = éléments identiques répétés (8 poteaux, 6 poutres…) — vide = 1 · négatif = déduction · poids = Nombre × Nombre d’éléments × Longueur × poids du Ø.';

const NOMBRE_ELEMENTS_HINT =
  'Nombre d’éléments structurels identiques répétés pour cette mesure (ex. 8 poteaux, 6 poutres, 4 bassins). Vide = 1, négatif = déduction. « Nombre » reste le nombre de barres dans UN seul élément.';

const SOUS_SECTION_ELEMENTS_HINT =
  'Nombre d’éléments identiques de cet élément (multiplie ses mesures acier). Une valeur négative crée une déduction. Se cumule avec le « Nombre d’éléments » saisi sur chaque ligne.';

/** Détail du calcul d'un partiel acier (attribut title de la cellule). */
function poidsPartielTitle(
  ligne: MetreLigne,
  elementsTotal: number,
  partiel: number,
): string | undefined {
  const poidsUnitaire = POIDS_ACIER[ligne.diametre ?? 0];
  if (!poidsUnitaire) return undefined;
  const nb = (v: number | undefined) =>
    (v ?? 0).toLocaleString('fr-MA', { maximumFractionDigits: 4 });
  const kg = poidsUnitaire.toLocaleString('fr-MA', { maximumFractionDigits: 3 });
  return `${nb(ligne.nombre)} barres × ${nb(elementsTotal)} élément(s) × ${nb(
    ligne.longueur,
  )} m × ${kg} kg/m = ${fmtQ(round2Client(partiel))} kg`;
}

export function MetreEditor({
  projectId,
  periodeId,
  context,
  action,
  saveFeedback,
}: {
  projectId: string;
  periodeId: string;
  context: MetreContext;
  action: (formData: FormData) => Promise<void>;
  saveFeedback?: 'saved' | 'error';
}) {
  const bordereauLignes = context.bordereau?.lignes ?? [];
  const entryKeys = useMemo(
    () => bordereauLignes.map((ligne) => ligne.id ?? String(ligne.numero)),
    [bordereauLignes],
  );
  const openStorageKey = metreOpenStateKey(projectId, periodeId);
  const persistedEntryIds = useMemo(
    () => new Set(context.metres.map((metre) => metre.bordereauLigneId)),
    [context.metres],
  );
  const [entries, setEntries] = useState<Record<string, EntryState>>(() => {
    const initial: Record<string, EntryState> = {};
    for (const ligne of bordereauLignes) {
      const key = ligne.id ?? String(ligne.numero);
      const existing = context.metres.find((m) => m.bordereauLigneId === key);
      initial[key] = {
        bordereauLigneId: key,
        persisted: existing !== undefined,
        sections: existing?.sections ?? [],
        sousSections: existing?.sousSections ?? [],
        lignes: existing?.lignes ?? [],
      };
    }
    return initial;
  });
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    for (const ligne of bordereauLignes) {
      const key = ligne.id ?? String(ligne.numero);
      state[key] = (context.metres.find((m) => m.bordereauLigneId === key)?.lignes.length ?? 0) > 0;
    }
    return state;
  });
  const [openStateReadyKey, setOpenStateReadyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MetreFilter>('all');
  const [undo, setUndo] = useState<{ key: string; entry: EntryState; label: string; drafts: Record<string, string> } | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [savedPayload, setSavedPayload] = useState(() => JSON.stringify(buildMetreSavePayload(entries)));
  const submittedPayload = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<{ key: string; lineId?: string } | null>(null);
  const currentPayload = useMemo(() => JSON.stringify(buildMetreSavePayload(entries)), [entries]);
  const dirty = currentPayload !== savedPayload || Object.values(invalidFields).some(Boolean);

  useEffect(() => {
    if (saveFeedback === 'saved' && submittedPayload.current) {
      setSavedPayload(submittedPayload.current);
      submittedPayload.current = null;
    }
  }, [context, saveFeedback]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function reportInvalid(id: string, draft: string | null) {
    setUndo(null);
    setInvalidFields((prev) => {
      if (draft !== null) return { ...prev, [id]: draft };
      if (!(id in prev)) return prev;
      const next = { ...prev }; delete next[id]; return next;
    });
  }

  // A same-route Server Action refresh may preserve this Client Component's
  // local state. Promote newly created rows once the refreshed server context
  // confirms them, without overwriting any in-progress local measurements.
  useEffect(() => {
    setEntries((current) => markPersistedMetreEntries(current, persistedEntryIds));
  }, [persistedEntryIds]);

  useEffect(() => {
    setOpenStateReadyKey(null);
    setOpen((defaults) => {
      try {
        return restoreMetreOpenState(
          window.localStorage.getItem(openStorageKey),
          entryKeys,
          defaults,
        );
      } catch {
        return restoreMetreOpenState(null, entryKeys, defaults);
      }
    });
    setOpenStateReadyKey(openStorageKey);
  }, [entryKeys, openStorageKey]);

  useEffect(() => {
    if (openStateReadyKey !== openStorageKey) return;
    try {
      window.localStorage.setItem(openStorageKey, serializeMetreOpenState(open, entryKeys));
    } catch {
      // Restricted/private browser storage must not block métré entry.
    }
  }, [entryKeys, open, openStateReadyKey, openStorageKey]);

  function mutate(key: string, mutator: (entry: EntryState) => EntryState, undoLabel?: string) {
    const entry = entries[key];
    if (!entry || pending) return;
    const next = mutator(entry);
    // Dynamic filters must not unmount the input mid-keystroke.
    if (filter === 'overrun' || filter === 'empty' && entry.lignes.length === 0 && next.lignes.length > 0) setFilter('all');
    const deleted = next.lignes.length < entry.lignes.length || next.sections.length < entry.sections.length || next.sousSections.length < entry.sousSections.length;
    setUndo(deleted || undoLabel ? { key, entry, label: undoLabel ?? 'la suppression', drafts: invalidFields } : null);
    // Numeric errors on deleted rows/elements must not block the remaining work.
    if (deleted) {
      const removed = [...entry.lignes, ...entry.sousSections].filter((item) => ![...next.lignes, ...next.sousSections].some((candidate) => candidate.id === item.id));
      setInvalidFields((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !removed.some((item) => id.startsWith(`${key}:${item.id}:`)))));
    }
    setSaveError('');
    setEntries((prev) => ({ ...prev, [key]: next }));
  }

  function undoDeletion() {
    if (!undo || pending) return;
    setEntries((prev) => ({ ...prev, [undo.key]: {
      ...undo.entry,
      // A snapshot captured before the first save must never demote a row
      // which Core has since persisted, including after its last measure is removed.
      persisted: undo.entry.persisted || prev[undo.key]?.persisted || persistedEntryIds.has(undo.key),
    } }));
    setInvalidFields((prev) => ({
      ...Object.fromEntries(Object.entries(prev).filter(([id]) => !id.startsWith(`${undo.key}:`))),
      ...Object.fromEntries(Object.entries(undo.drafts).filter(([id]) => id.startsWith(`${undo.key}:`))),
    }));
    setUndo(null);
  }

  function navigateToMeasurement(key: string, lineId?: string) {
    setQuery(''); setFilter('all');
    setOpen((prev) => ({ ...prev, [key]: true }));
    setReveal({ key, lineId });
  }

  useEffect(() => {
    if (!reveal) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(reveal.lineId ? `metre-row-${reveal.key}-${reveal.lineId}` : `metre-price-${reveal.key}`);
      target?.scrollIntoView({ behavior: 'smooth', block: reveal.lineId ? 'center' : 'start' });
      if (reveal.lineId) target?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus({ preventScroll: true });
      setReveal(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  const totals = useMemo(() => {
    const perLigne = new Map<string, ReturnType<typeof metreArticleSummary>>();
    for (const [key, entry] of Object.entries(entries)) {
      const article = bordereauLignes.find((l) => (l.id ?? String(l.numero)) === key);
      if (!article) continue;
      const previous = round2Client((context.previousByLigne[key] ?? []).reduce((sum, period) => sum + period.totalPartiel, 0));
      perLigne.set(key, metreArticleSummary(article.unite, entry.lignes, entry.sousSections, article.quantite, article.prixUnitaire, previous));
    }
    return perLigne;
  }, [entries, bordereauLignes, context.previousByLigne]);

  function save() {
    if (Object.values(invalidFields).some(Boolean)) {
      setSaveError('Corrigez les nombres invalides avant d’enregistrer. Dépliez les prix concernés pour retrouver les champs signalés.');
      setQuery(''); setFilter('all');
      setOpen(Object.fromEntries(entryKeys.map((key) => [key, true])));
      return;
    }
    if ([...totals.values()].some((total) => !Number.isFinite(total.current) || !Number.isFinite(total.amount)) || !Number.isFinite([...totals.values()].reduce((sum, total) => sum + total.amount, 0))) {
      setSaveError('Le résultat du calcul dépasse la capacité numérique. Vérifiez les dimensions, les répétitions et les prix avant d’enregistrer.');
      return;
    }
    // Persisted empty entries are deliberate deletions of the last measure.
    // Unsaved empty bordereau entries stay out of the request to avoid creating
    // hundreds of inert metre rows.
    const payload = buildMetreSavePayload(entries);
    if (payload.length === 0) return;
    const formData = new FormData();
    formData.set('projectId', projectId);
    formData.set('periodeId', periodeId);
    formData.set('entries', JSON.stringify(payload));
    submittedPayload.current = currentPayload;
    setSaveError('');
    startTransition(async () => {
      try { await action(formData); }
      catch (error) {
        // Next's redirect control flow belongs to the router, not this error UI.
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
        setSaveError('Enregistrement impossible. Vos modifications restent dans cette page ; réessayez.');
      }
    });
  }

  const articles = bordereauLignes.map((article) => {
    const key = article.id ?? String(article.numero);
    const summary = totals.get(key)!;
    return { ...article, ...summary, key, count: entries[key]?.lignes.length ?? 0 };
  });
  const counts = { all: articles.length, started: articles.filter((a) => a.count > 0).length, empty: articles.filter((a) => !a.count).length, overrun: articles.filter((a) => a.overrun).length };
  const visibleArticles = articles.filter((article) => matchesMetreSearch(article, query) && (filter === 'all' || (filter === 'started' ? article.count > 0 : filter === 'empty' ? !article.count : article.overrun)));
  const amount = round2Client(articles.reduce((sum, article) => sum + article.amount, 0));
  const measureCount = articles.reduce((sum, article) => sum + article.count, 0);
  const reviewIssues = useMemo(() => bordereauLignes.flatMap((article) => {
    const key = article.id ?? String(article.numero);
    const entry = entries[key];
    return entry ? reviewMetreArticle({ key, unite: article.unite, quantite: article.quantite, previous: (context.previousByLigne[key] ?? []).reduce((sum, previous) => sum + previous.totalPartiel, 0), lignes: entry.lignes, sousSections: entry.sousSections }) : [];
  }), [entries, bordereauLignes, context.previousByLigne]);

  return (
    <NumericValidity.Provider value={{ drafts: invalidFields, report: reportInvalid }}>
    <div ref={editorRef} className="space-y-5">
      <MetreWorkspaceSummary amount={amount} measured={counts.started} total={counts.all} measures={measureCount} warnings={counts.overrun} />
      <MetreReviewPanel issues={reviewIssues} articleLabels={Object.fromEntries(articles.map((article) => [article.key, `Prix n°${article.numero}`]))} onNavigate={navigateToMeasurement} />
      <div className="grid items-start gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
      <MetreArticleIndex articles={visibleArticles} onSelect={(key) => {
        setOpen((prev) => ({ ...prev, [key]: true }));
        document.getElementById(`metre-price-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }} />
      <div className="min-w-0 space-y-4">
      <MetreToolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} counts={counts} shown={visibleArticles.length} onExpand={() => setOpen((prev) => ({ ...prev, ...Object.fromEntries(visibleArticles.map((a) => [a.key, true])) }))} onCollapse={() => setOpen((prev) => ({ ...prev, ...Object.fromEntries(visibleArticles.map((a) => [a.key, false])) }))} />
      {saveError && <p role="alert" className="rounded-lg border border-clay/30 bg-clay-soft/30 px-4 py-3 text-sm text-clay">{saveError}</p>}
      {undo && <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-cyan/30 bg-cyan-soft/40 px-4 py-2 text-xs text-ink-2"><span>Opération appliquée au brouillon.</span><button type="button" disabled={pending} onClick={undoDeletion} className="rounded px-2 py-1 font-bold text-cyan hover:bg-cyan-soft">Annuler {undo.label} ↶</button></div>}
      {!visibleArticles.length && <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-12 text-center"><p className="font-semibold text-ink-2">Aucun prix ne correspond à votre recherche</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }} className="mt-3 text-xs font-semibold text-cyan">Afficher tous les prix</button></div>}
      <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
      {visibleArticles.map((bordereauLigne) => {
        const key = bordereauLigne.id ?? String(bordereauLigne.numero);
        const entry = entries[key];
        if (!entry) return null;
        const type = metreCalcType(bordereauLigne.unite);
        const previous = context.previousByLigne[key] ?? [];
        const cumulPrecedent = round2Client(previous.reduce((sum, p) => sum + p.totalPartiel, 0));
        const partielActuel = totals.get(key)?.current ?? 0;
        const cumul = round2Client(cumulPrecedent + partielActuel);
        const pct = bordereauLigne.quantite > 0 ? (cumul / bordereauLigne.quantite) * 100 : 0;
        const isOpen = open[key] ?? false;
        const unassigned = entry.lignes.filter((l) => !l.subSectionId);

        return (
          <section
            key={key}
            id={`metre-price-${key}`}
            className={`scroll-mt-24 overflow-hidden rounded-xl border bg-paper-2 shadow-sm ${isOpen ? 'border-cyan/40' : 'border-line'}`}
          >
            {/* En-tête de l'article */}
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`metre-measures-${key}`}
              onClick={() => setOpen((prev) => ({ ...prev, [key]: !isOpen }))}
              className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-sand/40 sm:px-5"
            >
              <span className="shrink-0 rounded-lg bg-cyan-soft px-2.5 py-2 font-mono text-xs font-bold text-cyan">
                Prix n°{bordereauLigne.numero}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-ink-2">
                {bordereauLigne.designation}
                <span className="mt-1 block text-[11px] font-normal text-muted">{entry.lignes.length} mesure(s) · PU {fmtMetreMoney(bordereauLigne.prixUnitaire)} MAD / {bordereauLigne.unite}</span>
              </span>
              <span className="rounded-full bg-sand px-2 py-0.5 font-mono text-[10px] font-bold text-muted">
                {bordereauLigne.unite}
              </span>
              <span className="mt-1 text-muted" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>

            <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
              {[{ label: 'Quantité marché', value: bordereauLigne.quantite }, { label: 'Cumul précédent', value: cumulPrecedent }, { label: 'Cette période', value: partielActuel }, { label: 'Cumul réalisé', value: cumul }].map((metric, i) => <div key={metric.label} className={`px-4 py-2.5 ${i === 2 ? 'bg-cyan-soft/30' : 'bg-paper-2'}`}><p className="text-[10px] font-medium text-muted">{metric.label}</p><p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${i === 2 ? 'text-cyan' : i === 3 && pct > 100 ? 'text-ochre' : 'text-ink-2'}`}>{fmtQ(metric.value)} <span className="text-[10px] font-normal text-faint">{bordereauLigne.unite}</span></p></div>)}
            </div>
            <div className="flex items-center gap-3 border-t border-line/70 px-4 py-2 text-[10px] text-muted"><div className="h-1 flex-1 overflow-hidden rounded-full bg-sand"><div className={`h-full rounded-full ${pct > 100 ? 'bg-ochre' : 'bg-cyan'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div><span className={pct > 100 ? 'font-bold text-ochre' : ''}>{pct.toLocaleString('fr-MA', { maximumFractionDigits: 1 })}% réalisé</span>{cumul > bordereauLigne.quantite && <span className="font-semibold text-ochre">Dépassement +{fmtQ(cumul - bordereauLigne.quantite)} {bordereauLigne.unite}</span>}</div>

            {isOpen && (
              <div id={`metre-measures-${key}`} className="border-t border-line px-3 py-4 sm:px-5">
                {/* Périodes précédentes (lecture seule, détails repliables) */}
                <PreviousPeriodes unite={bordereauLigne.unite} previous={previous} />

                {/* Sections & sous-sections */}
                {entry.sections.map((section) => {
                  const sousSections = entry.sousSections.filter(
                    (s) => s.sectionId === section.id,
                  );
                  return (
                    <div
                      key={section.id}
                      className="mb-3 rounded-lg border border-line"
                      style={{ borderLeftColor: section.couleur ?? '#22d3ee', borderLeftWidth: 3 }}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input
                          aria-label="Nom du lieu"
                          value={section.titre}
                          onChange={(e) =>
                            mutate(key, (entryState) => ({
                              ...entryState,
                              sections: entryState.sections.map((s) =>
                                s.id === section.id ? { ...s, titre: e.target.value } : s,
                              ),
                            }))
                          }
                          placeholder="Lieu / douar…"
                          className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-bold outline-none focus:border-cyan focus:bg-paper"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            mutate(key, (entryState) => ({
                              ...entryState,
                              sousSections: [
                                ...entryState.sousSections,
                                {
                                  id: newId('ss'),
                                  sectionId: section.id,
                                  titre: '',
                                  ...(type === 'poids' ? { nombreElements: 1 } : {}),
                                },
                              ],
                            }))
                          }
                          className="rounded-md bg-sand px-2 py-1 text-[11px] font-bold text-ink-2 hover:bg-line"
                        >
                          + Élément
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            mutate(key, (entryState) => {
                              const removedSousSectionIds = new Set(
                                entryState.sousSections
                                  .filter((s) => s.sectionId === section.id)
                                  .map((s) => s.id),
                              );
                              return {
                                ...entryState,
                                sections: entryState.sections.filter((s) => s.id !== section.id),
                                sousSections: entryState.sousSections.filter(
                                  (s) => s.sectionId !== section.id,
                                ),
                                lignes: entryState.lignes.filter(
                                  (l) => !l.subSectionId || !removedSousSectionIds.has(l.subSectionId),
                                ),
                              };
                            })
                          }
                          className="text-faint hover:text-clay"
                          title="Supprimer le lieu"
                        >
                          ✕
                        </button>
                      </div>
                      {sousSections.length === 0 && <p className="px-5 pb-3 text-xs text-muted">Ajoutez un élément (semelle, radier, voile…) pour saisir les mesures de ce lieu.</p>}
                      {sousSections.map((sousSection) => (
                        <SousSectionBlock
                          key={sousSection.id}
                          entryKey={key}
                          destination={`Prix n°${bordereauLigne.numero} · ${section.titre || 'Lieu sans nom'}`}
                          unite={bordereauLigne.unite}
                          type={type}
                          sousSection={sousSection}
                          lignes={entry.lignes.filter((l) => l.subSectionId === sousSection.id)}
                          mutate={mutate}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* Mesures directes (sans lieu) */}
                <LignesTable
                  entryKey={key}
                  destination={`Prix n°${bordereauLigne.numero} · Mesures directes`}
                  unite={bordereauLigne.unite}
                  type={type}
                  lignes={unassigned}
                  sousSectionId={undefined}
                  nombreElements={undefined}
                  mutate={mutate}
                  title={entry.sections.length > 0 ? 'Mesures directes' : undefined}
                />

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      mutate(key, (entryState) => ({
                        ...entryState,
                        sections: [
                          ...entryState.sections,
                          {
                            id: newId('sec'),
                            titre: '',
                            couleur:
                              SECTION_COLORS[entryState.sections.length % SECTION_COLORS.length],
                          },
                        ],
                      }))
                    }
                    className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-muted transition hover:border-cyan hover:text-cyan"
                  >
                    + Lieu (section)
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      </fieldset>
      </div>
      </div>

      {/* Barre d'action */}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper-2/95 px-5 py-3 shadow-lg backdrop-blur">
        <div><p className="flex items-center gap-2 text-xs font-semibold text-ink-2" role="status"><span className={`h-2 w-2 rounded-full ${pending ? 'animate-pulse bg-cyan' : dirty ? 'bg-ochre' : 'bg-emerald'}`} />{pending ? 'Enregistrement en cours…' : dirty ? 'Modifications non enregistrées' : 'Aucune modification en attente'}</p><p className="mt-1 text-[11px] text-muted">{measureCount} mesure(s) · <span className="font-mono font-semibold text-ink-2">{fmtMetreMoney(amount)} MAD HT</span></p></div>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="w-full rounded-lg bg-cyan px-5 py-3 text-sm font-bold text-paper transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
        >
          {pending ? 'Génération du décompte…' : 'Enregistrer et générer le décompte →'}
        </button>
      </div>
      <p className="text-center text-[10px] text-faint">Le décompte est régénéré après chaque enregistrement. Les exports utilisent les dernières données enregistrées.</p>
    </div>
    </NumericValidity.Provider>
  );
}

// ─── Sous-section (élément) ──────────────────────────────────────────────────

function SousSectionBlock({
  entryKey,
  destination,
  unite,
  type,
  sousSection,
  lignes,
  mutate,
}: {
  entryKey: string;
  destination: string;
  unite: string;
  type: ReturnType<typeof metreCalcType>;
  sousSection: MetreSousSection;
  lignes: MetreLigne[];
  mutate: (key: string, mutator: (entry: EntryState) => EntryState, undoLabel?: string) => void;
}) {
  return (
    <div className="border-t border-line/60 px-3 pb-2 pt-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-faint">Élément</span>
        <input
          aria-label="Nom de l’élément"
          value={sousSection.titre}
          onChange={(e) =>
            mutate(entryKey, (entry) => ({
              ...entry,
              sousSections: entry.sousSections.map((s) =>
                s.id === sousSection.id ? { ...s, titre: e.target.value } : s,
              ),
            }))
          }
          placeholder="Semelle, radier, voile…"
          className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-semibold outline-none focus:border-cyan focus:bg-paper"
        />
        {type === 'poids' && (
          <label className="flex items-center gap-1 text-[10px] font-semibold text-faint">
            × éléments
            <DecimalInput
              inputMode="numeric"
              value={sousSection.nombreElements ?? 1}
              title={SOUS_SECTION_ELEMENTS_HINT}
              fieldId={`${entryKey}:${sousSection.id}:nombreElements`}
              onCommit={(v) =>
                mutate(entryKey, (entry) => ({
                  ...entry,
                  sousSections: entry.sousSections.map((ss) =>
                    ss.id === sousSection.id ? { ...ss, nombreElements: v ?? 1 } : ss,
                  ),
                }))
              }
              className="w-14 rounded-md border border-line bg-paper px-1.5 py-0.5 text-right font-mono text-xs"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() =>
            mutate(entryKey, (entry) => ({
              ...entry,
              sousSections: entry.sousSections.filter((s) => s.id !== sousSection.id),
              lignes: entry.lignes.filter((l) => l.subSectionId !== sousSection.id),
            }))
          }
          className="text-faint hover:text-clay"
          title="Supprimer l'élément"
        >
          ✕
        </button>
      </div>
      <LignesTable
        entryKey={entryKey}
        destination={`${destination} · ${sousSection.titre || 'Élément sans nom'}`}
        unite={unite}
        type={type}
        lignes={lignes}
        sousSectionId={sousSection.id}
        nombreElements={sousSection.nombreElements}
        mutate={mutate}
      />
    </div>
  );
}

// ─── Table des mesures ───────────────────────────────────────────────────────

function LignesTable({
  entryKey,
  destination,
  unite,
  type,
  lignes,
  sousSectionId,
  nombreElements,
  mutate,
  title,
}: {
  entryKey: string;
  destination: string;
  unite: string;
  type: ReturnType<typeof metreCalcType>;
  lignes: MetreLigne[];
  sousSectionId: string | undefined;
  nombreElements: number | undefined;
  mutate: (key: string, mutator: (entry: EntryState) => EntryState, undoLabel?: string) => void;
  title?: string;
}) {
  const columns = DIMENSION_COLUMNS[type];
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const validity = useContext(NumericValidity);
  const [entryMode, setEntryMode] = useState<'paste' | 'template' | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selected = lignes.filter((line) => selection.has(line.id));
  const selectedInvalid = Object.keys(validity.drafts).some((id) => selected.some((line) => id.startsWith(`${entryKey}:${line.id}:`)));
  useEffect(() => {
    if (focusRow) {
      document.getElementById(`metre-row-${entryKey}-${focusRow}`)?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus();
      setFocusRow(null);
    }
  }, [focusRow, lignes, entryKey]);

  function addMeasure() {
    const id = newId('mes');
    mutate(entryKey, (entry) => ({ ...entry, lignes: [...entry.lignes, {
      id, subSectionId: sousSectionId, designation: '',
      ...(type === 'poids' ? { nombreElements: 1 } : { nombreSemblables: 1 }),
    }] }));
    setFocusRow(id);
  }

  function appendMeasurements(drafts: MeasurementDraft[], undoLabel: string) {
    const newLines = drafts.map((line) => ({ ...line, id: newId('mes'), subSectionId: sousSectionId }));
    mutate(entryKey, (entry) => ({ ...entry, lignes: [...entry.lignes, ...newLines] }), undoLabel);
    setEntryMode(null); setSelection(new Set());
    setFocusRow(newLines[0]?.id ?? null);
  }

  function duplicateSelection() {
    if (selectedInvalid) return;
    mutate(entryKey, (entry) => ({ ...entry, lignes: entry.lignes.flatMap((line) => selection.has(line.id) && lignes.some((local) => local.id === line.id) ? [line, { ...line, id: newId('mes') }] : [line]) }), 'la duplication groupée');
    setSelection(new Set());
  }

  function fillSelection(field: NumericMeasureField, value: number) {
    for (const line of selected) validity.report(`${entryKey}:${line.id}:${field}`, null);
    const ids = new Set(selected.map((line) => line.id));
    mutate(entryKey, (entry) => ({ ...entry, lignes: entry.lignes.map((line) => ids.has(line.id) ? { ...line, [field]: value } : line) }), 'la modification groupée');
  }
  // Multiplicateur de la sous-section (l'élément entier) — métrique historique,
  // indépendante du « Nombre d’éléments » propre à chaque ligne de mesure.
  const sousSectionMult =
    type === 'poids' && nombreElements && Number.isFinite(nombreElements) ? nombreElements : 1;
  // Une ligne acier répétée à la fois par sa sous-section et par sa colonne
  // « Nombre d’éléments » verrait ses kg comptés deux fois : on le signale.
  const ligneMult =
    type === 'poids'
      ? Math.max(1, ...lignes.map((l) => normaliseNombreElements(l.nombreElements)))
      : 1;
  const doubleCount = sousSectionMult > 1 && ligneMult > 1;
  return (
    <div ref={tableRef} className="mt-3">
      {title && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-faint">
          {title}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted">Saisie des mesures <span className="font-mono text-faint">· {unite}</span></p>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setPasteText(''); setEntryMode('paste'); }} className="rounded-lg border border-cyan/30 bg-cyan-soft/25 px-3 py-2 text-xs font-semibold text-cyan hover:bg-cyan-soft">Coller un tableau</button><button type="button" onClick={() => setEntryMode('template')} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:border-cyan hover:text-cyan">Modèle d’ouvrage</button></div>
      </div>
      {entryMode && <MetreEntryDialog mode={entryMode} unit={unite} destination={destination} initialText={pasteText} factor={sousSectionMult} onApply={appendMeasurements} onClose={() => setEntryMode(null)} />}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sand/60 px-3 py-2 text-[11px]">
        <p className="text-muted"><span className="mr-2 font-semibold text-ink-2">Calcul {unite}</span>{METRE_FORMULAS[type]}{type === 'poids' && unite.trim().toUpperCase() === 'T' ? ' ÷ 1 000' : ''}</p>
        <span className="text-faint">{type === 'volume' || type === 'surface' || type === 'lineaire' ? 'Dimensions en mètres · ' : ''}Virgule ou point acceptés</span>
      </div>
      {doubleCount && (
        <p className="mb-1 rounded-md border border-ochre-soft bg-ochre-soft/20 px-2 py-1 text-[10px] font-medium text-ochre">
          ⚠ Répétitions combinées : élément × {sousSectionMult} et « Nombre d’éléments »{' '}
          × {ligneMult} — les deux facteurs se multiplient ; vérifiez qu’ils sont indépendants.
        </p>
      )}
      {selected.length > 0 && <MetreSelectionBar unit={unite} count={selected.length} invalid={selectedInvalid} onFill={fillSelection} onDuplicate={duplicateSelection} onDelete={() => {
        const ids = new Set(selected.map((line) => line.id));
        mutate(entryKey, (entry) => ({ ...entry, lignes: entry.lignes.filter((line) => !ids.has(line.id)) }));
        setSelection(new Set());
      }} onClear={() => setSelection(new Set())} />}
      {lignes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line" onPaste={(event) => {
          const text = event.clipboardData.getData('text/plain');
          if (text.includes('\t') || text.includes('\n')) {
            event.preventDefault(); setPasteText(text); setEntryMode('paste');
          }
        }} onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected.length) { event.preventDefault(); duplicateSelection(); return; }
          if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
          const target = event.target as HTMLElement;
          if (!target.matches('input:not([type="checkbox"]), select')) return;
          event.preventDefault();
          const fields = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('tbody input:not([type="checkbox"]), tbody select') ?? []);
          const next = fields[fields.indexOf(target as HTMLInputElement) + 1];
          if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
          else addMeasure();
        }}>
          <table aria-label={`Mesures ${unite}${title ? ` · ${title}` : ''}`} className="w-full min-w-[780px] border-collapse text-left text-xs">
            <thead className="bg-sand/70 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="w-9 border-r border-line px-2 py-3 text-center"><input type="checkbox" aria-label="Sélectionner toutes les mesures" checked={selected.length === lignes.length && lignes.length > 0} onChange={(event) => setSelection(event.target.checked ? new Set(lignes.map((line) => line.id)) : new Set())} className="accent-cyan" /></th>
                <th scope="col" className="w-9 border-r border-line px-2 py-3 text-center">N°</th>
                <th scope="col" className="min-w-48 border-r border-line px-3 py-3">Désignation</th>
                {columns.map((col) => (
                  <th
                    key={String(col.field)}
                    scope="col"
                    className="w-24 border-r border-line px-2 py-3 text-right"
                    title={col.hint}
                  >
                    {col.label}
                    {col.hint && (
                      <span aria-hidden className="ml-0.5 font-normal text-faint">
                        ⓘ
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="w-28 border-r border-line px-2 py-3 text-right">Partiel <span className="font-normal">({unite})</span></th>
                <th scope="col" className="relative w-20 px-2 py-3 text-center"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {lignes.map((ligne, rowIndex) => {
                const ligneElements =
                  type === 'poids' ? normaliseNombreElements(ligne.nombreElements) : 1;
                const elementsTotal = ligneElements * sousSectionMult;
                const partiel = computeLignePartielClient(unite, ligne) * sousSectionMult;
                const showRepetition = type === 'poids' && elementsTotal > 1;
                return (
                  <tr key={ligne.id} id={`metre-row-${entryKey}-${ligne.id}`} className="group odd:bg-paper-2 even:bg-paper/70 focus-within:bg-cyan-soft/15 hover:bg-sand/35 [&>td]:border-r [&>td]:border-line/60 last:[&>td]:border-r-0">
                    <td className={`px-2 text-center ${selection.has(ligne.id) ? 'bg-cyan-soft/35' : ''}`}><input type="checkbox" aria-label={`Sélectionner la mesure ${rowIndex + 1}`} checked={selection.has(ligne.id)} onChange={(event) => setSelection((prev) => { const next = new Set(prev); if (event.target.checked) next.add(ligne.id); else next.delete(ligne.id); return next; })} className="accent-cyan" /></td>
                    <td className="px-2 py-2 text-center font-mono text-[10px] text-faint">{rowIndex + 1}</td>
                    <td className="px-1.5 py-1.5">
                      <input
                        aria-label={`Désignation · mesure ${rowIndex + 1}`}
                        value={ligne.designation ?? ''}
                        onChange={(e) =>
                          mutate(entryKey, (entry) => ({
                            ...entry,
                            lignes: entry.lignes.map((l) =>
                              l.id === ligne.id ? { ...l, designation: e.target.value } : l,
                            ),
                          }))
                        }
                        placeholder="Ex. : semelle S1, chaînage…"
                        className="w-full rounded-md border border-line/60 bg-paper/50 px-2 py-2 text-ink-2 outline-none transition focus:border-cyan focus:bg-paper focus:ring-2 focus:ring-cyan/15"
                      />
                      {measurementIncomplete(unite, ligne) && <p className="px-2 pt-1 text-[10px] text-ochre">Dimensions à compléter</p>}
                      {showRepetition && (
                        <p
                          title={`La quantité calculée porte sur ${elementsTotal} exemplaire(s) identique(s).`}
                          className="mt-0.5 inline-flex w-fit rounded-full bg-emerald-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald"
                        >
                          × {ligneElements}
                          {sousSectionMult > 1 ? ` × ${sousSectionMult}` : ''} élément(s)
                        </p>
                      )}
                    </td>
                    {columns.map((col) => (
                      <td key={String(col.field)} className="px-1 py-1">
                        {col.field === 'diametre' ? (
                          <select
                            aria-label={`Diamètre · mesure ${rowIndex + 1}`}
                            value={ligne.diametre ?? ''}
                            onChange={(e) =>
                              mutate(entryKey, (entry) => ({
                                ...entry,
                                lignes: entry.lignes.map((l) =>
                                  l.id === ligne.id
                                    ? { ...l, diametre: parseNum(e.target.value) }
                                    : l,
                                ),
                              }))
                            }
                            className="w-full rounded-md border border-line/60 bg-paper/50 px-1 py-2 text-right font-mono outline-none focus:border-cyan focus:bg-paper focus:ring-2 focus:ring-cyan/15"
                          >
                            <option value="">—</option>
                            {DIAMETRES_DISPONIBLES.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        ) : col.field === 'nombreElements' ? (
                          <IntegerInput
                            // Défaut du moteur affiché pour les mesures
                            // enregistrées avant le champ : rien n'est réécrit
                            // tant que l'utilisateur ne modifie pas la valeur.
                            value={ligne.nombreElements ?? col.fallback}
                            title={`Nombre d’éléments · mesure ${rowIndex + 1}. ${NOMBRE_ELEMENTS_HINT}`}
                            fieldId={`${entryKey}:${ligne.id}:${col.field}`}
                            onCommit={(v) =>
                              mutate(entryKey, (entry) => ({
                                ...entry,
                                lignes: entry.lignes.map((l) =>
                                  l.id === ligne.id ? { ...l, nombreElements: v } : l,
                                ),
                              }))
                            }
                            className="w-full rounded-md border border-line/60 bg-paper/50 px-2 py-2 text-right font-mono tabular-nums outline-none focus:border-cyan focus:bg-paper focus:ring-2 focus:ring-cyan/15 aria-invalid:border-clay aria-invalid:bg-clay-soft/30"
                          />
                        ) : (
                          <DecimalInput
                            title={`${col.label} · mesure ${rowIndex + 1}`}
                            fieldId={`${entryKey}:${ligne.id}:${col.field}`}
                            value={ligne[col.field] as number | undefined}
                            onCommit={(v) =>
                              mutate(entryKey, (entry) => ({
                                ...entry,
                                lignes: entry.lignes.map((l) =>
                                  l.id === ligne.id ? { ...l, [col.field]: v } : l,
                                ),
                              }))
                            }
                            className="w-full rounded-md border border-line/60 bg-paper/50 px-2 py-2 text-right font-mono tabular-nums outline-none focus:border-cyan focus:bg-paper focus:ring-2 focus:ring-cyan/15 aria-invalid:border-clay aria-invalid:bg-clay-soft/30"
                          />
                        )}
                      </td>
                    ))}
                    <td
                      title={
                        type === 'poids' && elementsTotal > 0
                          ? poidsPartielTitle(ligne, elementsTotal, partiel)
                          : undefined
                      }
                      className="bg-emerald-soft/15 px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald"
                    >
                      {fmtQ(round2Client(partiel))}
                    </td>
                    <td className="px-1 py-1 text-center whitespace-nowrap">
                      <button type="button" aria-label={`Dupliquer la mesure ${rowIndex + 1}`} title="Dupliquer cette mesure" onClick={() => {
                        const id = newId('mes');
                        mutate(entryKey, (entry) => { const index = entry.lignes.findIndex((item) => item.id === ligne.id); return { ...entry, lignes: [...entry.lignes.slice(0, index + 1), { ...ligne, id }, ...entry.lignes.slice(index + 1)] }; });
                        setFocusRow(id);
                      }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-cyan-soft hover:text-cyan focus-visible:outline-2 focus-visible:outline-cyan"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg></button>
                      <button
                        type="button"
                        aria-label={`Supprimer la mesure ${rowIndex + 1}`}
                        title="Supprimer cette mesure"
                        onClick={() =>
                          mutate(entryKey, (entry) => ({
                            ...entry,
                            lignes: entry.lignes.filter((l) => l.id !== ligne.id),
                          }))
                        }
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-clay-soft hover:text-clay focus-visible:outline-2 focus-visible:outline-clay"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t border-line bg-sand/40"><td colSpan={columns.length + 3} className="px-3 py-2 text-[11px] font-semibold text-muted">Sous-total · {lignes.length} mesure(s)</td><td className="px-3 py-2 text-right font-mono font-bold text-emerald">{fmtQ(round2Client(lignes.reduce((sum, line) => sum + computeLignePartielClient(unite, line) * sousSectionMult, 0)))}</td><td className="px-2 text-[10px] text-faint">{unite}</td></tr></tfoot>
          </table>
        </div>
      )}
      {lignes.length === 0 && <div className="rounded-lg border border-dashed border-line bg-paper/40 px-4 py-6 text-center"><p className="text-xs font-semibold text-ink-2">Aucune mesure pour le moment</p><p className="mt-1 text-[11px] text-muted">Ajoutez une mesure puis renseignez ses dimensions. Le partiel se calcule automatiquement.</p></div>}
      {type === 'poids' && lignes.length > 0 && (
        <p className="mt-1 text-[10px] leading-relaxed text-faint">{ACIER_LEGENDE}</p>
      )}
      <button
        type="button"
        onClick={addMeasure}
        className="mt-3 rounded-lg border border-cyan/25 bg-cyan-soft/50 px-3 py-2 text-xs font-semibold text-cyan transition hover:bg-cyan-soft focus-visible:outline-2 focus-visible:outline-cyan"
      >
        + Mesure
      </button>
      {lignes.length > 0 && <span className="ml-3 inline-block text-[10px] text-faint">Tab pour naviguer · Entrée pour avancer ou ajouter une mesure</span>}
    </div>
  );
}
