import type { ReactNode } from 'react';

/**
 * Print-isolation wrapper for the Ventes documents (bon de livraison, facture).
 * The app shell (rail nav, headers, footer) lives in the root layout outside the
 * page, so on @media print we hide everything and reveal only this sheet, reset
 * to black-on-white A4. No PDF library — the browser's native print dialog turns
 * this into a PDF. The `.atlas-print-actions` toolbar is screen-only.
 */

interface PrintSheetProps {
  /** Browser print is triggered by the operator; this is the on-screen toolbar. */
  backHref: string;
  backLabel: string;
  toggleHref: string;
  toggleLabel: string;
  children: ReactNode;
}

const PRINT_CSS = `
@page { size: A4; margin: 16mm; }
.atlas-print-sheet {
  color: #111;
  background: #fff;
  max-width: 210mm;
  margin: 0 auto;
  padding: 24px;
  border-radius: 12px;
}
.atlas-print-sheet table { width: 100%; border-collapse: collapse; }
.atlas-print-sheet th,
.atlas-print-sheet td { border: 1px solid #d4d4d4; padding: 7px 10px; }
.atlas-print-sheet thead th {
  background: #f3f4f6;
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
@media print {
  body * { visibility: hidden !important; }
  .atlas-print-sheet,
  .atlas-print-sheet * { visibility: visible !important; }
  .atlas-print-sheet {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
    box-shadow: none;
    border-radius: 0;
  }
  .atlas-print-actions { display: none !important; }
}
`;

export function PrintSheet({
  backHref,
  backLabel,
  toggleHref,
  toggleLabel,
  children,
}: PrintSheetProps) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="atlas-print-actions mb-5 flex flex-wrap items-center gap-3">
        <a
          href={backHref}
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-muted transition hover:bg-sand"
        >
          ← {backLabel}
        </a>
        <a
          href={toggleHref}
          className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-muted transition hover:bg-sand"
        >
          {toggleLabel}
        </a>
        <p className="text-xs text-faint">
          Utilisez Ctrl/⌘ + P pour imprimer ou enregistrer en PDF.
        </p>
      </div>

      <div className="atlas-print-sheet bg-white text-[#111] shadow-card">
        {children}
      </div>
    </>
  );
}
