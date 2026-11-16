'use client';

import { useEffect, useRef, useState } from 'react';

const TOPICS = {
  visit: 'Visite', qualifications: 'Qualifications', guarantee: 'Caution', submission: 'Dépôt',
  required_documents: 'Pièces à fournir', execution: 'Exécution',
};

interface Excerpt {
  topic: keyof typeof TOPICS;
  filename: string;
  sha256: string;
  page: number;
  quote: string;
  layout?: 'table';
}

export function DceDecisionExcerpts({ tenderId }: { tenderId: string }) {
  const [excerpts, setExcerpts] = useState<Excerpt[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const base = `/api/tenders/${encodeURIComponent(tenderId)}`;

  async function read() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setExcerpts(null);
    setError('');
    try {
      const response = await fetch(`${base}/dossier/decision-excerpts`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'Obtenez d’abord le DCE dans le visualiseur.' : 'La lecture du DCE est momentanément indisponible.');
      const result = await response.json() as { excerpts: Excerpt[] };
      if (!controller.signal.aborted) setExcerpts(result.excerpts);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Extraits indisponibles.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <div aria-label="Extraits du DCE" className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
    <button type="button" onClick={read} disabled={pending} className="rounded-lg border border-line bg-paper px-3 py-1.5 font-semibold text-ink disabled:opacity-50">
      {pending ? 'Lecture des extraits…' : 'Voir les points clés du DCE'}
    </button>
    {error && <p role="alert" className="text-clay">{error}</p>}
    {excerpts?.length === 0 && <p role="status" className="text-muted">Aucun extrait repéré dans les textes disponibles. Consultez les pièces du DCE, ou lancez leur OCR si nécessaire.</p>}
    {!!excerpts?.length && <p className="text-muted">Extraits OCR de la copie conservée. Ouvrez la page pour vérifier la formulation.</p>}
    {!!excerpts?.length && <ul className="space-y-2" aria-label="Points clés du DCE">
      {excerpts.map(excerpt => <li key={excerpt.topic} className="rounded-lg border border-line p-2">
        <p className="font-semibold text-ink">{TOPICS[excerpt.topic]}</p>
        <p className="my-1 text-ink-2">{excerpt.layout === 'table'
          ? 'Tableau des qualifications. Consultez la page source pour lire les codes et les classes.'
          : excerpt.quote}</p>
        <a href={`${base}/files/raw?${new URLSearchParams({ name: excerpt.filename, sha256: excerpt.sha256 })}#page=${excerpt.page}`} target="_blank" rel="noopener noreferrer" className="break-all text-cyan underline">
          {excerpt.filename.split('/').pop()} · page {excerpt.page}
        </a>
      </li>)}
    </ul>}
  </div>;
}
