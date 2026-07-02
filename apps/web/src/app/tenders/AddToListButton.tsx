'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

interface TenderListRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  memberCount: number;
}

/**
 * "Ajouter à une liste" — datao-style dropdown that fetches the user's lists
 * on open, lets them pick one (or create a new one inline) and adds the current
 * tender. Optimistic + simple; the drawer's transient state is good enough.
 */
export function AddToListButton({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<TenderListRow[] | null>(null);
  const [creating, setCreating] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || lists !== null) return;
    void fetch('/api/tender/lists')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TenderListRow[]) => setLists(data ?? []))
      .catch(() => setLists([]));
  }, [open, lists]);

  async function addTo(listId: string, name: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tender/lists/${listId}/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(`Ajouté à « ${name} »`);
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd(): Promise<void> {
    const name = creating.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/tender/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as TenderListRow;
      setLists((prev) => (prev ? [list, ...prev] : [list]));
      setCreating('');
      await addTo(list.id, list.name);
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand"
      >
        <Icon name="boxes" size={13} />
        Ajouter à une liste
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-line bg-paper shadow-raised">
          <div className="max-h-56 overflow-y-auto p-2">
            {lists === null ? (
              <p className="px-3 py-2 text-xs text-faint">Chargement…</p>
            ) : lists.length === 0 ? (
              <p className="px-3 py-2 text-xs text-faint">Aucune liste — créez-en une.</p>
            ) : (
              <ul className="space-y-1">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => addTo(l.id, l.name)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition hover:bg-sand disabled:opacity-50"
                    >
                      <span className="truncate">{l.name}</span>
                      <span className="shrink-0 text-xs text-faint">
                        {l.memberCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createAndAdd();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={creating}
                onChange={(e) => setCreating(e.target.value)}
                placeholder="Nouvelle liste…"
                disabled={busy}
                className="flex-1 rounded-md border border-line-2 bg-paper-2 px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !creating.trim()}
                className="rounded-md bg-cyan px-2 py-1.5 text-xs font-semibold text-paper transition hover:bg-cyan/90 disabled:opacity-50"
              >
                Créer
              </button>
            </form>
            {msg && <p className="mt-2 text-[10px] text-muted">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
