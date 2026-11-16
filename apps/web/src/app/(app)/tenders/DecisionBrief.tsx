import { buildTenderDecision } from '@/lib/tender-decision';
import { fmtDateTime, safeHttpUrl } from '@/lib/tenders';
import type { SamirReview, TenderItem } from '@/lib/tenders';
import { DceDecisionExcerpts } from './DceDecisionExcerpts';

const LABELS = { closed: 'Échéance passée', verify: 'À vérifier avant décision', review: 'Prêt pour étude Go / No-Go' };

const SAMIR_SOURCE = {
  no_official_source: 'Lien officiel introuvable',
  missing_snapshot: 'Fiche du portail à vérifier',
  mismatched_snapshot: 'La fiche enregistrée correspond à un autre identifiant',
  matched_snapshot: 'Identifiant confirmé sur la fiche enregistrée',
};
const SAMIR_CHECKS = { deadline: 'Échéance', caution: 'Caution', estimate: 'Estimation' };
const SAMIR_CHECK_STATUS = { matched: 'concorde', conflict: 'écart à vérifier', unverified: 'à confirmer' };
const SAMIR_DOCUMENTS = {
  not_cached: 'DCE à obtenir',
  unavailable: 'Vérification de l’archive indisponible',
  missing_object: 'Archive introuvable dans le stockage',
  available: 'Archive DCE présente',
};

function SamirEvidence({ review }: { review: SamirReview }) {
  return <section aria-label="Vérification Samir" className="mt-3 border-t border-line pt-3 text-xs">
    <h4 className="font-semibold text-ink">Samir · Contrôle du radar</h4>
    <p className={`mt-1 ${review.source.state === 'mismatched_snapshot' ? 'font-semibold text-clay' : 'text-muted'}`}>
      {SAMIR_SOURCE[review.source.state]}{review.source.identity && <> · {review.source.identity}</>}
    </p>
    {review.source.observedAt && <p className="mt-1 text-faint">Lecture du portail le {fmtDateTime(review.source.observedAt)}</p>}
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {(Object.keys(SAMIR_CHECKS) as (keyof typeof SAMIR_CHECKS)[]).map((key) =>
        <li key={key} className={review.checks[key] === 'conflict' ? 'font-semibold text-clay' : 'text-muted'}>
          {SAMIR_CHECKS[key]} · {SAMIR_CHECK_STATUS[review.checks[key]]}
        </li>)}
    </ul>
    <p className="mt-2 text-muted">
      {SAMIR_DOCUMENTS[review.documents.state]}
      {review.documents.state === 'available' && <>{review.documents.currentRevision === 'confirmed_as_of'
        ? ' · Comparée à la version officielle' : ' · Version officielle à confirmer'}</>}
    </p>
    {review.documents.state === 'available' && review.documents.cachedAt &&
      <p className="mt-1 break-words text-faint">{review.documents.filename} · archivé le {fmtDateTime(review.documents.cachedAt)}</p>}
    {review.documents.integrity === 'mismatch' &&
      <p className="mt-1 font-semibold text-clay">L’archive enregistrée a changé depuis la comparaison · Nouveau contrôle requis</p>}
    {review.documents.integrity === 'unavailable' &&
      <p className="mt-1 text-muted">Intégrité de l’archive enregistrée à vérifier</p>}
    {review.documents.complement && <p className={`mt-1 ${review.documents.complement.state === 'listed' ? 'font-semibold text-clay' : 'text-muted'}`}>
      {review.documents.complement.state === 'listed'
        ? 'Complément signalé sur le portail · À vérifier séparément'
        : 'Aucun lien de complément affiché sur la fiche publique'}
      {' · '}{fmtDateTime(review.documents.complement.observedAt)}
    </p>}
    {review.documents.revision && <p className="mt-1 text-faint">
      {review.documents.revision.state === 'unavailable' ? 'Vérification de version indisponible le ' : 'Comparaison effectuée le '}
      {fmtDateTime(review.documents.revision.checkedAt)}
    </p>}
  </section>;
}

export function DecisionBrief({ item }: { item: TenderItem }) {
  const brief = buildTenderDecision(item);
  const sourceUrl = safeHttpUrl(item.sourceUrl);
  return (
    <section aria-label="Aide à la décision" className="rounded-xl border border-line bg-paper-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">En un regard</h3>
        <span className="rounded-full bg-sand px-2.5 py-1 text-xs font-medium text-ink">{LABELS[brief.decision]}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{brief.fitReason}</p>
      {item.portalDetail?.publishedAt && <p className="mt-2 text-xs text-muted">Publication sur le portail : {item.portalDetail.publishedAt}</p>}
      {item.portalDetail?.responseMode && <p className="mt-1 text-xs text-ink-2">{item.portalDetail.responseMode}</p>}
      {brief.detailFetchedAt && <p className="mt-1 text-[10px] text-faint">Fiche vérifiée le {fmtDateTime(brief.detailFetchedAt)}</p>}
      {brief.urgent && <p className="mt-2 text-xs font-semibold text-clay">Moins de 72 h avant la remise des plis.</p>}
      {brief.prospectus && <p className={`mt-2 text-xs font-semibold ${brief.decision !== 'closed' && brief.prospectus.status !== 'upcoming' ? 'text-clay' : 'text-ink-2'}`}>
        Échéance prospectus / échantillons · {brief.prospectus.deadline
          ? fmtDateTime(brief.prospectus.deadline.toISOString())
          : `Date à confirmer (${brief.prospectus.published})`}
        {brief.decision !== 'closed' && brief.prospectus.status === 'urgent' ? ' · 72 h ou moins' : ''}
        {brief.decision !== 'closed' && brief.prospectus.status === 'elapsed' ? ' · Date passée, vérifier les modalités' : ''}
      </p>}
      {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-cyan underline underline-offset-2">
        Ouvrir l’avis officiel
      </a>}
      <p className="mt-3 text-xs font-medium text-ink">{brief.verifiedCount} / {brief.checks.length} informations disponibles</p>
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {brief.checks.map((check) => <div key={check.key} className="flex items-center justify-between gap-2 text-xs">
          <span className={check.verified ? 'text-ink-2' : 'text-muted'}>{check.verified ? '✓' : '○'} {check.label}</span>
          <span className="text-[10px] text-faint">{check.source ?? 'À confirmer'}</span>
        </div>)}
      </div>
      {brief.requirements && <p className="mt-3 text-xs text-ink-2"><span className="font-semibold">Exigences publiées : </span>{brief.requirements}</p>}
      {brief.visits.length > 0 && <div className="mt-3 border-t border-line pt-2 text-xs text-ink-2">
        <span className="font-semibold">Visites des lieux</span>
        {brief.visits.map((visit, index) => <p key={index} className="mt-1">{visit.date ?? 'Date à confirmer'} · {visit.adresse ?? 'Adresse à confirmer'}</p>)}
      </div>}
      <ol className="mt-3 list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted">
        {brief.nextActions.map((action) => <li key={action}>{action}</li>)}
      </ol>
      {item.samirReview && <SamirEvidence review={item.samirReview} />}
      {item.samirReview?.documents.state === 'available' && <DceDecisionExcerpts key={`${item.id}/${item.updatedAt}`} tenderId={item.id} />}
    </section>
  );
}
