'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { SavedSearchRow } from './page';

/** Best-effort French summary of a saved filter set — shows the chip-equivalent. */
function summarize(filters: unknown): string {
  if (!filters || typeof filters !== 'object') return 'Aucun critère';
  const f = filters as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof f.search === 'string' && f.search.trim()) bits.push(`« ${f.search.trim()} »`);
  if (typeof f.statut === 'string' && f.statut !== 'tous') bits.push(String(f.statut));
  for (const key of ['procedures', 'categories', 'regions', 'secteurs', 'buyers'] as const) {
    const list = f[key];
    if (Array.isArray(list) && list.length > 0) {
      bits.push(`${list.length} ${key}`);
    }
  }
  if (f.budgetOnly) bits.push('budget');
  if (f.cautionOnly) bits.push('caution');
  if (f.bpuOnly) bits.push('BPU');
  return bits.length ? bits.join(' · ') : 'Aucun critère';
}

export function SearchesManager({ initial }: { initial: SavedSearchRow[] }) {
  const [searches, setSearches] = useState<SavedSearchRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeSearch(id: string): Promise<void> {
    if (!window.confirm('Supprimer cette recherche sauvegardée ?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tender/saved-searches/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail ? detail.slice(0, 200) : `HTTP ${res.status}`);
      }
      setSearches((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-[2rem] font-semibold tracking-tight">
          Recherches sauvegardées
        </h1>
        <p className="mt-1 text-sm text-muted">
          Rejouez vos jeux de filtres préférés en un clic. Sauvegardez une recherche
          depuis l&apos;inventaire avec le bouton « Sauvegarder ».
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-ochre-deep/30 bg-ochre-soft/40 px-3 py-2 text-xs text-ochre-deep">
          {error}
        </p>
      )}

      {searches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 p-12 text-center">
          <Icon name="search" size={32} className="mx-auto text-faint" />
          <p className="mt-3 text-sm text-muted">
            Aucune recherche sauvegardée. Ouvrez{' '}
            <Link href="/tenders" className="text-cyan hover:underline">
              l&apos;inventaire
            </Link>
            , appliquez vos filtres, puis cliquez sur « Sauvegarder ».
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {searches.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-paper-2 p-4 shadow-card transition hover:border-cyan-soft"
            >
              <Icon name="search" size={20} className="shrink-0 text-cyan" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink" title={s.name}>
                  {s.name}
                </p>
                <p className="truncate text-xs text-muted" title={summarize(s.filters)}>
                  {summarize(s.filters)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  s.visibility === 'shared'
                    ? 'bg-emerald-soft text-emerald'
                    : 'bg-sand text-muted'
                }`}
              >
                {s.visibility === 'shared' ? 'Partagée' : 'Privée'}
              </span>
              <Link
                href={`/tenders?savedSearch=${s.id}`}
                className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand"
              >
                <Icon name="external" size={12} />
                Ouvrir
              </Link>
              <button
                type="button"
                onClick={() => removeSearch(s.id)}
                disabled={busy}
                title="Supprimer la recherche"
                className="rounded-md border border-line p-1.5 text-faint transition hover:bg-sand hover:text-ochre-deep disabled:opacity-50"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
