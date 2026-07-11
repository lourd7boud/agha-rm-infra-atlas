'use client';

import { useEffect, useState } from 'react';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** localStorage namespace — bump the version suffix to invalidate old threads. */
const STORAGE_PREFIX = 'atlas.tenderChat.v1.';

/** Reads a persisted thread for a tender, tolerating absent/corrupt storage
 *  (private mode, quota, hand-edits) by degrading to an empty thread. */
function loadThread(tenderId: string): ChatMsg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + tenderId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMsg =>
        !!m &&
        typeof m === 'object' &&
        ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant') &&
        typeof (m as ChatMsg).content === 'string',
    );
  } catch {
    return [];
  }
}

/** Persists (or clears) a tender's thread. Non-fatal on any storage failure. */
function saveThread(tenderId: string, messages: ChatMsg[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(STORAGE_PREFIX + tenderId);
    } else {
      window.localStorage.setItem(STORAGE_PREFIX + tenderId, JSON.stringify(messages));
    }
  } catch {
    /* quota exceeded / storage disabled — the in-memory thread still works. */
  }
}

/**
 * Per-tender chat panel — datao's "agent IA va parcourir le dossier" surface.
 * The thread is PERSISTED in localStorage keyed by tender id, so closing the
 * drawer (or reloading the page) and coming back restores the conversation
 * instead of starting over. "Nouveau chat" clears it explicitly. Hits POST
 * /api/tenders/:id/chat/stream (SSE), grounded only in the tender's stored
 * context — never the web.
 */
export function TenderChat({ tenderId, reference }: { tenderId: string; reference: string }) {
  // Lazy init from storage so a reopened drawer paints the thread with no flash.
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadThread(tenderId));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching to a different tender in the same component instance: load that
  // tender's stored thread (and reset the transient UI state).
  useEffect(() => {
    setMessages(loadThread(tenderId));
    setInput('');
    setError(null);
  }, [tenderId]);

  function clearThread(): void {
    setMessages([]);
    setError(null);
    saveThread(tenderId, []);
  }

  async function send(): Promise<void> {
    const q = input.trim();
    if (!q || pending) return;
    setError(null);
    // Optimistic: append the user message + an empty assistant slot we'll grow
    // delta-by-delta as the SSE stream arrives (datao-grade token-by-token UX).
    const baseline: ChatMsg[] = [...messages, { role: 'user', content: q }];
    setMessages([...baseline, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          question: q,
          history: messages.slice(-12),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
      }
      if (!res.body) throw new Error('Réponse vide du serveur');

      // SSE parser: each frame is `data: <payload>\n\n`. Payload is either
      // [DONE] or a JSON event {type:'delta'|'finish'|'error', ...}.
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulated = '';
      let sawError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.startsWith('data:')) continue;
          const payload = frame.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const ev = JSON.parse(payload) as
              | { type: 'delta'; text: string }
              | { type: 'finish'; model: string; inputTokens: number; outputTokens: number }
              | { type: 'error'; errorText: string };
            if (ev.type === 'delta' && ev.text) {
              accumulated += ev.text;
              const grown = accumulated;
              setMessages([...baseline, { role: 'assistant', content: grown }]);
            } else if (ev.type === 'error') {
              sawError = ev.errorText || 'Erreur du flux';
            }
          } catch {
            // Ignore malformed frames — keep streaming.
          }
        }
      }
      if (sawError) throw new Error(sawError);
      if (!accumulated.trim()) throw new Error('Réponse vide');
      // Persist the completed exchange so it survives closing/reopening the drawer.
      const finalMessages: ChatMsg[] = [
        ...baseline,
        { role: 'assistant', content: accumulated },
      ];
      setMessages(finalMessages);
      saveThread(tenderId, finalMessages);
    } catch (e) {
      setError((e as Error).message);
      // Roll back the optimistic exchange so the user can edit/retry.
      setMessages(messages);
      setInput(q);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-2 rounded-lg bg-cyan-soft/50 px-3 py-2 text-xs text-muted">
          <span className="rounded bg-cyan px-1 py-0.5 text-[9px] font-bold text-paper">IA</span>
          Posez une question sur ce marché ({reference}) — l&apos;agent répond
          uniquement à partir des informations extraites du dossier (objet, lots,
          BPU, conditions, qualifications…). Ne pas utiliser pour des conseils
          juridiques.
        </p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearThread}
            disabled={pending}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            title="Effacer la conversation pour ce marché"
          >
            Nouveau chat
          </button>
        )}
      </div>
      {messages.length === 0 && (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-faint">
          Aucun message. Essayez : « Quelles sont les qualifications exigées ? »
        </p>
      )}
      <ul className="space-y-2">
        {messages.map((m, i) => (
          <li
            key={i}
            className={`rounded-lg p-3 text-sm ${
              m.role === 'user'
                ? 'border border-line bg-paper-2 text-ink'
                : 'bg-cyan-soft/30 text-ink-2'
            }`}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
              {m.role === 'user' ? 'Vous' : 'Assistant'}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
          </li>
        ))}
        {pending && (
          <li className="rounded-lg bg-cyan-soft/30 p-3 text-sm text-muted">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
              Assistant
            </p>
            <p className="italic">L&apos;agent lit le dossier…</p>
          </li>
        )}
      </ul>
      {error && (
        <p className="rounded-md border border-ochre-deep/30 bg-ochre-soft/40 px-3 py-2 text-xs text-ochre-deep">
          Erreur : {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Saisissez votre question…"
          rows={2}
          disabled={pending}
          className="flex-1 resize-none rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/15 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
