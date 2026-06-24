'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

interface TopRef {
  id: string;
  reference: string;
  buyerName: string;
  objet: string;
}

interface AssistantReply {
  filters: Record<string, unknown>;
  answer: string;
  matchedCount: number;
  topRefs: TopRef[];
  model: string;
}

interface Turn {
  q: string;
  reply?: AssistantReply;
  error?: string;
}

const EXAMPLES = [
  "Travaux d'électricité à Agadir de plus de 500K DH",
  'Marchés de fournitures bureautiques en cours à Casablanca',
  'Études et assistance technique dans le secteur eau',
  'Marchés ouverts à Marrakech pour des PME',
];

/** Render `[REF]` tokens as inline links into /tenders?q=REF — opens the
 *  catalogue pre-searched on that reference, which surfaces the row in one click. */
function renderAnswer(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]\n]{3,80})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const ref = m[1]!;
    parts.push(
      <Link
        key={`r${i++}`}
        href={`/tenders?q=${encodeURIComponent(ref)}`}
        className="rounded bg-cyan-soft px-1 font-mono text-xs font-semibold text-cyan hover:underline"
      >
        {ref}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function AssistantPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);

  async function ask(text: string): Promise<void> {
    const q = text.trim();
    if (!q || pending) return;
    setInput('');
    setPending(true);
    setTurns((prev) => [...prev, { q }]);
    try {
      const res = await fetch('/api/tender/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail ? detail.slice(0, 200) : `HTTP ${res.status}`);
      }
      const reply = (await res.json()) as AssistantReply;
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { q, reply };
        return next;
      });
    } catch (e) {
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { q, error: (e as Error).message };
        return next;
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-[2rem] font-semibold tracking-tight">
          Assistant IA
        </h1>
        <p className="mt-1 text-sm text-muted">
          Décrivez votre besoin en langage naturel. L&apos;assistant choisit les
          filtres adaptés et résume les marchés correspondants — uniquement à
          partir du catalogue ATLAS, jamais d&apos;informations inventées.
        </p>
      </div>

      {turns.length === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-line bg-paper-2 p-6">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-faint">
            Exemples
          </p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => void ask(ex)}
                  disabled={pending}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-ink-2 transition hover:bg-cyan-soft hover:text-cyan disabled:opacity-50"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-6">
        {turns.map((t, i) => (
          <li key={i} className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-full bg-cyan-soft px-2 py-0.5 text-[10px] font-bold text-cyan">
                Vous
              </span>
              <p className="flex-1 text-sm font-medium text-ink">{t.q}</p>
            </div>
            {t.error && (
              <div className="rounded-lg border border-ochre-deep/30 bg-ochre-soft/40 px-3 py-2 text-xs text-ochre-deep">
                Erreur : {t.error}
              </div>
            )}
            {t.reply && (
              <div className="space-y-3 rounded-xl border border-line bg-paper-2 p-4">
                <p className="text-sm leading-relaxed text-ink-2">
                  {renderAnswer(t.reply.answer)}
                </p>
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
                  <span className="rounded-full bg-emerald-soft px-2 py-0.5 font-semibold text-emerald">
                    {t.reply.matchedCount} résultat{t.reply.matchedCount > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams();
                      const f = t.reply!.filters;
                      if (typeof f['q'] === 'string') params.set('q', f['q']);
                      if (typeof f['region'] === 'string')
                        params.set('region', f['region'] as string);
                      if (typeof f['procedure'] === 'string')
                        params.set('procedure', f['procedure'] as string);
                      if (typeof f['buyer'] === 'string')
                        params.set('buyer', f['buyer'] as string);
                      window.location.href = `/tenders?${params.toString()}`;
                    }}
                    className="rounded-md border border-line bg-paper px-2.5 py-1 font-semibold text-ink transition hover:bg-sand"
                  >
                    Ouvrir dans l&apos;inventaire
                  </button>
                  <span className="text-faint">·</span>
                  <span className="font-mono text-[10px] text-faint">{t.reply.model}</span>
                </div>
                {t.reply.topRefs.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-cyan hover:underline">
                      Aperçu de {t.reply.topRefs.length} marché
                      {t.reply.topRefs.length > 1 ? 's' : ''}
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {t.reply.topRefs.map((r) => (
                        <li
                          key={r.id}
                          className="rounded-md border border-line bg-paper px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold text-ink" title={r.buyerName}>
                              {r.buyerName}
                            </span>
                            <span className="shrink-0 rounded bg-sand px-1.5 py-0.5 font-mono text-[10px] text-faint">
                              {r.reference}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-muted" title={r.objet}>
                            {r.objet}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </li>
        ))}
        {pending && (
          <li className="flex items-center gap-2 text-sm text-muted">
            <Icon name="search" size={15} />
            <span className="italic">L&apos;assistant cherche dans le catalogue…</span>
          </li>
        )}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="sticky bottom-4 mt-8 flex items-end gap-2 rounded-xl border border-line bg-paper-2 p-2 shadow-raised"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          placeholder="Décrivez votre besoin…"
          rows={2}
          maxLength={500}
          disabled={pending}
          className="flex-1 resize-none rounded-lg bg-paper px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Demander
        </button>
      </form>
    </div>
  );
}
