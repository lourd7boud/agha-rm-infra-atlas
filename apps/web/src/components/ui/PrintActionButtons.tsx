'use client';

interface PrintActionButtonsProps {
  excelHref?: string;
  backHref?: string;
  backLabel?: string;
}

export function PrintActionButtons({
  excelHref,
  backHref = '..',
  backLabel = 'Retour aux dépenses',
}: PrintActionButtonsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {backHref && (
        <a
          href={backHref}
          className="rounded-lg border border-line bg-paper px-3 py-2 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
        >
          ← {backLabel}
        </a>
      )}

      {excelHref && (
        <a
          href={excelHref}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          <span>📊</span>
          <span>Télécharger Excel</span>
        </a>
      )}

      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper shadow-sm transition hover:opacity-90"
      >
        <span>🖨️</span>
        <span>Imprimer / PDF</span>
      </button>
    </div>
  );
}
