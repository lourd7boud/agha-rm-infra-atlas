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
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  computeLignePartielClient,
  DIAMETRES_DISPONIBLES,
  metreCalcType,
  normaliseNombreElements,
  POIDS_ACIER,
  round2Client,
  type MetreContext,
  type MetreLigne,
  type MetreSection,
  type MetreSousSection,
} from '@/lib/btp-shared';
import { DIMENSION_COLUMNS, fmtMetreQty as fmtQ } from '@/lib/metre-details';
import { PreviousPeriodes } from './PreviousPeriodes';

interface EntryState {
  bordereauLigneId: string;
  sections: MetreSection[];
  sousSections: MetreSousSection[];
  lignes: MetreLigne[];
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
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  inputMode?: 'decimal' | 'numeric';
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(() =>
    value == null ? '' : String(value).replace('.', ','),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value == null ? '' : String(value).replace('.', ','));
  }, [value, focused]);

  return (
    <input
      inputMode={inputMode}
      title={title}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(parseNum(e.target.value));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

const SECTION_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];

/**
 * Saisie d'un comptage d'éléments : entiers positifs uniquement (clavier
 * numérique sur mobile), brouillon texte pendant la frappe, valeurs vides ou
 * invalides ramenées à 1 — le moteur applique le même défaut, ce qui garantit
 * des résultats identiques pour les métrés enregistrés avant ce champ.
 */
function IntegerInput({
  value,
  onCommit,
  className,
  title,
}: {
  value: number | undefined;
  onCommit: (value: number) => void;
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(() =>
    value == null ? '' : String(value).replace('.', ','),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value == null ? '' : String(value).replace('.', ','));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      placeholder="1"
      title={title}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Vide / 0 / négatif / décimal → entier ≥ 1 (jamais de division par 0,
        // jamais de partiel négatif).
        onCommit(normaliseNombreElements(parseNum(raw)));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

/** Rappel affiché sous chaque table de ferraillage. */
const ACIER_LEGENDE =
  'Nombre = barres / pièces dans UN élément · Nombre d’éléments = éléments identiques répétés (8 poteaux, 6 poutres…) — vide = 1 · poids = Nombre × Nombre d’éléments × Longueur × poids du Ø.';

const NOMBRE_ELEMENTS_HINT =
  'Nombre d’éléments structurels identiques répétés pour cette mesure (ex. 8 poteaux, 6 poutres, 4 bassins). Vide = 1. « Nombre » reste le nombre de barres dans UN seul élément.';

const SOUS_SECTION_ELEMENTS_HINT =
  'Nombre d’éléments identiques de cet élément (multiplie ses mesures acier). Se cumule avec le « Nombre d’éléments » saisi sur chaque ligne.';

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
}: {
  projectId: string;
  periodeId: string;
  context: MetreContext;
  action: (formData: FormData) => Promise<void>;
}) {
  const bordereauLignes = context.bordereau?.lignes ?? [];
  const [entries, setEntries] = useState<Record<string, EntryState>>(() => {
    const initial: Record<string, EntryState> = {};
    for (const ligne of bordereauLignes) {
      const key = ligne.id ?? String(ligne.numero);
      const existing = context.metres.find((m) => m.bordereauLigneId === key);
      initial[key] = {
        bordereauLigneId: key,
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
  const [pending, startTransition] = useTransition();

  function mutate(key: string, mutator: (entry: EntryState) => EntryState) {
    setEntries((prev) => {
      const entry = prev[key];
      if (!entry) return prev;
      return { ...prev, [key]: mutator(entry) };
    });
  }

  const totals = useMemo(() => {
    const perLigne = new Map<string, number>();
    for (const [key, entry] of Object.entries(entries)) {
      const unite = bordereauLignes.find((l) => (l.id ?? String(l.numero)) === key)?.unite ?? 'U';
      const bySousSection = new Map(entry.sousSections.map((s) => [s.id, s]));
      const type = metreCalcType(unite);
      let total = 0;
      for (const ligne of entry.lignes) {
        // Le facteur « Nombre d’éléments » de la ligne est déjà compris dans le
        // partiel ci-dessous ; sur les lignes d’acier, le nombre d’éléments de
        // la sous-section (élément structurel) s’y multiplie ensuite — même
        // enchaînement que le moteur serveur.
        let partiel = computeLignePartielClient(unite, ligne);
        if (type === 'poids' && ligne.subSectionId) {
          const nombreElements = bySousSection.get(ligne.subSectionId)?.nombreElements;
          if (nombreElements && nombreElements > 0 && nombreElements !== 1) {
            partiel *= nombreElements;
          }
        }
        total += partiel;
      }
      perLigne.set(key, round2Client(total));
    }
    return perLigne;
  }, [entries, bordereauLignes]);

  function save() {
    const payload = Object.values(entries)
      .filter((entry) => entry.lignes.length > 0 || entry.sections.length > 0)
      .map((entry) => ({
        bordereauLigneId: entry.bordereauLigneId,
        sections: entry.sections,
        // nombreElements (ligne et sous-section) est transmis tel quel : le
        // schéma serveur l'accepte et le moteur applique son défaut (1).
        sousSections: entry.sousSections,
        lignes: entry.lignes,
      }));
    if (payload.length === 0) return;
    const formData = new FormData();
    formData.set('projectId', projectId);
    formData.set('periodeId', periodeId);
    formData.set('entries', JSON.stringify(payload));
    startTransition(() => action(formData));
  }

  const globalPartiel = [...totals.values()].reduce((sum, v) => sum + v, 0);

  return (
    <div className="space-y-4">
      {bordereauLignes.map((bordereauLigne) => {
        const key = bordereauLigne.id ?? String(bordereauLigne.numero);
        const entry = entries[key];
        if (!entry) return null;
        const type = metreCalcType(bordereauLigne.unite);
        const previous = context.previousByLigne[key] ?? [];
        const cumulPrecedent = round2Client(previous.reduce((sum, p) => sum + p.totalPartiel, 0));
        const partielActuel = totals.get(key) ?? 0;
        const cumul = round2Client(cumulPrecedent + partielActuel);
        const pct = bordereauLigne.quantite > 0 ? (cumul / bordereauLigne.quantite) * 100 : 0;
        const isOpen = open[key] ?? false;
        const unassigned = entry.lignes.filter((l) => !l.subSectionId);

        return (
          <section
            key={key}
            className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm"
          >
            {/* En-tête de l'article */}
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [key]: !isOpen }))}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-sand/40"
            >
              <span className="font-mono text-xs font-bold text-cyan">
                Prix n°{bordereauLigne.numero}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-2">
                {bordereauLigne.designation}
              </span>
              <span className="rounded-full bg-sand px-2 py-0.5 font-mono text-[10px] font-bold text-muted">
                {bordereauLigne.unite}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-faint">
                marché {fmtQ(bordereauLigne.quantite)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted">
                préc. {fmtQ(cumulPrecedent)}
              </span>
              <span className="font-mono text-[11px] font-bold tabular-nums text-cyan">
                période {fmtQ(partielActuel)}
              </span>
              <span
                className={`font-mono text-[11px] font-bold tabular-nums ${pct > 100 ? 'text-clay' : 'text-emerald'}`}
              >
                cumul {fmtQ(cumul)} ({pct.toFixed(1)}%)
              </span>
              <span className="text-faint">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-line px-4 py-3">
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
                      {sousSections.map((sousSection) => (
                        <SousSectionBlock
                          key={sousSection.id}
                          entryKey={key}
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

      {/* Barre d'action */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper-2/95 px-5 py-3 shadow-lg backdrop-blur">
        <p className="text-xs text-muted">
          Total partiel de la période{' '}
          <strong className="font-mono text-base font-black tabular-nums text-cyan">
            {fmtQ(round2Client(globalPartiel))}
          </strong>
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Génération du décompte…' : '⚡ Enregistrer tout → décompte auto'}
        </button>
      </div>
    </div>
  );
}

// ─── Sous-section (élément) ──────────────────────────────────────────────────

function SousSectionBlock({
  entryKey,
  unite,
  type,
  sousSection,
  lignes,
  mutate,
}: {
  entryKey: string;
  unite: string;
  type: ReturnType<typeof metreCalcType>;
  sousSection: MetreSousSection;
  lignes: MetreLigne[];
  mutate: (key: string, mutator: (entry: EntryState) => EntryState) => void;
}) {
  return (
    <div className="border-t border-line/60 px-3 pb-2 pt-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-faint">Élément</span>
        <input
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
  unite,
  type,
  lignes,
  sousSectionId,
  nombreElements,
  mutate,
  title,
}: {
  entryKey: string;
  unite: string;
  type: ReturnType<typeof metreCalcType>;
  lignes: MetreLigne[];
  sousSectionId: string | undefined;
  nombreElements: number | undefined;
  mutate: (key: string, mutator: (entry: EntryState) => EntryState) => void;
  title?: string;
}) {
  const columns = DIMENSION_COLUMNS[type];
  // Multiplicateur de la sous-section (l'élément entier) — métrique historique,
  // indépendante du « Nombre d’éléments » propre à chaque ligne de mesure.
  const sousSectionMult =
    type === 'poids' && nombreElements && nombreElements > 0 ? nombreElements : 1;
  // Une ligne acier répétée à la fois par sa sous-section et par sa colonne
  // « Nombre d’éléments » verrait ses kg comptés deux fois : on le signale.
  const ligneMult =
    type === 'poids'
      ? Math.max(1, ...lignes.map((l) => normaliseNombreElements(l.nombreElements)))
      : 1;
  const doubleCount = sousSectionMult > 1 && ligneMult > 1;
  return (
    <div className="mt-1.5">
      {title && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-faint">
          {title}
        </p>
      )}
      {doubleCount && (
        <p className="mb-1 rounded-md border border-ochre-soft bg-ochre-soft/20 px-2 py-1 text-[10px] font-medium text-ochre">
          ⚠ Répétition comptée deux fois : élément × {sousSectionMult} et « Nombre d’éléments »{' '}
          × {ligneMult} — les deux facteurs se multiplient.
        </p>
      )}
      {lignes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-faint">
              <tr>
                <th className="px-2 py-1.5">Désignation</th>
                {columns.map((col) => (
                  <th
                    key={String(col.field)}
                    className="w-24 px-2 py-1.5 text-right"
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
                <th className="w-24 px-2 py-1.5 text-right">Partiel</th>
                <th className="w-8 px-1 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {lignes.map((ligne) => {
                const ligneElements =
                  type === 'poids' ? normaliseNombreElements(ligne.nombreElements) : 1;
                const elementsTotal = ligneElements * sousSectionMult;
                const partiel = computeLignePartielClient(unite, ligne) * sousSectionMult;
                const showRepetition = type === 'poids' && elementsTotal > 1;
                return (
                  <tr key={ligne.id} className="group">
                    <td className="px-1 py-1">
                      <input
                        value={ligne.designation ?? ''}
                        onChange={(e) =>
                          mutate(entryKey, (entry) => ({
                            ...entry,
                            lignes: entry.lignes.map((l) =>
                              l.id === ligne.id ? { ...l, designation: e.target.value } : l,
                            ),
                          }))
                        }
                        placeholder="Mesure…"
                        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 outline-none focus:border-cyan focus:bg-paper"
                      />
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
                            className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-right font-mono outline-none focus:border-cyan focus:bg-paper"
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
                            title={NOMBRE_ELEMENTS_HINT}
                            onCommit={(v) =>
                              mutate(entryKey, (entry) => ({
                                ...entry,
                                lignes: entry.lignes.map((l) =>
                                  l.id === ligne.id ? { ...l, nombreElements: v } : l,
                                ),
                              }))
                            }
                            className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right font-mono tabular-nums outline-none focus:border-cyan focus:bg-paper"
                          />
                        ) : (
                          <DecimalInput
                            value={ligne[col.field] as number | undefined}
                            onCommit={(v) =>
                              mutate(entryKey, (entry) => ({
                                ...entry,
                                lignes: entry.lignes.map((l) =>
                                  l.id === ligne.id ? { ...l, [col.field]: v } : l,
                                ),
                              }))
                            }
                            className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right font-mono tabular-nums outline-none focus:border-cyan focus:bg-paper"
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
                      className="px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald"
                    >
                      {fmtQ(round2Client(partiel))}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          mutate(entryKey, (entry) => ({
                            ...entry,
                            lignes: entry.lignes.filter((l) => l.id !== ligne.id),
                          }))
                        }
                        className="text-faint opacity-0 transition hover:text-clay group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {type === 'poids' && lignes.length > 0 && (
        <p className="mt-1 text-[10px] leading-relaxed text-faint">{ACIER_LEGENDE}</p>
      )}
      <button
        type="button"
        onClick={() =>
          mutate(entryKey, (entry) => ({
            ...entry,
            lignes: [
              ...entry.lignes,
              {
                id: newId('mes'),
                subSectionId: sousSectionId,
                designation: '',
                // Lignes d'acier : « Nombre d’éléments » initialisé à 1 — la
                // répétition d'éléments identiques ne s'applique que si
                // l'utilisateur la saisit ; les autres unités gardent
                // l'historique (1 seul exemplaire).
                ...(type === 'poids'
                  ? { nombreElements: 1 }
                  : { nombreSemblables: 1 }),
              },
            ],
          }))
        }
        className="mt-1 rounded-md bg-sand px-2.5 py-1 text-[11px] font-bold text-ink-2 hover:bg-line"
      >
        + Mesure
      </button>
    </div>
  );
}
