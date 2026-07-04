import Link from 'next/link';

interface PagerProps {
  /** Zero-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total matching rows across all pages. */
  total: number;
  /** Builds the href for a given zero-based page (preserve other query params). */
  hrefForPage: (page: number) => string;
}

/**
 * DB-pagination pager for the ERP list pages. Renders "N–M sur TOTAL · page X/Y"
 * with Précédent / Suivant links, and returns null when everything fits on one
 * page. Pure links (no client JS) so it drops straight into a Server Component.
 */
export function Pager({ page, pageSize, total, hrefForPage }: PagerProps) {
  if (total <= pageSize) return null;

  const pageCount = Math.ceil(total / pageSize);
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const from = current * pageSize + 1;
  const to = Math.min((current + 1) * pageSize, total);
  const hasPrev = current > 0;
  const hasNext = current + 1 < pageCount;

  const linkClasses =
    'rounded-md border border-line-2 px-3 py-1.5 text-xs font-medium transition hover:bg-sand';
  const disabledClasses =
    'rounded-md border border-line px-3 py-1.5 text-xs font-medium text-faint opacity-50';

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted"
    >
      <span className="tabular-nums">
        {from}–{to} sur {total} · page {current + 1}/{pageCount}
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link href={hrefForPage(current - 1)} className={linkClasses}>
            ← Précédent
          </Link>
        ) : (
          <span className={disabledClasses}>← Précédent</span>
        )}
        {hasNext ? (
          <Link href={hrefForPage(current + 1)} className={linkClasses}>
            Suivant →
          </Link>
        ) : (
          <span className={disabledClasses}>Suivant →</span>
        )}
      </div>
    </nav>
  );
}
