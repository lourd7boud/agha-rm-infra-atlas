'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BuyerAvatar } from '@/components/ui/BuyerAvatar';
import { Icon } from '@/components/ui/Icon';
import { PIPELINE_LABELS, PROCEDURE_TONES, urgencyClasses } from '@/lib/labels';
import { CATEGORY_TONES, fmtDateShort, type TenderItem } from '@/lib/tenders';
import { fmtMad } from '@/lib/projects';

export type SortKey =
  | 'deadline'
  | 'publication'
  | 'budget'
  | 'caution'
  | 'buyer'
  | 'objet'
  | 'category'
  | 'secteur'
  | 'region'
  | 'ville'
  | 'lots';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

interface Column {
  key: string;
  label: string;
  sortKey: SortKey | null;
  width: number;
  align?: 'right';
}

const COLUMNS: readonly Column[] = [
  { key: 'buyer', label: 'Acheteur', sortKey: 'buyer', width: 230 },
  { key: 'objet', label: 'Titre', sortKey: 'objet', width: 340 },
  { key: 'publication', label: 'Date de publication', sortKey: 'publication', width: 150 },
  { key: 'deadline', label: 'Date limite', sortKey: 'deadline', width: 140 },
  { key: 'category', label: 'Catégorie', sortKey: 'category', width: 120 },
  { key: 'secteur', label: 'Secteur', sortKey: 'secteur', width: 180 },
  { key: 'region', label: 'Région', sortKey: 'region', width: 170 },
  { key: 'ville', label: "Lieu d'exécution", sortKey: 'ville', width: 160 },
  { key: 'lots', label: 'Lots', sortKey: 'lots', width: 80, align: 'right' },
  { key: 'budget', label: 'Budget', sortKey: 'budget', width: 140, align: 'right' },
  { key: 'caution', label: 'Caution prov.', sortKey: 'caution', width: 140, align: 'right' },
  { key: 'procedure', label: 'Procédure', sortKey: null, width: 160 },
  { key: 'state', label: 'État', sortKey: null, width: 130 },
];

const STORAGE_KEY = 'atlas.tenders.colwidths.v1';
const MIN_WIDTH = 70;

/** Incremental render window: only this many rows hit the DOM initially, then
 *  more load as you scroll (IntersectionObserver). Renders ~60 rows instead of
 *  4000+, which is what made entering /tenders laggy. CSV export + counts still
 *  operate on the full filtered array (the parent's `visible`), not this slice. */
const INITIAL_RENDER = 60;
const RENDER_STEP = 60;

function loadWidths(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

interface DataTableProps {
  items: readonly TenderItem[];
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (item: TenderItem) => void;
  /** Predicate from the parent's localStorage-backed read-tracking. */
  isSeen?: (id: string) => boolean;
}

export function DataTable({
  items,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  isSeen,
}: DataTableProps) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);

  // Incremental render window — caps DOM rows. Resets to the top whenever the
  // data set meaningfully changes (filter/sort/list), keyed on a cheap
  // signature rather than the array identity so a no-op recompute (e.g. marking
  // a row seen) doesn't yank the user back to the top.
  const [renderCount, setRenderCount] = useState(INITIAL_RENDER);
  const resetKey = `${items.length}:${items[0]?.id ?? ''}:${sort.key}:${sort.dir}`;
  useEffect(() => {
    setRenderCount(INITIAL_RENDER);
  }, [resetKey]);

  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const hasMore = renderCount < items.length;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderCount((c) => Math.min(items.length, c + RENDER_STEP));
        }
      },
      // Load the next page well before the sentinel is actually on screen so
      // scrolling feels continuous (no visible "pop").
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, hasMore]);

  const rendered = items.slice(0, renderCount);

  // Hydrate persisted widths after mount (localStorage is client-only).
  useEffect(() => {
    setWidths(loadWidths());
  }, []);

  const widthOf = (col: Column) => widths[col.key] ?? col.width;

  // Mirror widths in a ref so the drag handlers can snapshot the start width
  // without depending on `widths` — keeping onResizeMove/onResizeEnd/startResize
  // stable so the window listeners register and unregister symmetrically.
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const onResizeMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = Math.max(MIN_WIDTH, d.startW + (e.clientX - d.startX));
    setWidths((prev) => ({ ...prev, [d.key]: next }));
  }, []);

  const onResizeEnd = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeEnd);
    document.body.style.cursor = '';
    setWidths((prev) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
      } catch {
        /* ignore quota / privacy-mode failures */
      }
      return prev;
    });
  }, [onResizeMove]);

  const startResize = useCallback(
    (col: Column, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drag.current = {
        key: col.key,
        startX: e.clientX,
        startW: widthsRef.current[col.key] ?? col.width,
      };
      window.addEventListener('pointermove', onResizeMove);
      window.addEventListener('pointerup', onResizeEnd);
      document.body.style.cursor = 'col-resize';
    },
    [onResizeMove, onResizeEnd],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onResizeMove);
      window.removeEventListener('pointerup', onResizeEnd);
      document.body.style.cursor = '';
    },
    [onResizeMove, onResizeEnd],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          {COLUMNS.map((col) => (
            <col key={col.key} style={{ width: `${widthOf(col)}px` }} />
          ))}
        </colgroup>
        <thead className="border-b border-line bg-sand/60 text-xs uppercase tracking-wider text-muted">
          <tr>
            {COLUMNS.map((col) => {
              const active = col.sortKey && sort.key === col.sortKey;
              return (
                <th
                  key={col.key}
                  className="relative select-none px-3 py-3 font-semibold"
                >
                  <button
                    type="button"
                    disabled={!col.sortKey}
                    onClick={() => col.sortKey && onSortChange(col.sortKey)}
                    className={`flex w-full items-center gap-1 ${
                      col.align === 'right' ? 'justify-end' : 'justify-start'
                    } ${col.sortKey ? 'cursor-pointer hover:text-ink' : 'cursor-default'}`}
                    title={col.sortKey ? 'Trier' : undefined}
                  >
                    <span className="truncate">{col.label}</span>
                    {active && (
                      <span aria-hidden className="text-cyan">
                        {sort.dir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(e) => startResize(col, e)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-cyan/40"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rendered.map((item) => {
            const state =
              PIPELINE_LABELS[item.pipelineState] ?? {
                label: item.pipelineState,
                classes: 'bg-sand text-muted',
              };
            const overdue = item.daysLeft < 0;
            const selected = item.id === selectedId;
            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item)}
                className={`cursor-pointer align-top transition ${
                  selected ? 'bg-cyan-soft/40' : 'hover:bg-sand/50'
                }`}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <BuyerAvatar name={item.buyerName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isSeen && !isSeen(item.id) && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan"
                            title="Nouveau (jamais ouvert)"
                            aria-label="Nouveau"
                          />
                        )}
                        <div
                          className="truncate font-medium text-ink"
                          title={item.buyerName}
                        >
                          {item.buyerName}
                        </div>
                      </div>
                      <div className="truncate font-mono text-xs text-faint">
                        {item.reference}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <div className="line-clamp-2" title={item.objet}>
                    {item.objet}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted">
                  {fmtDateShort(item.publishedAt)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-mono text-xs tabular-nums text-ink">
                    {fmtDateShort(item.deadlineAt)}
                  </div>
                  <span
                    className={`mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      overdue ? 'bg-sand text-faint' : urgencyClasses(item.daysLeft)
                    }`}
                  >
                    {overdue ? 'Échu' : `J-${item.daysLeft}`}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_TONES[item.category]}`}
                  >
                    {item.category}
                  </span>
                </td>
                <td className="truncate px-3 py-2.5 text-muted" title={item.secteur}>
                  {item.secteur}
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <span className="flex items-center gap-1 truncate" title={item.region}>
                    <Icon name="pin" size={11} className="shrink-0 text-faint" />
                    {item.region}
                  </span>
                </td>
                <td
                  className="truncate px-3 py-2.5 text-muted"
                  title={item.location ?? item.ville ?? undefined}
                >
                  {item.location ?? item.ville ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                  {item.lotCount}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
                  {item.estimationMad != null ? fmtMad(item.estimationMad) : '—'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                  {item.cautionProvisoireMad != null
                    ? fmtMad(item.cautionProvisoireMad)
                    : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PROCEDURE_TONES[item.procedure]}`}
                  >
                    {item.procedureLabel}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${state.classes}`}
                  >
                    {state.label}
                  </span>
                </td>
              </tr>
            );
          })}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td
                colSpan={COLUMNS.length}
                className="px-3 py-4 text-center text-xs text-faint"
              >
                Chargement de {Math.min(RENDER_STEP, items.length - renderCount)}{' '}
                marché(s) supplémentaires… ({renderCount}/{items.length})
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
