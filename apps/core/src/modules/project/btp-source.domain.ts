import { createHash } from 'node:crypto';
import { readDossierExtraction } from '../tender/dossier-extraction';
import { hasMismatchedPortalDetail } from '../tender/samir-review';
import type { TenderRecord } from '../tender/tender.repository';

/** A review proposal from persisted sources, never an awarded contract. */
export function buildBtpProjectSource(tender: TenderRecord) {
  if (hasMismatchedPortalDetail(tender.sourceUrl, tender.raw)) {
    throw new Error('Identité de la fiche source contradictoire — revoir la consultation.');
  }
  const extraction = readDossierExtraction(tender.raw);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(tender.deadlineAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  const seed = {
    tenderId: tender.id,
    reference: tender.reference,
    objet: tender.objet,
    buyerName: tender.buyerName,
    commune: tender.location ?? null,
    procedure: tender.procedure,
    dateLimite: `${part('year')}-${part('month')}-${part('day')}`,
    sourceUrl: tender.sourceUrl ?? null,
    sourceFiles: extraction?.sourceFiles ?? [],
    delaiMois: extraction?.delaiExecutionMois && extraction.delaiExecutionMois > 0
      ? extraction.delaiExecutionMois : null,
    cautionProvisoireMad: tender.cautionProvisoireMad ?? extraction?.cautionProvisoireMad ?? null,
    cautionDefinitivePct: extraction?.cautionDefinitivePct ?? null,
    retenueGarantiePct: extraction?.retenueGarantiePct ?? null,
    bpu: (extraction?.bpu ?? []).map((line, index) => ({
      numero: index + 1, designation: line.designation,
      unite: line.unite ?? null,
      quantite: typeof line.quantite === 'number' && line.quantite >= 0 ? line.quantite : null,
      // Blank tender estimates frequently encode unavailable bid prices as zero.
      prixUnitaire: typeof line.prixUnitaireMad === 'number' && line.prixUnitaireMad > 0 ? line.prixUnitaireMad : null,
    })),
  };
  // Only reviewed facts invalidate a proposal. Watcher timestamps and a repeat
  // extraction of the same facts must not send the user through review again.
  const sourceVersion = createHash('sha256').update(JSON.stringify({
    ...seed, sourceFiles: [...new Set(seed.sourceFiles)].sort(),
  })).digest('hex');
  return {
    ...seed,
    sourceVersion,
    sourceUpdatedAt: tender.updatedAt.toISOString(),
    extractedAt: extraction?.extractedAt ?? null,
  };
}
