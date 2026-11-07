'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { DceFileKind } from '@/lib/dce-file-kind';

/**
 * datao's "Voir le fichier source": split overlay that renders the selected DCE
 * document INLINE in its native shape — PDF/images/text served same-origin and
 * Office/OpenDocument files converted locally by ATLAS to browser-native PDF.
 * Nothing in a DCE is sent to an external document-rendering service.
 *
 * Two display modes:
 *   modal — full-screen overlay with the complete DCE file list (used by the
 *           tender header button to browse the whole dossier).
 *   side  — a responsive split workspace: the source fills every pixel left of
 *           the tender drawer and their separator is draggable. On narrower
 *           screens the source becomes a keyboard-contained full-screen dialog.
 *           With bordereauOnly, only the BPU source is listed + auto-selected.
 */

interface DceFile {
  name: string;
  label: string;
  kind: DceFileKind;
  sizeBytes: number;
}

interface Props {
  tenderId: string;
  onClose: () => void;
  mode?: 'modal' | 'side';
  bordereauOnly?: boolean;
  drawerWidth?: number;
  onDrawerWidthChange?: (width: number) => void;
  desktopSplit?: boolean;
}

export const TENDER_DETAIL_MIN_WIDTH = 420;
export const TENDER_DETAIL_MAX_WIDTH = 760;
export const TENDER_SOURCE_MIN_WIDTH = 480;
export const TENDER_SPLIT_MEDIA_QUERY = '(min-width: 1280px)';

/** Keep both halves of the desktop workspace usable while the splitter moves. */
export function clampTenderDetailWidth(
  viewportWidth: number,
  requestedWidth: number,
): number {
  const maxWidth = Math.max(
    0,
    Math.min(TENDER_DETAIL_MAX_WIDTH, viewportWidth - TENDER_SOURCE_MIN_WIDTH),
  );
  const minWidth = Math.min(TENDER_DETAIL_MIN_WIDTH, maxWidth);
  return Math.min(Math.max(requestedWidth, minWidth), maxWidth);
}

export function tenderDetailWidthFromDivider(
  viewportWidth: number,
  clientX: number,
): number {
  return clampTenderDetailWidth(viewportWidth, viewportWidth - clientX);
}

const KIND_ICON: Record<DceFileKind, IconName> = {
  pdf: 'documents',
  excel: 'invoice',
  word: 'documents',
  presentation: 'documents',
  image: 'documents',
  text: 'documents',
  other: 'documents',
};

export function sourceFilePreviewUrl(
  tenderId: string,
  file: Pick<DceFile, 'name' | 'kind'>,
): string {
  return `/api/tenders/${encodeURIComponent(tenderId)}/files/preview?name=${encodeURIComponent(file.name)}`;
}

function needsLocalPdfPreview(file: DceFile): boolean {
  return (
    file.kind === 'excel' ||
    file.kind === 'word' ||
    file.kind === 'presentation' ||
    /\.tiff?$/i.test(file.name)
  );
}

const BORDEREAU_NAME_RE = /bordereau|bpu|estimatif|bpde|d[ée]tail/i;
/** Many DCE ship the bordereau des prix ONLY as an in-document table inside the
 *  CPS (no standalone Bordereau.xlsx/PDF). When no dedicated file exists we fall
 *  back to the CPS so the user still reaches the prices. Mirrors the CPS tier in
 *  api/tenders/[id]/files/route.ts's priority(). */
const CPS_NAME_RE = /\bcps\b|cahier des prescriptions|\bcct\b|\bccap\b/i;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function pickBordereau(files: ReadonlyArray<DceFile>): DceFile | null {
  const byName = files.find((f) => BORDEREAU_NAME_RE.test(f.name));
  if (byName) return byName;
  const excel = files.find((f) => f.kind === 'excel');
  if (excel) return excel;
  const cps = files.find((f) => CPS_NAME_RE.test(f.name));
  if (cps) return cps;
  return files[0] ?? null;
}

export function SourceFileViewer({
  tenderId,
  onClose,
  mode = 'modal',
  bordereauOnly = false,
  drawerWidth = 640,
  onDrawerWidthChange,
  desktopSplit = false,
}: Props) {
  const [files, setFiles] = useState<DceFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<DceFile | null>(null);
  // true when no standalone bordereau/BPU/Excel file exists and we fell back to
  // the CPS (which embeds the bordereau des prix as an in-document table).
  const [bordereauInCps, setBordereauInCps] = useState(false);
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onDrawerWidthChange) return;
    resizingRef.current = true;
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current || !onDrawerWidthChange) return;
    onDrawerWidthChange(
      tenderDetailWidthFromDivider(window.innerWidth, event.clientX),
    );
  };

  const stopResize = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    setIsResizing(false);
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onDrawerWidthChange) return;
    const step = event.shiftKey ? 64 : 24;
    let requestedWidth: number | null = null;
    if (event.key === 'ArrowLeft') requestedWidth = drawerWidth + step;
    if (event.key === 'ArrowRight') requestedWidth = drawerWidth - step;
    if (event.key === 'Home') requestedWidth = TENDER_DETAIL_MAX_WIDTH;
    if (event.key === 'End') requestedWidth = TENDER_DETAIL_MIN_WIDTH;
    if (requestedWidth === null) return;
    event.preventDefault();
    onDrawerWidthChange(
      clampTenderDetailWidth(window.innerWidth, requestedWidth),
    );
  };

  useEffect(
    () => () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [],
  );

  // Below the desktop split breakpoint this viewer covers the whole viewport.
  // Move focus into it, keep Tab inside, and restore the launch control on close.
  useEffect(() => {
    if (mode !== 'side' || desktopSplit) return;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    panelRef.current?.focus();
    return () => {
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, [mode, desktopSplit]);

  const keepMobileFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (desktopSplit || event.key !== 'Tab') return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute('disabled'));
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === panelRef.current)) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/files`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { files: DceFile[] };
        if (cancelled) return;
        if (!bordereauOnly) {
          setFiles(data.files);
          setActive(data.files[0] ?? null);
          setBordereauInCps(false);
          return;
        }
        const standalone = data.files.filter(
          (f) => BORDEREAU_NAME_RE.test(f.name) || f.kind === 'excel',
        );
        // No dedicated bordereau/BPU/Excel file — publish the CPS itself as the
        // bordereau (it contains the price table) instead of showing nothing.
        const visible =
          standalone.length > 0
            ? standalone
            : data.files.filter((f) => CPS_NAME_RE.test(f.name));
        setFiles(visible);
        setActive(pickBordereau(visible));
        setBordereauInCps(standalone.length === 0 && visible.length > 0);
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

  // Desktop split workspace: the source consumes every pixel left by the detail
  // drawer. The shared CSS variable is owned by DetailDrawer and the separator
  // below updates it. On small screens the source becomes a full-screen layer.
  if (mode === 'side') {
    return (
      <div
        ref={panelRef}
        tabIndex={desktopSplit ? undefined : -1}
        onKeyDown={keepMobileFocusInside}
        className="fixed inset-y-0 right-0 z-[59] flex w-full flex-col border-r border-line bg-paper shadow-raised outline-none xl:right-[var(--tender-detail-width)] xl:w-[calc(100vw-var(--tender-detail-width))]"
        role="dialog"
        aria-modal={!desktopSplit}
        aria-label="Fichier source du bordereau"
      >
        <div
          role="separator"
          tabIndex={desktopSplit ? 0 : -1}
          aria-label="Redimensionner les panneaux"
          aria-orientation="vertical"
          aria-valuemin={TENDER_DETAIL_MIN_WIDTH}
          aria-valuemax={TENDER_DETAIL_MAX_WIDTH}
          aria-valuenow={Math.round(drawerWidth)}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onDoubleClick={() =>
            onDrawerWidthChange?.(
              clampTenderDetailWidth(window.innerWidth, 640),
            )
          }
          onKeyDown={resizeWithKeyboard}
          className={`group absolute inset-y-0 right-0 z-30 hidden w-4 translate-x-1/2 touch-none cursor-col-resize items-center justify-center outline-none xl:flex ${
            isResizing ? 'bg-cyan/10' : 'hover:bg-cyan/10 focus-visible:bg-cyan/10'
          }`}
          title="Glisser pour redimensionner · Double-cliquer pour réinitialiser"
        >
          <span
            aria-hidden="true"
            className={`h-14 w-1 rounded-full transition-colors ${
              isResizing ? 'bg-cyan' : 'bg-line group-hover:bg-cyan'
            }`}
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink">
            {active
              ? bordereauInCps
                ? `Bordereau (dans le CPS) — ${active.label}`
                : active.label
              : listError
                ? 'Indisponible'
                : 'Chargement…'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {active && (
              <a
                href={`/api/tenders/${encodeURIComponent(tenderId)}/files/raw?name=${encodeURIComponent(active.name)}`}
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
              Bordereau non trouvé dans le dossier de consultation (ni fichier
              dédié, ni CPS).
            </p>
          ) : active ? (
            <>
              {bordereauInCps && (
                <p className="border-b border-line bg-cyan/10 px-4 py-2 text-xs text-ink-2">
                  Ce dossier ne fournit pas de bordereau séparé — le CPS contient
                  le bordereau des prix.
                </p>
              )}
              <FileRender tenderId={tenderId} file={active} />
            </>
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
              href={`/api/tenders/${encodeURIComponent(tenderId)}/files/raw?name=${encodeURIComponent(active.name)}`}
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
  const rawUrl = `/api/tenders/${encodeURIComponent(tenderId)}/files/raw?name=${encodeURIComponent(file.name)}`;

  if (file.kind === 'pdf') {
    return <iframe src={rawUrl} title={file.label} className="h-full w-full border-0" />;
  }
  if (file.kind === 'image' && !needsLocalPdfPreview(file)) {
    return (
      <div className="flex justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={rawUrl} alt={file.label} className="max-w-full" />
      </div>
    );
  }
  if (needsLocalPdfPreview(file)) {
    return <OfficeRender tenderId={tenderId} file={file} downloadUrl={rawUrl} />;
  }
  if (file.kind === 'text') {
    return <TextRender file={file} rawUrl={rawUrl} />;
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

/** Text/XML/JSON is fetched as data and escaped by React inside <pre>. It is
 * never interpreted as an active same-origin document. */
function TextRender({ file, rawUrl }: { file: DceFile; rawUrl: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError(null);
    void fetch(rawUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => setContent(text))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError((reason as Error).message || 'Lecture impossible');
        }
      });
    return () => controller.abort();
  }, [rawUrl]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>Lecture du texte impossible ({error}).</p>
        <a href={rawUrl} download={file.label} className="rounded-lg bg-cyan px-3 py-2 font-semibold text-paper">
          Télécharger le fichier
        </a>
      </div>
    );
  }
  if (content === null) return <div className="p-4 text-sm text-muted">Lecture du fichier…</div>;
  return (
    <pre className="min-h-full overflow-auto whitespace-pre-wrap break-words bg-paper p-5 text-xs leading-relaxed text-ink">
      {content}
    </pre>
  );
}

/** Office/OpenDocument → local ATLAS Core conversion → same-origin PDF blob. */
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
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setEmbedUrl(null);
    setError(null);
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(sourceFilePreviewUrl(tenderId, file), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(payload?.message ?? `HTTP ${res.status}`);
        }
        const pdf = await res.blob();
        if (pdf.type !== 'application/pdf') {
          throw new Error('Le convertisseur n’a pas renvoyé un PDF');
        }
        const nextObjectUrl = URL.createObjectURL(pdf);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setEmbedUrl(nextObjectUrl);
      } catch (e) {
        if (!cancelled && !controller.signal.aborted) {
          setError((e as Error).message || 'Conversion impossible');
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tenderId, file.name, file.kind, retry]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">
        <p className="font-semibold text-ink">Aperçu local indisponible</p>
        <p className="max-w-lg text-xs">{error}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="rounded-lg border border-line px-3 py-2 font-semibold text-ink hover:bg-sand"
          >
            Réessayer
          </button>
          <a
            href={downloadUrl}
            download={file.label}
            className="inline-flex items-center gap-1 rounded-lg bg-cyan px-3 py-2 font-semibold text-paper"
          >
            <Icon name="download" size={14} /> Télécharger le fichier
          </a>
        </div>
      </div>
    );
  }
  if (!embedUrl) {
    return <div className="p-4 text-sm text-muted">Préparation de l’aperçu…</div>;
  }
  return <iframe src={embedUrl} title={file.label} className="h-full w-full border-0" />;
}
