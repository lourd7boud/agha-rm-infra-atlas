'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/tenders';

export interface DceOcrEvidence {
  filename: string;
  sha256: string;
  checkedAt: string;
  state: 'text' | 'mixed' | 'failed';
  coverage: 'none' | 'partial' | 'complete';
  totalPages: number | null;
  pagesProcessed: number;
  pages: Array<{
    num: number;
    state: 'text' | 'no_text' | 'not_processed';
    characterCount: number;
    snippet: string;
    textTruncated: boolean;
  }>;
}

export interface DceFileEvidence {
  filename: string;
  sha256: string;
  checkedAt: string;
  sizeBytes: number;
  state: 'digital_text' | 'mixed' | 'needs_ocr' | 'unsupported' | 'failed';
  coverage: 'none' | 'partial' | 'complete';
  totalPages: number | null;
  pagesInspected: number;
  pages: Array<{ num: number; characterCount: number; snippet: string; textTruncated: boolean }>;
  ocr?: DceOcrEvidence;
}

const LABELS: Record<DceFileEvidence['state'], string> = {
  digital_text: 'Texte détecté dans les pages examinées',
  mixed: 'Lecture partielle : certaines pages nécessitent un OCR',
  needs_ocr: 'Texte insuffisant : lecture OCR nécessaire',
  unsupported: 'Format non pris en charge par ce contrôle',
  failed: 'Lecture du fichier impossible',
};

export function DceFileCheckResult({ evidence }: { evidence: DceFileEvidence }) {
  return (
    <div className="text-xs text-ink-2" role="status">
      <p className="font-semibold">{LABELS[evidence.state]}</p>
      {evidence.totalPages !== null && (
        <p>{evidence.pagesInspected}/{evidence.totalPages} pages examinées · {evidence.coverage === 'complete' ? 'Toutes les pages' : 'Échantillon des premières pages'}</p>
      )}
      <p>Ce contrôle de lecture ne valide ni les conditions du marché ni la version officielle actuelle.</p>
      <details className="mt-1">
        <summary className="cursor-pointer">Détails du contrôle</summary>
        <div className="max-h-40 space-y-1 overflow-auto py-2">
          <p className="break-all">{evidence.filename} · {evidence.sizeBytes} octets</p>
          <p>Contrôlé le {fmtDateTime(evidence.checkedAt)}</p>
          <p className="break-all">SHA-256 : {evidence.sha256}</p>
          {evidence.pages.map((page) => (
            <p key={page.num}>Page {page.num} · {page.characterCount} caractères{page.textTruncated ? ' (texte limité)' : ''} : {page.snippet || 'Aucun texte détecté'}</p>
          ))}
        </div>
      </details>
    </div>
  );
}

export function DceOcrResult({ evidence, sourceFileUrl }: { evidence: DceOcrEvidence; sourceFileUrl?: string }) {
  const label = evidence.state === 'failed'
    ? 'Lecture OCR non aboutie'
    : evidence.state === 'mixed' ? 'Lecture partielle par OCR local' : 'Texte obtenu par OCR local';
  return (
    <div className="mt-2 border-t border-line pt-2 text-xs text-ink-2" role="status" aria-label="Résultat OCR local">
      <p className="font-semibold">{label}</p>
      <p>{evidence.totalPages === null
        ? 'Nombre de pages non déterminé'
        : `${evidence.pagesProcessed}/${evidence.totalPages} pages traitées · ${evidence.coverage === 'complete' ? 'Toutes les pages traitées' : 'Traitement incomplet'}`}</p>
      <p>Ce texte automatique ne valide ni les conditions du marché ni la version officielle actuelle.</p>
      {evidence.state === 'failed' && <p>Réessayez la lecture ou consultez le PDF source.</p>}
      <details className="mt-1">
        <summary className="cursor-pointer">Pages et extraits OCR</summary>
        <div className="max-h-40 space-y-1 overflow-auto py-2">
          <p className="break-all">{evidence.filename} · traité le {fmtDateTime(evidence.checkedAt)}</p>
          <p className="break-all">SHA-256 du PDF source : {evidence.sha256}</p>
          {evidence.pages.map(page => (
            <p key={page.num}>
              {sourceFileUrl ? <a href={`${sourceFileUrl}#page=${page.num}`} target="_blank" rel="noopener noreferrer" className="underline">Page {page.num}</a> : <>Page {page.num}</>} · {page.state === 'text'
                ? `${page.characterCount} caractères${page.textTruncated ? ' (texte limité)' : ''}`
                : page.state === 'no_text' ? 'Sans texte exploitable après OCR' : 'Non traitée'}
              {page.snippet ? ` : ${page.snippet}` : ''}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

/** Mounted with the file identity as key so evidence never follows another file. */
export function DceFileCheck({ tenderId, name }: { tenderId: string; name: string }) {
  const [evidence, setEvidence] = useState<DceFileEvidence | null>(null);
  const [ocr, setOcr] = useState<DceOcrEvidence | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'ocr' | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function inspect() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('inspect');
    setError('');
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/files/evidence?name=${encodeURIComponent(name)}`, {
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Archive conservée introuvable. Rechargez le dossier.' : 'Contrôle indisponible. Réessayez dans un instant.');
      const result = await response.json() as DceFileEvidence;
      if (controller.signal.aborted) return;
      setEvidence(result);
      setOcr(result.ocr?.sha256 === result.sha256 && result.ocr.filename === result.filename ? result.ocr : null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Contrôle indisponible.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function runOcr() {
    if (request.current || !evidence) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('ocr');
    setError('');
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/files/ocr?name=${encodeURIComponent(name)}`, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 404
        ? 'Archive conservée introuvable. Rechargez le dossier.'
        : response.status === 429 ? 'Lecture OCR déjà demandée. Réessayez dans un instant.'
          : 'Lecture OCR indisponible. Réessayez ou consultez le PDF source.');
      const result = await response.json() as DceOcrEvidence;
      if (controller.signal.aborted) return;
      if (result.sha256 !== evidence.sha256 || result.filename !== evidence.filename) {
        setEvidence(null);
        setOcr(null);
        throw new Error('Le fichier conservé a changé. Vérifiez à nouveau la lecture.');
      }
      setOcr(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Lecture OCR indisponible.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  const canRunOcr = evidence && ['needs_ocr', 'mixed', 'failed'].includes(evidence.state) && (!ocr || ocr.state === 'failed');
  return (
    <div className="shrink-0 border-b border-line bg-sand/40 px-4 py-2" aria-label="Contrôle de lecture Samir">
      {evidence ? (
        <>
          <DceFileCheckResult evidence={evidence} />
          {ocr && <DceOcrResult evidence={ocr} sourceFileUrl={`/api/tenders/${encodeURIComponent(tenderId)}/files/raw?${new URLSearchParams({ name, sha256: ocr.sha256 })}`} />}
          {canRunOcr && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button type="button" onClick={runOcr} disabled={busy !== null} className="rounded-lg border border-line bg-paper px-3 py-1.5 font-semibold text-ink disabled:opacity-50">
                {busy === 'ocr' ? 'Lecture OCR en cours…' : ocr?.state === 'failed' ? 'Réessayer l’OCR local' : 'Lire le PDF avec OCR local'}
              </button>
              <span className="text-muted">Jusqu’à 60 pages · peut prendre quelques minutes</span>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={inspect} disabled={busy !== null} className="rounded-lg border border-line bg-paper px-3 py-1.5 font-semibold text-ink disabled:opacity-50">
            {busy === 'inspect' ? 'Vérification…' : 'Vérifier la lecture'}
          </button>
          <span className="text-muted">Samir · Jusqu’à 5 premières pages du PDF conservé</span>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-rose">{error}</p>}
    </div>
  );
}
