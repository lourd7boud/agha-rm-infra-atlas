// Synchronisation automatique et manuelle du miroir BDC.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { nextPmmpOpening, PmmpClosedError } from '../../lib/pmmp-hours';
import { BdcCrawler } from './bdc.crawler';
import { BDC_REPOSITORY, type BdcRepository } from './bdc.repository';

export interface BdcSweepOptions {
  pages?: number;
  details?: number;
  resultats?: number;
}

export interface BdcSweepResult {
  pages: number;
  inserted: number;
  updated: number;
  details: number;
  resultatsInseres: number;
  resultatsPages: number;
  portalReopensAt?: Date;
}

const positiveInt = (value: number | undefined, fallback: number): number =>
  Number.isInteger(value) && value! > 0 ? value! : fallback;

const envInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

/** Runs one bounded, idempotent portal sweep. */
@Injectable()
export class BdcSyncService {
  private readonly logger = new Logger(BdcSyncService.name);

  constructor(
    @Inject(BDC_REPOSITORY)
    private readonly repo: BdcRepository,
    @Inject(BdcCrawler)
    private readonly crawler: BdcCrawler,
  ) {}

  async run(options: BdcSweepOptions = {}): Promise<BdcSweepResult> {
    const result: BdcSweepResult = {
      pages: 0, inserted: 0, updated: 0, details: 0, resultatsInseres: 0, resultatsPages: 0,
    };
    const reopening = nextPmmpOpening();
    if (reopening) return { ...result, portalReopensAt: reopening };

    const maxPages = positiveInt(options.pages, envInt('BDC_SWEEP_PAGES', 5));
    const maxDetails = Number.isInteger(options.details) && options.details! >= 0
      ? options.details!
      : envInt('BDC_SWEEP_DETAILS', 30);
    const maxResultats = Number.isInteger(options.resultats) && options.resultats! >= 0
      ? options.resultats!
      : envInt('BDC_SWEEP_RESULTATS', 3);

    try {
      for await (const { liste } of this.crawler.crawlListe(maxPages)) {
        result.pages += 1;
        if (liste.items.length === 0) break;
        const stored = await this.repo.upsertAvisFromListe(
          liste.items.map((item) => ({
            portalId: item.portalId,
            reference: item.reference,
            objet: item.objet,
            acheteur: item.acheteur,
            statut: item.statut,
            datePublication: null,
            dateLimite: item.dateLimite,
            lieu: item.lieu,
          })),
        );
        result.inserted += stored.inserted;
        result.updated += stored.updated;
      }

      const pending = await this.repo.avisSansDetail(maxDetails);
      if (pending.length > 0) {
        const byPortal = await this.crawler.fetchDetailsBatch(pending.map((item) => item.portalId));
        for (const [portalId, detail] of byPortal) {
          await this.repo.saveAvisDetail(portalId, {
            categorie: detail.categorie,
            naturePrestation: detail.naturePrestation,
            pieces: detail.pieces,
            articles: detail.articles,
            datePublication: detail.datePublication,
            dateLimite: detail.dateLimite,
          });
          result.details += 1;
        }
      }
      if (maxResultats > 0) {
        for await (const { resultats } of this.crawler.crawlResultats(maxResultats)) {
          result.resultatsPages += 1;
          if (resultats.items.length === 0) break;
          result.resultatsInseres += await this.repo.upsertResultats(resultats.items);
        }
        await this.repo.linkResultatsToAvis();
      }
    } catch (error) {
      if (!(error instanceof PmmpClosedError)) throw error;
      return { ...result, portalReopensAt: error.portalReopensAt };
    }

    const endedDuringClosure = nextPmmpOpening();
    if (endedDuringClosure) return { ...result, portalReopensAt: endedDuringClosure };
    this.logger.log(
      `BDC sweep: ${result.pages} pages, +${result.inserted} avis, ${result.details} détails, +${result.resultatsInseres} résultats (${result.resultatsPages} p.)`,
    );
    return result;
  }
}
