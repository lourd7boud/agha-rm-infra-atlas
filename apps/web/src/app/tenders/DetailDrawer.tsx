'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PIPELINE_LABELS, PROCEDURE_TONES, urgencyClasses } from '@/lib/labels';
import {
  CATEGORY_TONES,
  buildResume,
  fmtDateTime,
  hasRegion,
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

function AiBanner({ enriched }: { enriched: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-cyan-soft/50 px-3 py-2 text-xs text-muted">
      <span className="rounded bg-cyan px-1 py-0.5 text-[9px] font-bold text-paper">IA</span>
      {enriched ? AI_NOTE_ENRICHED : AI_NOTE_PENDING}
    </p>
  );
}

function ConditionRow({
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

const fmtPctOrDash = (v: number | null | undefined): string =>
  v != null ? `${v} %` : '—';
const fmtMoisOrDash = (v: number | null | undefined): string =>
  v != null ? `${v} mois` : '—';

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
  const enriched = Boolean(item.enrichedAt);
  const lots = item.lotsDetail ?? [];
  const faq = item.faq ?? [];
  const bpu = item.bpu ?? [];
  const quals = item.qualifications ?? [];
  // Per-field DCE provenance — a value is "verified" only when the dossier
  // actually supplied THAT field (not when an extraction merely ran). Avoids
  // labelling AI-fallback figures as officially DCE-confirmed.
  const dc = item.dossierConditions;
  const budgetVerified = Boolean(item.budgetFromDossier);
  const verifiedCautionDef = dc?.cautionDefinitivePct != null;
  const verifiedRetenue = dc?.retenueGarantiePct != null;
  const verifiedDelaiGar = dc?.delaiGarantieMois != null;
  const anyConditionVerified =
    budgetVerified || verifiedCautionDef || verifiedRetenue || verifiedDelaiGar;
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
              <dt className="text-xs text-faint">Lieu d&apos;exécution</dt>
              <dd className="flex items-start gap-1 text-ink">
                <Icon name="pin" size={13} className="mt-0.5 shrink-0 text-faint" />
                <span>
                  {item.location ?? item.region}
                  {!item.location && item.ville ? ` · ${item.ville}` : ''}
                  {/* Append the region only when it is a real, located value
                      distinct from the precise location — never "Non localisé". */}
                  {item.location &&
                  hasRegion(item.region) &&
                  item.region !== item.location ? (
                    <span className="text-faint"> · {item.region}</span>
                  ) : null}
                </span>
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-2">
            <ActionButton
              href={hasSource ? `/api/tenders/${item.id}/dossier` : undefined}
              icon="download"
              label="Télécharger le dossier"
              primary
              download
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
                <AiBanner enriched={enriched} />
                {item.reserveAuxPme && (
                  <span className="inline-block rounded-full bg-emerald-soft px-2.5 py-0.5 text-xs font-medium text-emerald">
                    Réservé aux PME / TPE / coopératives
                  </span>
                )}
                <p className="text-sm leading-relaxed text-ink-2">
                  {item.aiResume ?? buildResume(item)}
                </p>
                <div>
                  <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                    Conditions financières
                    {anyConditionVerified && (
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold normal-case text-paper">
                        DCE
                      </span>
                    )}
                  </h3>
                  <ConditionRow
                    label={budgetVerified ? 'Estimation (maître d’ouvrage)' : 'Budget estimé'}
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
                    label="Caution définitive"
                    value={fmtPctOrDash(item.conditions?.cautionDefinitivePct)}
                    aiEstimated={!verifiedCautionDef}
                  />
                  <ConditionRow
                    label="Retenue de garantie"
                    value={fmtPctOrDash(item.conditions?.retenueGarantiePct)}
                    aiEstimated={!verifiedRetenue}
                  />
                  <ConditionRow
                    label="Délai de garantie"
                    value={fmtMoisOrDash(item.conditions?.delaiGarantieMois)}
                    aiEstimated={!verifiedDelaiGar}
                  />
                  {item.delaiExecutionMois != null && (
                    <ConditionRow
                      label="Délai d’exécution"
                      value={fmtMoisOrDash(item.delaiExecutionMois)}
                    />
                  )}
                  {item.chiffreAffairesMinMad != null && (
                    <ConditionRow
                      label="Chiffre d’affaires min. exigé"
                      value={fmtMad(item.chiffreAffairesMinMad)}
                    />
                  )}
                </div>

                {quals.length > 0 && (
                  <div>
                    <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                      Qualifications requises
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold normal-case text-paper">
                        DCE
                      </span>
                    </h3>
                    <ul className="space-y-1.5">
                      {quals.map((q, i) => (
                        <li
                          key={`${i}-${q.qualification ?? q.secteur ?? ''}`}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
                        >
                          {q.secteur && <span>{q.secteur}</span>}
                          {q.qualification && (
                            <span className="rounded bg-sand px-1.5 py-0.5 font-mono text-xs text-ink">
                              {q.qualification}
                            </span>
                          )}
                          {q.classe && (
                            <span className="text-muted">classe {q.classe}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                <AiBanner enriched={enriched} />
                {faq.length > 0 ? (
                  <ul className="space-y-2">
                    {faq.map((qa, i) => (
                      <li
                        key={`${i}-${qa.question}`}
                        className="rounded-lg border border-line bg-paper-2 p-3"
                      >
                        <p className="flex items-start gap-2 text-sm font-semibold text-ink">
                          <span className="mt-0.5 shrink-0 rounded bg-cyan px-1 text-[10px] font-bold text-paper">
                            Q
                          </span>
                          {qa.question}
                        </p>
                        <p className="mt-1 pl-6 text-sm text-ink-2">{qa.reponse}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    Aucune question / réponse disponible. Lancez l&apos;enrichissement
                    IA ou consultez le règlement de consultation sur le portail.
                  </p>
                )}
              </div>
            )}

            {tab === 'lots' && (
              <div className="space-y-3">
                {lots.length > 0 ? (
                  <>
                    <p className="text-sm text-muted">
                      {lots.length === 1 ? 'Lot unique' : `${lots.length} lots`}
                    </p>
                    <ul className="space-y-2">
                      {lots.map((lot, i) => (
                        <li
                          key={`${i}-${lot.designation}`}
                          className="rounded-lg border border-line bg-paper-2 p-3"
                        >
                          <p className="text-sm font-semibold text-ink">
                            {lots.length > 1 ? `Lot ${i + 1} — ` : ''}
                            {lot.designation}
                          </p>
                          {lot.description && (
                            <p className="mt-1 text-sm text-ink-2">{lot.description}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : item.lotCount > 1 ? (
                  <p className="text-sm text-muted">
                    Ce marché comporte{' '}
                    <span className="font-semibold text-ink">{item.lotCount} lots</span>.
                    Lancez l&apos;enrichissement IA pour le détail par lot.
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-ink">Lot unique</p>
                    <div className="rounded-lg border border-line bg-paper-2 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-faint">
                        Désignation
                      </p>
                      <p className="mt-1 text-sm text-ink-2">{item.objet}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'bpu' && (
              <div className="space-y-3">
                {bpu.length > 0 ? (
                  <>
                    <p className="flex items-start gap-2 rounded-lg bg-emerald-soft/50 px-3 py-2 text-xs text-muted">
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold text-paper">
                        DCE
                      </span>
                      Bordereau extrait du dossier de consultation officiel ({bpu.length}{' '}
                      poste{bpu.length > 1 ? 's' : ''}).
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-line text-xs uppercase tracking-wider text-faint">
                          <tr>
                            <th className="py-2 pr-2 font-semibold">Désignation</th>
                            <th className="py-2 px-2 text-right font-semibold">Qté</th>
                            <th className="py-2 px-2 font-semibold">Unité</th>
                            <th className="py-2 pl-2 text-right font-semibold">P.U. (DH)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {bpu.map((row, i) => (
                            <tr key={`${i}-${row.designation}`} className="align-top">
                              <td className="py-2 pr-2 text-ink-2">{row.designation}</td>
                              <td className="py-2 px-2 text-right font-mono tabular-nums text-muted">
                                {row.quantite ?? '—'}
                              </td>
                              <td className="py-2 px-2 text-muted">{row.unite ?? '—'}</td>
                              <td className="py-2 pl-2 text-right font-mono tabular-nums text-ink">
                                {row.prixUnitaireMad != null ? fmtMad(row.prixUnitaireMad) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      Le bordereau des prix unitaires sera extrait du dossier de
                      consultation (DCE) lors de l&apos;analyse documentaire.
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
