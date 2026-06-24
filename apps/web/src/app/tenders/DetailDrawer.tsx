'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BuyerAvatar } from '@/components/ui/BuyerAvatar';
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

type Tab = 'resume' | 'faq' | 'lots' | 'bpu' | 'chat';

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
  const competitors = item.competitors ?? [];
  const winner = item.winner;
  const isAttribue = item.lifecycleStatus === 'attribue';
  const isInfructueux = item.lifecycleStatus === 'infructueux';
  const isCloture = item.lifecycleStatus === 'cloture';
  const hasResult = isAttribue || isInfructueux;
  const otherBidders = competitors.filter((c) => !c.isWinner);
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
    { key: 'chat', label: 'Chat IA' },
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
          <BuyerAvatar name={item.buyerName} size="md" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-muted" title={item.buyerName}>
              {item.buyerName}
            </p>
            <p className="font-mono text-xs text-faint">{item.reference}</p>
          </div>
          <AddToListButton tenderId={item.id} />
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
            {/* Lifecycle chip (datao spine) — colored by status, distinct from
                our internal funnel state chip that follows it. */}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isAttribue
                  ? 'bg-emerald-soft text-emerald'
                  : isInfructueux
                    ? 'bg-sand text-faint'
                    : isCloture
                      ? 'bg-ochre-soft text-ochre-deep'
                      : 'bg-cyan-soft text-cyan'
              }`}
              title="Statut de la consultation sur le portail"
            >
              {item.lifecycleLabel}
            </span>
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

          {hasResult && (
            <section className="mt-4 rounded-xl border border-emerald-soft bg-emerald-soft/30 px-4 py-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald">
                <Icon name="check" size={13} />
                Résultat de l&apos;appel d&apos;offre
              </h3>
              {isAttribue && winner ? (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-faint">Attribué à</dt>
                      <dd className="font-semibold text-ink">{winner.bidderName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-faint">Montant</dt>
                      <dd className="font-mono font-semibold text-ink">
                        {winner.amountMad != null ? fmtMad(winner.amountMad) : '—'}
                      </dd>
                    </div>
                    {item.resultDate && (
                      <div className="col-span-2">
                        <dt className="text-xs text-faint">Date du résultat</dt>
                        <dd className="text-ink">{fmtDateTime(item.resultDate)}</dd>
                      </div>
                    )}
                  </dl>
                  {otherBidders.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-emerald hover:underline">
                        Voir les {otherBidders.length} autre
                        {otherBidders.length > 1 ? 's' : ''} concurrent
                        {otherBidders.length > 1 ? 's' : ''}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {otherBidders.map((c, i) => (
                          <li
                            key={`${i}-${c.bidderName}`}
                            className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-sm"
                          >
                            <span className="text-ink-2">{c.bidderName}</span>
                            <span className="rounded bg-sand px-1.5 py-0.5 text-[10px] font-medium text-faint">
                              Non retenu
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  Marché déclaré <span className="font-semibold">infructueux</span> —
                  aucune offre retenue.
                </p>
              )}
            </section>
          )}

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

            {tab === 'chat' && <TenderChat tenderId={item.id} reference={item.reference} />}
          </div>
        </div>
      </aside>
    </div>
  );
}

interface TenderListRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  memberCount: number;
}

/**
 * "Ajouter à une liste" — datao-style dropdown that fetches the user's lists
 * on open, lets them pick one (or create a new one inline) and adds the current
 * tender. Optimistic + simple; the drawer's transient state is good enough.
 */
function AddToListButton({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<TenderListRow[] | null>(null);
  const [creating, setCreating] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || lists !== null) return;
    void fetch('/api/tender/lists')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TenderListRow[]) => setLists(data ?? []))
      .catch(() => setLists([]));
  }, [open, lists]);

  async function addTo(listId: string, name: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tender/lists/${listId}/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(`Ajouté à « ${name} »`);
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd(): Promise<void> {
    const name = creating.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/tender/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as TenderListRow;
      setLists((prev) => (prev ? [list, ...prev] : [list]));
      setCreating('');
      await addTo(list.id, list.name);
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand"
      >
        <Icon name="boxes" size={13} />
        Ajouter à une liste
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-line bg-paper shadow-raised">
          <div className="max-h-56 overflow-y-auto p-2">
            {lists === null ? (
              <p className="px-3 py-2 text-xs text-faint">Chargement…</p>
            ) : lists.length === 0 ? (
              <p className="px-3 py-2 text-xs text-faint">Aucune liste — créez-en une.</p>
            ) : (
              <ul className="space-y-1">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => addTo(l.id, l.name)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition hover:bg-sand disabled:opacity-50"
                    >
                      <span className="truncate">{l.name}</span>
                      <span className="shrink-0 text-xs text-faint">
                        {l.memberCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createAndAdd();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={creating}
                onChange={(e) => setCreating(e.target.value)}
                placeholder="Nouvelle liste…"
                disabled={busy}
                className="flex-1 rounded-md border border-line-2 bg-paper-2 px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !creating.trim()}
                className="rounded-md bg-cyan px-2 py-1.5 text-xs font-semibold text-paper transition hover:bg-cyan/90 disabled:opacity-50"
              >
                Créer
              </button>
            </form>
            {msg && <p className="mt-2 text-[10px] text-muted">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Per-tender chat panel — datao's "agent IA va parcourir le dossier" surface.
 * State is local to the drawer (so closing the drawer clears the thread, like
 * datao's Nouveau chat button). Hits POST /api/tenders/:id/chat which is
 * single-flight on the backend (no streaming, < 5s typical) and grounded only
 * in the tender's stored context — never the web.
 */
function TenderChat({ tenderId, reference }: { tenderId: string; reference: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    const q = input.trim();
    if (!q || pending) return;
    setError(null);
    const next: ChatMsg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setPending(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: messages.slice(-12),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
      }
      const data = (await res.json()) as { answer: string };
      setMessages([...next, { role: 'assistant', content: data.answer }]);
    } catch (e) {
      setError((e as Error).message);
      // Roll back the optimistic user message on failure so the user can edit/retry.
      setMessages(messages);
      setInput(q);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-lg bg-cyan-soft/50 px-3 py-2 text-xs text-muted">
        <span className="rounded bg-cyan px-1 py-0.5 text-[9px] font-bold text-paper">IA</span>
        Posez une question sur ce marché ({reference}) — l&apos;agent répond
        uniquement à partir des informations extraites du dossier (objet, lots,
        BPU, conditions, qualifications…). Ne pas utiliser pour des conseils
        juridiques.
      </p>
      {messages.length === 0 && (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-faint">
          Aucun message. Essayez : « Quelles sont les qualifications exigées ? »
        </p>
      )}
      <ul className="space-y-2">
        {messages.map((m, i) => (
          <li
            key={i}
            className={`rounded-lg p-3 text-sm ${
              m.role === 'user'
                ? 'border border-line bg-paper-2 text-ink'
                : 'bg-cyan-soft/30 text-ink-2'
            }`}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
              {m.role === 'user' ? 'Vous' : 'Assistant'}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
          </li>
        ))}
        {pending && (
          <li className="rounded-lg bg-cyan-soft/30 p-3 text-sm text-muted">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
              Assistant
            </p>
            <p className="italic">L&apos;agent lit le dossier…</p>
          </li>
        )}
      </ul>
      {error && (
        <p className="rounded-md border border-ochre-deep/30 bg-ochre-soft/40 px-3 py-2 text-xs text-ochre-deep">
          Erreur : {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Saisissez votre question…"
          rows={2}
          disabled={pending}
          className="flex-1 resize-none rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/15 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
