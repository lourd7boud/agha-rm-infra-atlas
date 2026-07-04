'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BuyerAvatar } from '@/components/ui/BuyerAvatar';
import { Icon } from '@/components/ui/Icon';
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
import { SourceFileViewer } from './SourceFileViewer';
import { LiveParticipantsButton } from './LiveParticipantsButton';
import { ActionButton, AiBanner, ConditionRow } from './drawer-parts';
import { AddToListButton } from './AddToListButton';
import { TenderChat } from './TenderChat';

type Tab = 'resume' | 'faq' | 'lots' | 'bpu' | 'chat';

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
  // 'none' = closed, 'all' = legacy modal browser of every DCE file (header
  // button), 'bordereau' = datao-style side panel showing only the BPU source
  // (BPU-tab button). See SourceFileViewer for the two render modes.
  const [showFiles, setShowFiles] = useState<'none' | 'all' | 'bordereau'>('none');
  // Full enrichment for the selected tender. The /inventory list ships only the
  // light item (no bpu/faq/lotsDetail/… heavy arrays); we hydrate them here from
  // GET /api/tender/tenders/:id when the drawer opens. null while loading/absent.
  const [detail, setDetail] = useState<TenderItem | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Reset to the first tab whenever a different tender is opened.
  useEffect(() => {
    setTab('resume');
    setShowFiles('none');
  }, [item?.id]);

  // Fetch the FULL detail (heavy dossier arrays) whenever a tender is opened.
  // Reset first so a stale detail never bleeds across selections; ignore errors
  // (drawer degrades to the light item's base/live fields).
  useEffect(() => {
    if (!item) return;
    setDetail(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tender/tenders/${item.id}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data: TenderItem = await res.json();
        if (!cancelled) setDetail(data);
      } catch {
        // Leave detail null — the light item still renders base + live fields.
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // Merged view: the full detail (heavy enrichment arrays) overrides the light
  // item's undefined fields; base/live fields fall back to `item`. When detail
  // hasn't loaded yet, `view` is just the light item.
  const view: TenderItem = detail ? { ...item, ...detail } : item;
  // Enrichment tabs (bpu/faq/lots/qualifications) depend on the heavy arrays,
  // which only arrive with `detail`. While it's null, show a load placeholder
  // instead of an empty state so the drawer doesn't look broken.
  const detailLoading = detail === null;

  const state =
    PIPELINE_LABELS[item.pipelineState] ?? {
      label: item.pipelineState,
      classes: 'bg-sand text-muted',
    };
  const overdue = item.daysLeft < 0;
  const sourceUrl = safeHttpUrl(item.sourceUrl);
  const hasSource = Boolean(sourceUrl);
  const enriched = Boolean(view.enrichedAt);
  const lots = view.lotsDetail ?? [];
  const faq = view.faq ?? [];
  const bpu = view.bpu ?? [];
  // Group BPU rows under their section header (datao groups by corps d'état /
  // série / lot). Consecutive same-section rows form one group; order preserved.
  const bpuGroups: Array<{ section: string | null; rows: typeof bpu }> = [];
  for (const row of bpu) {
    const section = row.section?.trim() || null;
    const last = bpuGroups[bpuGroups.length - 1];
    if (last && last.section === section) last.rows.push(row);
    else bpuGroups.push({ section, rows: [row] });
  }
  const quals = view.qualifications ?? [];
  // Portal-first "fiche du portail": the published detail block (zero LLM). The
  // portal prints "-" for empty fields — treat those as absent.
  const pd = view.portalDetail;
  // Some buyers type placeholders ("-", "champsvide", "néant") into optional
  // portal fields — treat those as absent so we never render "Fax : champsvide".
  const PORTAL_PLACEHOLDERS = new Set(['-', 'champsvide', 'champ vide', 'neant', 'néant', 'n/a']);
  const meaningful = (s?: string | null): s is string =>
    Boolean(s && s.trim() && !PORTAL_PLACEHOLDERS.has(s.trim().toLowerCase()));
  // Contact: prefer the portal source (it also publishes a télécopieur), fall
  // back to the DCE-extracted contact. Normalized to one concrete shape.
  const portalContact = pd?.contact;
  const telecopieur = (portalContact as { telecopieur?: string | null } | null | undefined)
    ?.telecopieur;
  const contactFromPortal = Boolean(
    portalContact &&
      (meaningful(portalContact.nom) ||
        meaningful(portalContact.email) ||
        meaningful(portalContact.telephone) ||
        meaningful(telecopieur)),
  );
  const contactSource = contactFromPortal ? portalContact : view.contact;
  const contact = contactSource
    ? {
        nom: meaningful(contactSource.nom) ? contactSource.nom : null,
        email: meaningful(contactSource.email) ? contactSource.email : null,
        telephone: meaningful(contactSource.telephone) ? contactSource.telephone : null,
        telecopieur: meaningful(
          (contactSource as { telecopieur?: string | null }).telecopieur,
        )
          ? (contactSource as { telecopieur?: string | null }).telecopieur ?? null
          : null,
      }
    : null;
  const reserveAuxPme = pd?.reserveAuxPme ?? view.reserveAuxPme;
  const competitors = view.competitors ?? [];
  const winner = view.winner;
  const isAttribue = item.lifecycleStatus === 'attribue';
  const isInfructueux = item.lifecycleStatus === 'infructueux';
  const isCloture = item.lifecycleStatus === 'cloture';
  const hasResult = isAttribue || isInfructueux;
  const otherBidders = competitors.filter((c) => !c.isWinner);
  // Per-field DCE provenance — a value is "verified" only when the dossier
  // actually supplied THAT field (not when an extraction merely ran). Avoids
  // labelling AI-fallback figures as officially DCE-confirmed.
  const dc = view.dossierConditions;
  const budgetVerified = Boolean(view.budgetFromDossier);
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
          {hasSource ? <LiveParticipantsButton tenderId={item.id} /> : null}
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
                    {view.resultDate && (
                      <div className="col-span-2">
                        <dt className="text-xs text-faint">Date du résultat</dt>
                        <dd className="text-ink">{fmtDateTime(view.resultDate)}</dd>
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
                {view.estimationMad != null ? fmtMad(view.estimationMad) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Caution provisoire</dt>
              <dd className="font-mono font-semibold text-ink">
                {view.cautionProvisoireMad != null
                  ? fmtMad(view.cautionProvisoireMad)
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

          <div className="mt-4 flex flex-wrap gap-2">
            {hasSource && (
              <button
                type="button"
                onClick={() => setShowFiles('all')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-2 text-sm font-semibold text-paper transition hover:brightness-110"
              >
                <Icon name="documents" size={16} /> Voir le fichier source
              </button>
            )}
            <ActionButton
              href={hasSource ? `/api/tenders/${item.id}/dossier` : undefined}
              icon="download"
              label="Télécharger le dossier"
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
                {reserveAuxPme && (
                  <span className="inline-block rounded-full bg-emerald-soft px-2.5 py-0.5 text-xs font-medium text-emerald">
                    Réservé aux PME / TPE / coopératives
                  </span>
                )}
                <p className="text-sm leading-relaxed text-ink-2">
                  {view.aiResume ?? buildResume(view)}
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
                    value={view.estimationMad != null ? fmtMad(view.estimationMad) : '—'}
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
                    value={fmtPctOrDash(view.conditions?.cautionDefinitivePct)}
                    aiEstimated={!verifiedCautionDef}
                  />
                  <ConditionRow
                    label="Retenue de garantie"
                    value={fmtPctOrDash(view.conditions?.retenueGarantiePct)}
                    aiEstimated={!verifiedRetenue}
                  />
                  <ConditionRow
                    label="Délai de garantie"
                    value={fmtMoisOrDash(view.conditions?.delaiGarantieMois)}
                    aiEstimated={!verifiedDelaiGar}
                  />
                  {view.delaiExecutionMois != null && (
                    <ConditionRow
                      label="Délai d’exécution"
                      value={fmtMoisOrDash(view.delaiExecutionMois)}
                    />
                  )}
                  {view.chiffreAffairesMinMad != null && (
                    <ConditionRow
                      label="Chiffre d’affaires min. exigé"
                      value={fmtMad(view.chiffreAffairesMinMad)}
                    />
                  )}
                </div>

                {/* Fiche du portail — the block published openly on the
                    consultation page (harvested by the crawler, NO LLM). */}
                {pd && (
                  <div>
                    <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                      Fiche du portail
                      <span className="rounded bg-ink px-1 py-0.5 text-[9px] font-bold normal-case text-paper">
                        Portail
                      </span>
                    </h3>
                    <div>
                      {meaningful(pd.typeProcedure) && (
                        <ConditionRow
                          label="Procédure"
                          value={[pd.typeProcedure, pd.modePassation]
                            .filter(meaningful)
                            .join(' · ')}
                        />
                      )}
                      {meaningful(pd.domainesActivite) && (
                        <ConditionRow label="Domaine d’activité" value={pd.domainesActivite} />
                      )}
                      {meaningful(pd.lieuOuverturePlis) && (
                        <ConditionRow label="Ouverture des plis" value={pd.lieuOuverturePlis} />
                      )}
                      {meaningful(pd.adresseRetrait) && (
                        <ConditionRow label="Retrait des dossiers" value={pd.adresseRetrait} />
                      )}
                      {meaningful(pd.adresseDepot) && (
                        <ConditionRow label="Dépôt des offres" value={pd.adresseDepot} />
                      )}
                      {pd.prixAcquisitionPlansMad != null && (
                        <ConditionRow
                          label="Prix d’acquisition des plans"
                          value={fmtMad(pd.prixAcquisitionPlansMad)}
                        />
                      )}
                      {meaningful(pd.agrements) && (
                        <ConditionRow label="Agréments" value={pd.agrements} />
                      )}
                      {pd.variante != null && (
                        <ConditionRow label="Variante autorisée" value={pd.variante ? 'Oui' : 'Non'} />
                      )}
                      {meaningful(pd.reunion) && (
                        <ConditionRow label="Réunion" value={pd.reunion} />
                      )}
                    </div>
                    {pd.visites && pd.visites.length > 0 && (
                      <div className="mt-2 rounded-lg bg-sand/60 px-3 py-2">
                        <p className="mb-1 text-xs font-semibold text-muted">
                          Visite des lieux
                        </p>
                        <ul className="space-y-1 text-sm text-ink-2">
                          {pd.visites.map((v, i) => (
                            <li key={i}>
                              {[v.date, v.adresse].filter(meaningful).join(' — ')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

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

                {/* Conditions légales — datao "Conditions légales :" */}
                {view.conditionsLegales && view.conditionsLegales.length > 0 && (
                  <div>
                    <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                      Conditions légales
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold normal-case text-paper">
                        DCE
                      </span>
                    </h3>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2 marker:text-faint">
                      {view.conditionsLegales.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Contact administratif — portal-first (incl. télécopieur), DCE fallback. */}
                {contact &&
                  (contact.nom ||
                    contact.email ||
                    contact.telephone ||
                    contact.telecopieur) && (
                    <div>
                      <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                        Contact administratif
                        <span
                          className={`rounded px-1 py-0.5 text-[9px] font-bold normal-case text-paper ${
                            contactFromPortal ? 'bg-ink' : 'bg-emerald'
                          }`}
                        >
                          {contactFromPortal ? 'Portail' : 'DCE'}
                        </span>
                      </h3>
                      <div className="space-y-0.5 text-sm text-ink-2">
                        {contact.nom && (
                          <p className="font-medium text-ink">{contact.nom}</p>
                        )}
                        {contact.email && (
                          <a
                            href={`mailto:${contact.email}`}
                            className="block text-cyan hover:underline"
                          >
                            {contact.email}
                          </a>
                        )}
                        {contact.telephone && (
                          <a
                            href={`tel:${contact.telephone.replace(/\s+/g, '')}`}
                            className="block font-mono text-muted hover:text-ink"
                          >
                            {contact.telephone}
                          </a>
                        )}
                        {contact.telecopieur && (
                          <p className="font-mono text-muted">
                            Fax&nbsp;: {contact.telecopieur}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                {/* Autres — datao "Autres :" */}
                {view.autres && view.autres.length > 0 && (
                  <div>
                    <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint">
                      Autres
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold normal-case text-paper">
                        DCE
                      </span>
                    </h3>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2 marker:text-faint">
                      {view.autres.map((a, i) => (
                        <li key={i}>{a}</li>
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
                ) : detailLoading ? (
                  <p className="text-sm text-muted">Chargement du détail…</p>
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
                ) : detailLoading ? (
                  <p className="text-sm text-muted">Chargement du détail…</p>
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
                {hasSource && (
                  <button
                    type="button"
                    onClick={() => setShowFiles('bordereau')}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan hover:underline"
                  >
                    <Icon name="documents" size={15} /> Voir le fichier source
                    <Icon name="chevronRight" size={14} />
                  </button>
                )}
                {bpu.length > 0 ? (
                  <>
                    <p className="flex items-start gap-2 rounded-lg bg-emerald-soft/50 px-3 py-2 text-xs text-muted">
                      <span className="rounded bg-emerald px-1 py-0.5 text-[9px] font-bold text-paper">
                        DCE
                      </span>
                      Bordereau extrait du dossier de consultation officiel ({bpu.length}{' '}
                      poste{bpu.length > 1 ? 's' : ''}).
                    </p>
                    <div className="space-y-4">
                      {bpuGroups.map((group, gi) => (
                        <div key={`${gi}-${group.section ?? 'na'}`}>
                          {group.section && (
                            <h4 className="mb-1.5 inline-block rounded bg-cyan/15 px-2 py-1 text-xs font-bold text-ink ring-1 ring-cyan/30">
                              {group.section}
                            </h4>
                          )}
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
                                {group.rows.map((row, i) => (
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
                        </div>
                      ))}
                    </div>
                  </>
                ) : detailLoading ? (
                  <p className="text-sm text-muted">Chargement du détail…</p>
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
      {showFiles !== 'none' && (
        <SourceFileViewer
          tenderId={item.id}
          onClose={() => setShowFiles('none')}
          mode={showFiles === 'bordereau' ? 'side' : 'modal'}
          bordereauOnly={showFiles === 'bordereau'}
        />
      )}
    </div>
  );
}
