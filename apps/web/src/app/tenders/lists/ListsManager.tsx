'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { TenderListRow } from './page';

export function ListsManager({ initial }: { initial: TenderListRow[] }) {
  const [lists, setLists] = useState<TenderListRow[]>(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createList(): Promise<void> {
    const safe = name.trim();
    if (!safe) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tender/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: safe }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail ? detail.slice(0, 200) : `HTTP ${res.status}`);
      }
      const list = (await res.json()) as TenderListRow;
      setLists((prev) => [list, ...prev]);
      setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeList(id: string): Promise<void> {
    if (!window.confirm('Supprimer cette liste ? Les appels d’offres ne seront pas supprimés.'))
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tender/lists/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail ? detail.slice(0, 200) : `HTTP ${res.status}`);
      }
      setLists((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight">Listes</h1>
          <p className="mt-1 text-sm text-muted">
            Organisez vos appels d&apos;offres en dossiers privés ou partagés.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createList();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom de la nouvelle liste…"
            disabled={busy}
            maxLength={120}
            className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/15 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-2 text-sm font-semibold text-paper transition hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="check" size={14} />
            Créer une liste
          </button>
        </form>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-ochre-deep/30 bg-ochre-soft/40 px-3 py-2 text-xs text-ochre-deep">
          {error}
        </p>
      )}

      {lists.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 p-12 text-center">
          <Icon name="boxes" size={32} className="mx-auto text-faint" />
          <p className="mt-3 text-sm text-muted">
            Aucune liste. Créez-en une pour regrouper vos opportunités.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <li
              key={list.id}
              className="rounded-xl border border-line bg-paper-2 p-4 shadow-card transition hover:border-cyan-soft"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <Icon name="boxes" size={20} className="text-cyan" />
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    list.visibility === 'shared'
                      ? 'bg-emerald-soft text-emerald'
                      : 'bg-sand text-muted'
                  }`}
                >
                  {list.visibility === 'shared' ? 'Partagée' : 'Privée'}
                </span>
              </div>
              <h3 className="truncate text-base font-semibold text-ink" title={list.name}>
                {list.name}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {list.memberCount} appel{list.memberCount !== 1 ? 's' : ''} d&apos;offres
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/tenders?list=${list.id}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand"
                >
                  <Icon name="external" size={12} />
                  Ouvrir
                </Link>
                <button
                  type="button"
                  onClick={() => removeList(list.id)}
                  disabled={busy}
                  title="Supprimer la liste"
                  className="rounded-md border border-line p-1.5 text-faint transition hover:bg-sand hover:text-ochre-deep disabled:opacity-50"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
