// Briques UI partagées du module Comptabilité — en-tête de page, badges,
// cartes KPI et bannières d'état. Design system ATLAS (paper/ink/cyan,
// IBM Plex Mono pour les nombres).
import Link from 'next/link';
import { STATUT_DECLARATION_BADGES } from '@/lib/compta';

export function ComptaHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan">
          <Link href="/compta" className="hover:underline">
            Comptabilité
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBanners({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string; code?: string };
}) {
  if (searchParams.saved) {
    return (
      <div className="mb-5 rounded-lg border border-emerald-soft bg-emerald-soft/20 px-4 py-2.5 text-sm font-medium text-emerald">
        Enregistré.
      </div>
    );
  }
  if (searchParams.error) {
    const detail =
      searchParams.code === 'invalid'
        ? 'Saisie invalide — vérifiez les champs.'
        : searchParams.code === 'conflict'
          ? 'Conflit — l’élément existe déjà ou est verrouillé.'
          : 'Opération échouée — réessayez.';
    return (
      <div className="mb-5 rounded-lg border border-clay-soft bg-clay-soft/20 px-4 py-2.5 text-sm font-medium text-clay">
        {detail} <span className="font-mono text-xs text-clay/70">({searchParams.error})</span>
      </div>
    );
  }
  return null;
}

export function StatutBadge({ statut }: { statut: string }) {
  const badge = STATUT_DECLARATION_BADGES[statut] ?? {
    label: statut,
    className: 'bg-sand text-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  accent = 'border-l-cyan',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm border-l-4 ${accent}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sand/50 px-5 py-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-ink-2">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export const inputClass =
  'rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';

export const btnPrimary =
  'rounded-lg bg-cyan px-3.5 py-2 text-sm font-semibold text-paper transition hover:opacity-90';

export const btnGhost =
  'rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-sand hover:text-ink';

/** Sélecteur d'année (GET) — préserve le chemin, change ?annee=. */
export function AnneePicker({ annee, path }: { annee: number; path: string }) {
  const years = [annee + 1, annee, annee - 1, annee - 2].filter(
    (y, i, arr) => arr.indexOf(y) === i,
  );
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-paper-2 p-1">
      {years
        .sort((a, b) => b - a)
        .map((y) => (
          <Link
            key={y}
            href={`${path}?annee=${y}`}
            className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition ${
              y === annee ? 'bg-cyan text-paper' : 'text-muted hover:bg-sand hover:text-ink'
            }`}
          >
            {y}
          </Link>
        ))}
    </div>
  );
}
