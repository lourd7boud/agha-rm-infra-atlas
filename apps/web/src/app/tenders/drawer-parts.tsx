'use client';

import { Icon, type IconName } from '@/components/ui/Icon';

/** A primary/secondary action that degrades to a disabled button when there is
 *  no safe URL — keeps keyboard + screen-reader semantics correct. */
export function ActionButton({
  href,
  icon,
  label,
  primary,
  download,
}: {
  href?: string;
  icon: IconName;
  label: string;
  primary?: boolean;
  /** Same-tab file download (Content-Disposition) instead of opening a tab. */
  download?: boolean;
}) {
  const base =
    'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition';
  if (!href) {
    return (
      <button
        type="button"
        disabled
        title="Lien du dossier indisponible"
        className={`${base} cursor-not-allowed text-faint ${
          primary ? 'bg-sand' : 'border border-line'
        }`}
      >
        <Icon name={icon} size={16} />
        {label}
      </button>
    );
  }
  const linkProps = download
    ? { download: '' }
    : { target: '_blank', rel: 'noopener noreferrer' };
  return (
    <a
      href={href}
      {...linkProps}
      className={`${base} ${
        primary
          ? 'bg-cyan text-paper hover:bg-cyan/90'
          : 'border border-line text-ink hover:bg-sand'
      }`}
    >
      <Icon name={icon} size={16} />
      {label}
    </a>
  );
}

const AI_NOTE_ENRICHED =
  'Données générées par IA — se référer aux documents officiels pour validation.';
const AI_NOTE_PENDING =
  'Synthèse automatique à partir des champs structurés. L’enrichissement IA (résumé détaillé, FAQ, lots) n’a pas encore été lancé pour ce marché.';

export function AiBanner({ enriched }: { enriched: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-cyan-soft/50 px-3 py-2 text-xs text-muted">
      <span className="rounded bg-cyan px-1 py-0.5 text-[9px] font-bold text-paper">IA</span>
      {enriched ? AI_NOTE_ENRICHED : AI_NOTE_PENDING}
    </p>
  );
}

export function ConditionRow({
  label,
  value,
  aiEstimated,
}: {
  label: string;
  value: string;
  aiEstimated?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">
        {value}
        {aiEstimated && value !== '—' && (
          <span
            className="ml-1.5 text-[10px] font-normal italic text-cyan"
            title="Estimation générée par IA — vérifier dans le dossier officiel"
          >
            (IA)
          </span>
        )}
      </span>
    </div>
  );
}
