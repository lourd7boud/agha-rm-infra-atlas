'use client';

import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * datao's "Voir le fichier source": split overlay that renders the selected DCE
 * document INLINE in its native shape — PDF/images served same-origin
 * (/files/raw), Office files (Word/Excel incl. legacy .doc/.xls) rendered
 * pixel-faithfully by the Microsoft Office Online viewer
 * (view.officeapps.live.com), exactly like datao.
 *
 * Two display modes:
 *   modal — full-screen overlay with the complete DCE file list (used by the
 *           tender header button to browse the whole dossier).
 *   side  — 640px panel docked immediately to the LEFT of the 640px tender
 *           drawer, so BPU stays visible at right and the bordereau opens
 *           alongside. Matches datao 1:1 when bordereauOnly is set: only the
 *           BPU's source file is listed + auto-selected.
 */

type FileKind = 'pdf' | 'excel' | 'word' | 'image' | 'other';

interface DceFile {
  name: string;
  label: string;
  kind: FileKind;
  sizeBytes: number;
}

interface Props {
  tenderId: string;
  onClose: () => void;
  mode?: 'modal' | 'side';
  bordereauOnly?: boolean;
}

const KIND_ICON: Record<FileKind, IconName> = {
  pdf: 'documents',
  excel: 'invoice',
  word: 'documents',
  image: 'documents',
  other: 'documents',
};

const BORDEREAU_NAME_RE = /bordereau|bpu|estimatif|bpde|d[ée]tail/i;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function pickBordereau(files: ReadonlyArray<DceFile>): DceFile | null {
  const byName = files.find((f) => BORDEREAU_NAME_RE.test(f.name));
  if (byName) return byName;
  return files.find((f) => f.kind === 'excel') ?? files[0] ?? null;
}

export function SourceFileViewer({
  tenderId,
  onClose,
  mode = 'modal',
  bordereauOnly = false,
}: Props) {
  const [files, setFiles] = useState<DceFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<DceFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/files`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { files: DceFile[] };
        if (cancelled) return;
        const visible = bordereauOnly
          ? data.files.filter(
              (f) => BORDEREAU_NAME_RE.test(f.name) || f.kind === 'excel',
            )
          : data.files;
        setFiles(visible);
        setActive(bordereauOnly ? pickBordereau(visible) : visible[0] ?? null);
      } catch (e) {
        if (!cancelled) setListError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenderId, bordereauOnly]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // datao-style side panel: 640px column docked to the left of the tender
  // drawer (which is already pinned right with max-w-[640px]). No backdrop —
  // the drawer stays interactive and BPU stays visible at right.
  if (mode === 'side') {
    return (
      <div
        className="fixed inset-y-0 right-[640px] z-[59] flex w-full max-w-[640px] flex-col border-r border-line bg-paper shadow-raised"
        role="dialog"
        aria-modal="false"
        aria-label="Fichier source du bordereau"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink">
            {active?.label ?? (listError ? 'Indisponible' : 'Chargement…')}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {active && (
              <a
                href={`/api/tenders/${tenderId}/files/raw?name=${encodeURIComponent(active.name)}`}
                download={active.label}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-sand"
              >
                <Icon name="download" size={14} /> Télécharger
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-muted hover:bg-sand hover:text-ink"
              aria-label="Fermer"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {listError ? (
            <p className="p-4 text-sm text-rose">
              Dossier indisponible — réessayer dans un instant. ({listError})
            </p>
          ) : !files ? (
            <p className="p-4 text-sm text-muted">Chargement des fichiers…</p>
          ) : files.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              Bordereau non trouvé dans le dossier de consultation.
            </p>
          ) : active ? (
            <FileRender tenderId={tenderId} file={active} />
          ) : null}
        </div>
      </div>
    );
  }

  // modal (legacy): full file browser with sidebar.
  return (
    <div
      className="fixed inset-0 z-[60] flex bg-ink/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Fichiers du dossier"
    >
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-ink">Fichiers du dossier</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-sand hover:text-ink"
            aria-label="Fermer"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {listError && (
            <p className="px-2 py-3 text-sm text-rose">
              Dossier indisponible — réessayer dans un instant. ({listError})
            </p>
          )}
          {!files && !listError && (
            <p className="px-2 py-3 text-sm text-muted">Chargement des fichiers…</p>
          )}
          {files?.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">Aucun fichier exploitable.</p>
          )}
          <ul className="space-y-1">
            {files?.map((f) => (
              <li key={f.name}>
                <button
                  onClick={() => setActive(f)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${
                    active?.name === f.name
                      ? 'bg-cyan/15 text-ink ring-1 ring-cyan/40'
                      : 'text-ink-2 hover:bg-sand'
                  }`}
                >
                  <span className="mt-0.5 text-muted">
                    <Icon name={KIND_ICON[f.kind]} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium leading-tight">{f.label}</span>
                    <span className="text-xs text-faint">
                      {f.kind.toUpperCase()} · {fmtSize(f.sizeBytes)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-paper">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink">{active?.label ?? '—'}</p>
          {active && (
            <a
              href={`/api/tenders/${tenderId}/files/raw?name=${encodeURIComponent(active.name)}`}
              download={active.label}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-sand"
            >
              <Icon name="download" size={14} /> Télécharger
            </a>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {active ? (
            <FileRender tenderId={tenderId} file={active} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Sélectionnez un fichier à gauche.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FileRender({ tenderId, file }: { tenderId: string; file: DceFile }) {
  const rawUrl = `/api/tenders/${tenderId}/files/raw?name=${encodeURIComponent(file.name)}`;

  if (file.kind === 'pdf') {
    return <iframe src={rawUrl} title={file.label} className="h-full w-full border-0" />;
  }
  if (file.kind === 'image') {
    return (
      <div className="flex justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={rawUrl} alt={file.label} className="max-w-full" />
      </div>
    );
  }
  if (file.kind === 'excel' || file.kind === 'word') {
    return <OfficeRender tenderId={tenderId} file={file} downloadUrl={rawUrl} />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
      <p>Aperçu non disponible pour ce format.</p>
      <a
        href={rawUrl}
        download={file.label}
        className="inline-flex items-center gap-1 rounded-lg bg-cyan px-3 py-2 font-semibold text-paper"
      >
        <Icon name="download" size={14} /> Télécharger le fichier
      </a>
    </div>
  );
}

/** Word/Excel via the Microsoft Office Online viewer (datao's approach): we mint
 *  a short-lived public URL for the file and let Microsoft render it faithfully. */
function OfficeRender({
  tenderId,
  file,
  downloadUrl,
}: {
  tenderId: string;
  file: DceFile;
  downloadUrl: string;
}) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEmbedUrl(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/tenders/${tenderId}/files/office-embed?name=${encodeURIComponent(file.name)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { embedUrl: string };
        if (!cancelled) setEmbedUrl(data.embedUrl);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenderId, file.name]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>Aperçu indisponible ({error}).</p>
        <a
          href={downloadUrl}
          download={file.label}
          className="inline-flex items-center gap-1 rounded-lg bg-cyan px-3 py-2 font-semibold text-paper"
        >
          <Icon name="download" size={14} /> Télécharger le fichier
        </a>
      </div>
    );
  }
  if (!embedUrl) {
    return <div className="p-4 text-sm text-muted">Préparation de l’aperçu…</div>;
  }
  return <iframe src={embedUrl} title={file.label} className="h-full w-full border-0" />;
}
