'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * datao's "Voir le fichier source": a split overlay listing every document in
 * the tender's DCE and rendering the selected one INLINE in its native shape —
 * PDF in an iframe, spreadsheets via SheetJS, Word (.docx) via mammoth, images
 * directly. Heavy parsers are dynamically imported so they never weigh on the
 * main bundle. Bytes are streamed from the BFF /files/raw route (ZIP-backed).
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
}

const KIND_ICON: Record<FileKind, IconName> = {
  pdf: 'documents',
  excel: 'invoice',
  word: 'documents',
  image: 'documents',
  other: 'documents',
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function SourceFileViewer({ tenderId, onClose }: Props) {
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
        setFiles(data.files);
        setActive(data.files[0] ?? null);
      } catch (e) {
        if (!cancelled) setListError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  if (file.kind === 'excel') {
    return <ExcelRender url={rawUrl} />;
  }
  if (file.kind === 'word') {
    return <WordRender url={rawUrl} downloadUrl={rawUrl} fileName={file.label} />;
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

function ExcelRender({ url }: { url: string }) {
  const [html, setHtml] = useState<string[] | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ read, utils }, buf] = await Promise.all([
          import('xlsx'),
          fetch(url, { cache: 'no-store' }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        if (cancelled) return;
        const wb = read(new Uint8Array(buf), { type: 'array' });
        const names = wb.SheetNames;
        const tables = names.map((n) => utils.sheet_to_html(wb.Sheets[n]!));
        setSheets(names);
        setHtml(tables);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <div className="p-4 text-sm text-rose">Lecture du tableur échouée ({error}).</div>;
  if (!html) return <div className="p-4 text-sm text-muted">Lecture du tableur…</div>;

  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line bg-sand/40 px-2 py-1.5">
          {sheets.map((n, i) => (
            <button
              key={n}
              onClick={() => setSheet(i)}
              className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${
                sheet === i ? 'bg-emerald text-paper' : 'text-ink-2 hover:bg-sand'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div
        className="excel-sheet min-h-0 flex-1 overflow-auto p-3 text-sm"
        dangerouslySetInnerHTML={{ __html: html[sheet] ?? '' }}
      />
    </div>
  );
}

function WordRender({ url, downloadUrl, fileName }: { url: string; downloadUrl: string; fileName: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isDocx = useCallback(() => /\.docx$/i.test(fileName), [fileName]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isDocx()) {
        setError('legacy');
        return;
      }
      try {
        const [{ default: mammoth }, buf] = await Promise.all([
          import('mammoth'),
          fetch(url, { cache: 'no-store' }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        if (cancelled) return;
        const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
        setHtml(value);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, isDocx]);

  if (error === 'legacy') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>Format Word ancien (.doc) — aperçu non disponible.</p>
        <a
          href={downloadUrl}
          download={fileName}
          className="inline-flex items-center gap-1 rounded-lg bg-cyan px-3 py-2 font-semibold text-paper"
        >
          <Icon name="download" size={14} /> Télécharger le fichier
        </a>
      </div>
    );
  }
  if (error) return <div className="p-4 text-sm text-rose">Lecture du document échouée ({error}).</div>;
  if (!html) return <div className="p-4 text-sm text-muted">Lecture du document…</div>;

  return (
    <div
      ref={ref}
      className="word-doc mx-auto max-w-3xl p-6 text-sm leading-relaxed text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
