import { parsePmmpDeadline } from '@atlas/contracts';
import { conflictingPortalDeadline, type TenderItem } from './tenders';

export interface DecisionCheck {
  key: string;
  label: string;
  verified: boolean;
  source: 'portail' | 'DCE' | 'catalogue' | null;
}

const usable = (s: string | null | undefined) => {
  const text = s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return !!text && !/^[-–—.\s]+$/.test(text) && !/^(champs?\s*vide|neant|n\/?a|non renseigne|non precise)$/.test(text);
};

/** Evidence checklist, not an eligibility/award prediction. No AI dependency. */
export function buildTenderDecision(item: TenderItem, now = new Date()) {
  const pd = item.portalDetail;
  const conflict = conflictingPortalDeadline(item);
  const deadline = Math.min(Date.parse(item.deadlineAt), conflict?.getTime() ?? Infinity);
  const hoursLeft = (deadline - now.getTime()) / 3_600_000;
  const hasResult = item.lifecycleStatus === 'attribue' || item.lifecycleStatus === 'infructueux';
  const closed = hasResult || (!conflict && (hoursLeft <= 0 || item.lifecycleStatus !== 'en_cours'));
  const prospectusText = pd?.prospectus?.trim();
  const publishedProspectus = prospectusText && usable(prospectusText) ? prospectusText : null;
  const prospectusDeadline = publishedProspectus ? parsePmmpDeadline(publishedProspectus) : null;
  const prospectusHours = prospectusDeadline ? (prospectusDeadline.getTime() - now.getTime()) / 3_600_000 : null;
  const prospectus = publishedProspectus ? {
    published: publishedProspectus,
    deadline: prospectusDeadline,
    status: prospectusHours === null ? 'unconfirmed' : prospectusHours <= 0 ? 'elapsed'
      : prospectusHours <= 72 ? 'urgent' : 'upcoming',
  } : null;
  const text = `${item.objet} ${pd?.domainesActivite ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const relevant = /hydrauli|assainissement|adduction|eau potable|irrigation|voirie|routier|routes|construction|amenagement|terrassement|genie civil|ouvrages|تشييد|تهيئة|طرقات|الماء|بناء/.test(text);
  const participation = usable(pd?.qualifications) || usable(pd?.agrements) ||
    (!!item.dossierExtractedAt && !!item.qualifications?.length);
  const architectural = item.procedure === 'consultation_architecturale' || item.procedure === 'concours_architectural';
  const fitsWorks = relevant && item.category === 'Travaux' && !architectural;
  const checks: DecisionCheck[] = [
    { key: 'budget', label: 'Estimation', verified: item.estimationMad != null,
      source: pd?.estimationMad != null ? 'portail' : item.budgetFromDossier ? 'DCE' : item.estimationMad != null ? 'catalogue' : null },
    { key: 'caution', label: 'Caution provisoire', verified: item.cautionProvisoireMad != null,
      source: pd?.cautionProvisoireMad != null ? 'portail' : item.cautionProvisoireMad != null ? 'catalogue' : null },
    { key: 'location', label: "Lieu d'exécution", verified: usable(item.location) || usable(pd?.location),
      source: usable(pd?.location) ? 'portail' : usable(item.location) ? 'catalogue' : null },
    { key: 'participation', label: 'Conditions de participation', verified: participation,
      source: usable(pd?.qualifications) || usable(pd?.agrements) ? 'portail' : participation ? 'DCE' : null },
    { key: 'dossier', label: 'Dossier analysé', verified: !!item.dossierExtractedAt,
      source: item.dossierExtractedAt ? 'DCE' : null },
    { key: 'bpu', label: 'Bordereau exploitable', verified: !!item.hasBpu || !!item.bpu?.length,
      source: item.hasBpu || item.bpu?.length ? 'DCE' : null },
  ];
  const missing = checks.filter((check) => !check.verified).map((check) => check.label);
  const prospectusNeedsVerification = prospectus?.status === 'elapsed' || prospectus?.status === 'unconfirmed';
  const archiveNeedsVerification = item.samirReview?.documents.integrity === 'mismatch' ||
    item.samirReview?.documents.integrity === 'unavailable';
  const complementNeedsVerification = item.samirReview?.documents.complement?.state === 'listed';
  const decision: 'closed' | 'verify' | 'review' = closed ? 'closed'
    : conflict || prospectusNeedsVerification || complementNeedsVerification || archiveNeedsVerification || missing.length ? 'verify' : 'review';
  const prospectusActions = prospectus
    ? ['Vérifier les modalités de remise des prospectus ou échantillons sur le portail et dans le règlement de consultation.']
    : [];
  const complementActions = complementNeedsVerification
    ? ['Ouvrir le complément sur le portail et vérifier son effet sur les conditions et les échéances.'] : [];
  const archiveActions = archiveNeedsVerification ? ['Vérifier de nouveau le DCE enregistré auprès de la source officielle.'] : [];
  const nextActions = closed ? ['Consulter les résultats et les enseignements de cette consultation.']
    : conflict ? ['Vérifier l’échéance auprès du portail avant de décider ou de planifier le dépôt.', ...archiveActions, ...complementActions, ...prospectusActions] : [
    ...archiveActions,
    ...complementActions,
    ...prospectusActions,
    ...(missing.includes('Conditions de participation') ? ['Lire le règlement de consultation et vérifier les qualifications et agréments exigés.'] : ['Comparer les conditions publiées avec les capacités et attestations de l’entreprise.']),
    ...(!item.dossierExtractedAt ? ['Ouvrir les pièces du DCE pour confirmer les prestations et les conditions.'] : []),
    ...(pd?.visites?.length ? ['Vérifier les dates et le caractère obligatoire des visites avant de décider.'] : []),
    ...(item.estimationMad != null ? ['Chiffrer les coûts, la mobilisation et la trésorerie avant le Go / No-Go.'] : ['Confirmer le budget et la trésorerie à mobiliser.']),
  ];
  return {
    decision, urgent: !closed && hoursLeft > 0 && hoursLeft <= 72,
    prospectus,
    fit: fitsWorks ? 'relevant' as const : 'check' as const,
    fitReason: fitsWorks
      ? 'Le libellé correspond aux travaux de construction ou d’infrastructure suivis par AGHA.'
      : 'Vérifier la spécialité et les moyens nécessaires avant de retenir cette opportunité.',
    checks, missing, verifiedCount: checks.filter((check) => check.verified).length,
    visits: pd?.visites ?? [], nextActions,
    requirements: [pd?.qualifications, pd?.agrements].filter(usable).join(' · '),
    detailFetchedAt: pd?.fetchedAt ?? null,
  };
}
