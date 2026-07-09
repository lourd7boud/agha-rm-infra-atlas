// Fiche marché — the tabbed BTP project workspace. The active tab lives in the
// URL (?tab=) so every view is addressable; each tab is an async Server
// Component fetching exactly what it needs.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad, PROJECT_STATUS_BADGES, type BtpProjectDetail } from '@/lib/btp';
import { ApercuTab } from './btp/ApercuTab';
import { BordereauTab, DecomptesTab, ExportTab, MetresTab } from './btp/ExecutionTabs';
import { RevisionTab } from './btp/RevisionTab';
import { AvenantsTab, OdsTab, PenalitesTab, ValidationsTab } from './btp/RegistresTabs';
import { DocumentsTab, PhotosTab } from './btp/MediaTabs';
import { JournalTab, RessourcesTab } from './btp/RessourcesTab';

const TABS = [
  { key: 'apercu', label: "Vue d'ensemble" },
  { key: 'bordereau', label: 'Bordereau' },
  { key: 'metres', label: 'Métrés' },
  { key: 'decomptes', label: 'Décomptes' },
  { key: 'revision', label: 'Révision' },
  { key: 'avenants', label: 'Avenants' },
  { key: 'ods', label: 'ODS' },
  { key: 'penalites', label: 'Pénalités' },
  { key: 'validations', label: 'Validations' },
  { key: 'photos', label: 'Photos' },
  { key: 'documents', label: 'Documents' },
  { key: 'journal', label: 'Journal' },
  { key: 'ressources', label: 'Ressources' },
  { key: 'export', label: 'Export' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Requête refusée : vérifiez les champs saisis.',
  conflict: 'Action impossible dans l’état actuel (transition ou verrou).',
  failed: 'Une erreur est survenue. Réessayez.',
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === query.tab)?.key ?? 'apercu') as TabKey;
  const project = await apiGet<BtpProjectDetail>(`/btp/projects/${id}`);
  const badge = PROJECT_STATUS_BADGES[project.status] ?? {
    label: project.status,
    classes: 'bg-sand text-muted',
  };
  const errorMessage = query.error
    ? `${query.error} — ${ACTION_ERROR_MESSAGES[query.code ?? 'failed'] ?? ACTION_ERROR_MESSAGES.failed}`
    : undefined;
  const savedMessage = query.saved ? 'Modifications enregistrées.' : undefined;
  const overrun = project.progressPct > 100;
  const progressWidth = Math.min(100, Math.max(0, project.progressPct));

  const counts: Partial<Record<TabKey, number>> = {
    bordereau: project.counts.bordereauLignes,
    metres: project.counts.periodes,
    decomptes: project.counts.decomptes,
    avenants: project.situationContractuelle.count,
    photos: project.counts.photos,
    documents: project.counts.documents + project.counts.pv,
  };

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Marchés de travaux
      </Link>

      {/* En-tête marché */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-black tracking-tight text-cyan">
              {project.reference}
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
              {badge.label}
            </span>
            {project.delai.enArret && (
              <span className="rounded-full bg-clay-soft px-3 py-1 text-xs font-semibold text-clay">
                Travaux arrêtés
              </span>
            )}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted">
            {project.objet ?? project.name}
          </p>
          <p className="mt-1 text-xs text-faint">
            {project.societe ?? '—'} · {project.annee ?? '—'}
            {project.commune ? ` · ${project.commune}` : ''}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 px-5 py-3 text-right shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Montant du marché (TTC)
          </p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums">
            {fmtMad(project.montantMarcheMad)}
          </p>
        </div>
      </div>

      {/* Avancement */}
      <div className="mt-5 rounded-xl border border-line bg-paper-2 px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-widest text-faint">
            Progression financière
          </span>
          <span
            className={`font-mono text-base font-bold tabular-nums ${overrun ? 'text-clay' : 'text-cyan'}`}
          >
            {project.progressPct.toLocaleString('fr-MA', { maximumFractionDigits: 1 })}%
            {overrun ? ' — dépassement du marché ⚠' : ''}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
          <div
            className={`h-full rounded-full ${overrun ? 'bg-clay' : 'bg-gradient-to-r from-cyan via-teal to-emerald'}`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-faint">
          <span>
            Bordereau <strong className="font-mono text-muted">{project.counts.bordereauLignes}</strong>{' '}
            prix
          </span>
          <span>
            Métrés <strong className="font-mono text-muted">{project.counts.periodes}</strong>
          </span>
          <span>
            Décomptes <strong className="font-mono text-muted">{project.counts.decomptes}</strong>
          </span>
          <span>
            Photos <strong className="font-mono text-muted">{project.counts.photos}</strong>
          </span>
          {project.dernierDecompte && (
            <span>
              Dernier décompte n°{project.dernierDecompte.numero} —{' '}
              <strong className="font-mono text-muted">
                {fmtMad(project.dernierDecompte.totalTtcMad)}
              </strong>{' '}
              TTC cumulé
            </span>
          )}
        </div>
      </div>

      {/* Bandeaux feedback */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-3 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}
      {savedMessage && !errorMessage && (
        <div className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/20 px-5 py-3 text-sm font-medium text-emerald">
          {savedMessage}
        </div>
      )}

      {/* Onglets */}
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map((t) => {
          const active = t.key === tab;
          const count = counts[t.key];
          return (
            <Link
              key={t.key}
              href={`/projects/${id}?tab=${t.key}`}
              className={`whitespace-nowrap rounded-t-lg border-x border-t px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? 'border-line bg-paper-2 text-cyan'
                  : 'border-transparent text-muted hover:bg-paper-2/60 hover:text-ink'
              }`}
            >
              {t.label}
              {count !== undefined && count > 0 && (
                <span className="ml-1.5 rounded-full bg-sand px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Contenu de l'onglet */}
      <div className="mt-6">
        {tab === 'apercu' && <ApercuTab project={project} />}
        {tab === 'bordereau' && <BordereauTab project={project} />}
        {tab === 'metres' && <MetresTab project={project} />}
        {tab === 'decomptes' && <DecomptesTab project={project} />}
        {tab === 'revision' && <RevisionTab project={project} />}
        {tab === 'avenants' && <AvenantsTab project={project} />}
        {tab === 'ods' && <OdsTab project={project} />}
        {tab === 'penalites' && <PenalitesTab project={project} />}
        {tab === 'validations' && <ValidationsTab project={project} />}
        {tab === 'photos' && <PhotosTab project={project} />}
        {tab === 'documents' && <DocumentsTab project={project} />}
        {tab === 'journal' && <JournalTab project={project} />}
        {tab === 'ressources' && <RessourcesTab project={project} />}
        {tab === 'export' && <ExportTab project={project} />}
      </div>
    </div>
  );
}
