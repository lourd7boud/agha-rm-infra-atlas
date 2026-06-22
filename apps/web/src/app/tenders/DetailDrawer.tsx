'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PIPELINE_LABELS, PROCEDURE_TONES, urgencyClasses } from '@/lib/labels';
import {
  CATEGORY_TONES,
  buildResume,
  fmtDateTime,
  safeHttpUrl,
  type TenderItem,
} from '@/lib/tenders';
import { fmtMad } from '@/lib/projects';

type Tab = 'resume' | 'faq' | 'lots' | 'bpu';

/** A primary/secondary action that degrades to a disabled button when there is
 *  no safe URL — keeps keyboard + screen-reader semantics correct. */
function ActionButton({
  href,
  icon,
  label,
  primary,
}: {
  href?: string;
  icon: IconName;
  label: string;
  primary?: boolean;
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
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
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

const AI_NOTE =
  'Synthèse automatique à partir des champs structurés. Le résumé détaillé, la FAQ et le BPU générés par IA depuis le dossier arrivent prochainement (Phase C).';

function AiBanner() {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-cyan-soft/50 px-3 py-2 text-xs text-muted">
      <span className="rounded bg-cyan px-1 py-0.5 text-[9px] font-bold text-paper">IA</span>
      {AI_NOTE}
    </p>
  );
}

function ConditionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export function DetailDrawer({
  item,
  onClose,
}: {
  item: TenderItem | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('resume');
  const panelRef = useRef<HTMLElement>(null);

  // Reset to the first tab whenever a different tender is opened.
  useEffect(() => {
    setTab('resume');
  }, [item?.id]);

  // Move focus into the panel when it opens (keyboard + screen-reader).
  useEffect(() => {
    if (item) panelRef.current?.focus();
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const state =
    PIPELINE_LABELS[item.pipelineState] ?? {
      label: item.pipelineState,
      classes: 'bg-sand text-muted',
    };
  const overdue = item.daysLeft < 0;
  const sourceUrl = safeHttpUrl(item.sourceUrl);
  const hasSource = Boolean(sourceUrl);
  const tabs: ReadonlyArray<{ key: Tab; label: string }> = [
    { key: 'resume', label: 'Résumé' },
    { key: 'faq', label: 'FAQ' },
    { key: 'lots', label: `Lots (${item.lotCount})` },
    { key: 'bpu', label: 'BPU' },
  ];

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Détail du marché ${item.reference}`}
        className="absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col bg-paper shadow-raised focus:outline-none"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted">{item.buyerName}</p>
            <p className="font-mono text-xs text-faint">{item.reference}</p>
          </div>
          <Link
            href={`/tenders/${item.id}`}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand"
          >
            Fiche complète
            <Icon name="chevronRight" size={13} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau"
            className="rounded-md p-1.5 text-faint transition hover:bg-sand hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h2 className="font-display text-xl font-semibold leading-snug text-ink">
            {item.objet}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${state.classes}`}
            >
              {state.label}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_TONES[item.category]}`}
            >
              {item.category}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PROCEDURE_TONES[item.procedure]}`}
            >
              {item.procedureLabel}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold ${
                overdue ? 'bg-sand text-faint' : urgencyClasses(item.daysLeft)
              }`}
            >
              {overdue ? 'Échu' : `J-${item.daysLeft}`}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Budget estimé</dt>
              <dd className="font-mono font-semibold text-ink">
                {item.estimationMad != null ? fmtMad(item.estimationMad) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Caution provisoire</dt>
              <dd className="font-mono font-semibold text-ink">
                {item.cautionProvisoireMad != null
                  ? fmtMad(item.cautionProvisoireMad)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Publié le</dt>
              <dd className="text-ink">{fmtDateTime(item.publishedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Date limite</dt>
              <dd className="text-ink">{fmtDateTime(item.deadlineAt)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-faint">Localisation</dt>
              <dd className="flex items-center gap-1 text-ink">
                <Icon name="pin" size={13} className="text-faint" />
                {item.region}
                {item.ville ? ` · ${item.ville}` : ''}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-2">
            <ActionButton
              href={sourceUrl}
              icon="download"
              label="Télécharger le dossier"
              primary
            />
            <ActionButton href={sourceUrl} icon="external" label="Soumission en ligne" />
          </div>

          <nav className="mt-5 flex gap-1 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                  tab === t.key
                    ? 'border-cyan text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="py-4">
            {tab === 'resume' && (
              <div className="space-y-4">
                <AiBanner />
                <p className="text-sm leading-relaxed text-ink-2">{buildResume(item)}</p>
                <div>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-faint">
                    Conditions financières
                  </h3>
                  <ConditionRow
                    label="Budget estimé"
                    value={item.estimationMad != null ? fmtMad(item.estimationMad) : '—'}
                  />
                  <ConditionRow
                    label="Cautionnement provisoire"
                    value={
                      item.cautionProvisoireMad != null
                        ? fmtMad(item.cautionProvisoireMad)
                        : '—'
                    }
                  />
                  <ConditionRow
                    label="Caution définitive / retenue / délai"
                    value="Voir dossier"
                  />
                </div>
                <Link
                  href={`/tenders/${item.id}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-cyan hover:underline"
                >
                  Analyse Go/No-Go &amp; qualification
                  <Icon name="chevronRight" size={14} />
                </Link>
              </div>
            )}

            {tab === 'faq' && (
              <div className="space-y-3">
                <AiBanner />
                <p className="text-sm text-muted">
                  Les questions / réponses sur les conditions d&apos;éligibilité
                  (chiffre d&apos;affaires, qualification, classification…) seront
                  générées par IA à partir du dossier. En attendant, consultez le
                  règlement de consultation sur le portail.
                </p>
              </div>
            )}

            {tab === 'lots' && (
              <div className="space-y-3">
                {item.lotCount > 1 ? (
                  <p className="text-sm text-muted">
                    Ce marché comporte{' '}
                    <span className="font-semibold text-ink">{item.lotCount} lots</span>.
                    Le détail par lot (désignation, spécifications) sera extrait du
                    dossier.
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-ink">Lot unique</p>
                )}
                <div className="rounded-lg border border-line bg-paper-2 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-faint">
                    Désignation
                  </p>
                  <p className="mt-1 text-sm text-ink-2">{item.objet}</p>
                </div>
              </div>
            )}

            {tab === 'bpu' && (
              <div className="space-y-3">
                <AiBanner />
                <p className="text-sm text-muted">
                  Le bordereau des prix unitaires (désignation, quantité, unité) sera
                  extrait du dossier de consultation.
                </p>
                {hasSource && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan hover:underline"
                  >
                    <Icon name="external" size={15} />
                    Voir le dossier sur le portail
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
