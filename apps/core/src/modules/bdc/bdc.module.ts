// Module Bons de commande (/bdc) — veille des avis d'achat par bon de commande
// du portail PMMP + l'espace de chiffrage de l'agent chargé. Routes /api/bdc/*.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { BrainModule } from '../brain/brain.module';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import { appliquerPropositions, proposerPrixPourLignes } from './bdc-pricing.domain';
import { BdcCrawler } from './bdc.crawler';
import { BdcSyncService } from './bdc.sync';
import {
  BDC_REPOSITORY,
  DrizzleBdcRepository,
  unavailableBdcRepository,
  type BdcRepository,
} from './bdc.repository';
import type { PriceEvidenceAdapter } from './pricing/bdc-evidence.types';
import { BdcInternalEvidenceAdapter } from './pricing/bdc-internal-evidence';
import { BdcLineAnalyzer } from './pricing/bdc-line-analyzer';
import { BdcPricingController } from './pricing/bdc-pricing.controller';
import {
  DrizzleBdcPricingRepository,
  InMemoryBdcPricingRepository,
  BDC_PRICING_REPOSITORY,
  type BdcPricingRepository,
} from './pricing/bdc-pricing.repository';
import { BdcPricingLearning } from './pricing/bdc-pricing-learning';
import {
  BDC_INTERNAL_EVIDENCE,
  BDC_PRICING_NORMALIZATION_POLICY,
  BDC_WEB_EVIDENCE,
  BdcPricingService,
} from './pricing/bdc-pricing.service';
import {
  bdcPricingQueueProvider,
  BdcPricingWorker,
} from './pricing/bdc-pricing.worker';
import {
  BraveSearchClient,
  MoroccanWebPriceAdapter,
  SafePricePageFetcher,
} from './pricing/bdc-web-evidence';

const MARCHES_ROLES = ['direction', 'marches', 'admin-si'] as const;
const BDC_QUEUE_NAME = 'bdc';
const BDC_QUEUE = Symbol('BDC_QUEUE');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

const ligneSchema = z.object({
  idx: z.number().int().min(0),
  designation: z.string().max(2000),
  unite: z.string().max(40).nullish(),
  quantite: z.number().nonnegative().max(1_000_000_000),
  tvaPct: z.number().min(0).max(100),
  prixUnitaireHt: z.number().min(0).max(1_000_000_000),
  source: z.enum(['manuel', 'catalogue', 'historique', 'estimation', 'agent']),
  sourceRef: z.string().max(200).nullish(),
  margeAppliquee: z.boolean().optional(),
  note: z.string().max(1000).nullish(),
});

const reponsePatchSchema = z
  .object({
    margePct: z.number().min(0).max(1000),
    lignes: z.array(ligneSchema).max(500),
    statut: z.enum(['brouillon', 'prete', 'deposee', 'gagnee', 'perdue']),
    notes: z.string().max(4000),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Aucun champ à modifier' });

// Candidats de prix externes (catalogue fournisseurs côté web) — le core
// garde le matching et la sauvegarde (source de vérité).
const candidateSchema = z.object({
  designation: z.string().min(3).max(400),
  unite: z.string().max(40).nullish(),
  prixHt: z.number().positive().max(100_000_000),
  source: z.enum(['catalogue', 'historique']),
  sourceRef: z.string().min(1).max(200),
});

const proposerSchema = z.object({
  candidatesExtra: z.array(candidateSchema).max(2000).optional(),
  minScore: z.number().min(0.2).max(0.95).optional(),
});

@Controller('bdc')
export class BdcController {
  private readonly logger = new Logger('Bdc');

  constructor(
    @Inject(BDC_REPOSITORY) private readonly repo: BdcRepository,
    @Inject(BdcSyncService)
    private readonly sync: BdcSyncService,
  ) {}

  @Get('avis')
  async listAvis(
    @Query('statut') statut?: string,
    @Query('categorie') categorie?: string,
    @Query('search') search?: string,
    @Query('aVenir') aVenir?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitStr) || 20));
    const [{ items, total }, stats] = await Promise.all([
      this.repo.listAvis({
        statut: statut || undefined,
        categorie: categorie || undefined,
        search: search || undefined,
        aVenirSeulement: aVenir === '1' || aVenir === 'true',
        page,
        limit,
      }),
      this.repo.stats(),
    ]);
    return { items, total, page, limit, stats };
  }

  @Get('avis/:id')
  async getAvis(@Param('id') id: string) {
    const avis = await this.repo.getAvis(id);
    if (!avis) throw new NotFoundException('Avis introuvable');
    const reponse = await this.repo.getReponse(id);
    return { avis, reponse };
  }

  /** Espace de chiffrage — crée la réponse au besoin (seed depuis articles). */
  @Roles(...MARCHES_ROLES)
  @Post('avis/:id/reponse')
  async ensureReponse(@Param('id') id: string) {
    const avis = await this.repo.getAvis(id);
    if (!avis) throw new NotFoundException('Avis introuvable');
    return this.repo.ensureReponse(id);
  }

  @Roles(...MARCHES_ROLES)
  @Patch('avis/:id/reponse')
  async saveReponse(@Param('id') id: string, @Body() body: unknown) {
    const parsed = reponsePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.repo.saveReponse(id, parsed.data);
    if (!updated) throw new NotFoundException('Avis introuvable');
    return updated;
  }

  /**
   * Chiffrage automatique — rapproche chaque article NON chiffré des prix
   * connus: historique société (BPU marchés, devis, réponses BDC) collecté en
   * base + candidats catalogue envoyés par le web. Ne touche jamais un prix
   * déjà saisi; le résultat est sauvegardé (recalcul des totaux côté core).
   */
  @Roles(...MARCHES_ROLES)
  @Post('avis/:id/proposer')
  async proposer(@Param('id') id: string, @Body() body: unknown) {
    const parsed = proposerSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const avis = await this.repo.getAvis(id);
    if (!avis) throw new NotFoundException('Avis introuvable');
    const reponse = await this.repo.ensureReponse(id);

    const historique = await this.repo.collectPriceCandidates(id);
    const candidates = [...historique, ...(parsed.data.candidatesExtra ?? [])];
    const propositions = proposerPrixPourLignes(
      reponse.lignes,
      avis.articles,
      candidates,
      parsed.data.minScore,
    );
    const lignes = appliquerPropositions(reponse.lignes, propositions);
    const saved = await this.repo.saveReponse(id, { lignes });
    if (!saved) throw new NotFoundException('Avis introuvable');

    const parSource = (source: string) =>
      propositions.filter((p) => p.source === source).length;
    const resume = {
      proposees: propositions.length,
      catalogue: parSource('catalogue'),
      historique: parSource('historique'),
      restantes: saved.lignes.filter((l) => l.prixUnitaireHt <= 0).length,
      candidatsInternes: historique.length,
      candidatsCatalogue: parsed.data.candidatesExtra?.length ?? 0,
    };
    this.logger.log(
      `BDC proposer ${avis.reference}: ${resume.proposees} prix (${resume.catalogue} catalogue, ${resume.historique} historique), ${resume.restantes} restants`,
    );
    return { reponse: saved, resume, propositions };
  }

  /** Génère le bordereau de prix rempli (XLSX) — le devis de la société. */
  @Roles(...MARCHES_ROLES)
  @Get('avis/:id/bordereau.xlsx')
  async bordereau(@Param('id') id: string): Promise<StreamableFile> {
    const avis = await this.repo.getAvis(id);
    if (!avis) throw new NotFoundException('Avis introuvable');
    const reponse = await this.repo.ensureReponse(id);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — AGHA RM INFRA';
    const ws = wb.addWorksheet('Bordereau des prix');
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = `Bon de commande ${avis.reference} — ${avis.acheteur}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = avis.objet;
    ws.getCell('A2').font = { italic: true, size: 10 };

    const header = ws.addRow([
      'N°',
      'Désignation',
      'Unité',
      'Qté',
      'P.U. HT (DH)',
      'Montant HT (DH)',
    ]);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3357' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    for (const ligne of reponse.lignes) {
      const row = ws.addRow([
        ligne.idx + 1,
        ligne.designation,
        ligne.unite ?? '',
        ligne.quantite,
        ligne.prixVenteHt,
        ligne.montantHt,
      ]);
      row.getCell(5).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
    }
    const totalHtRow = ws.addRow(['', '', '', '', 'Total HT', reponse.totalHt]);
    const totalTvaRow = ws.addRow(['', '', '', '', 'TVA', reponse.totalTva]);
    const totalTtcRow = ws.addRow(['', '', '', '', 'Total TTC', reponse.totalTtc]);
    for (const row of [totalHtRow, totalTvaRow, totalTtcRow]) {
      row.getCell(5).font = { bold: true };
      row.getCell(6).font = { bold: true };
      row.getCell(6).numFmt = '#,##0.00';
    }
    ws.columns = [
      { width: 6 },
      { width: 60 },
      { width: 10 },
      { width: 10 },
      { width: 16 },
      { width: 18 },
    ];

    const safe = avis.reference.replace(/[^\w-]+/g, '_');
    const buffer = await wb.xlsx.writeBuffer();
    return new StreamableFile(Buffer.from(buffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="bordereau_bdc_${safe}.xlsx"`,
    });
  }

  /** Résultats miroir (intelligence concurrents) — liste + stats. */
  @Get('resultats')
  async listResultats(
    @Query('search') search?: string,
    @Query('acheteur') acheteur?: string,
    @Query('issue') issue?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitStr) || 20));
    const [{ items, total }, stats] = await Promise.all([
      this.repo.listResultats({
        search: search || undefined,
        acheteur: acheteur || undefined,
        issue: issue || undefined,
        page,
        limit,
      }),
      this.repo.statsResultats(),
    ]);
    return { items, total, page, limit, stats };
  }

  /** Le dossier d'un acheteur: médiane, fourchette, gagnants récurrents. */
  @Get('intelligence')
  async intelligence(@Query('acheteur') acheteur?: string) {
    if (!acheteur || acheteur.trim().length < 3) {
      throw new BadRequestException('Paramètre `acheteur` requis');
    }
    return this.repo.intelligenceAcheteur(acheteur.trim());
  }

  /** Balayage manuel: liste + détails manquants + résultats récents. */
  @Roles(...MARCHES_ROLES)
  @Post('sweep')
  async sweep(@Body() body: unknown) {
    const parsed = z
      .object({
        pages: z.number().int().min(1).max(50).optional(),
        details: z.number().int().min(0).max(60).optional(),
        resultats: z.number().int().min(0).max(60).optional(),
      })
      .safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.sync.run(parsed.data);
  }
}

export const bdcRepositoryProvider = {
  provide: BDC_REPOSITORY,
  useFactory: (): BdcRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBdcRepository(getDb(url));
    new Logger('BdcModule').warn('DATABASE_URL not set — BdcRepository unavailable');
    return unavailableBdcRepository<BdcRepository>('BdcRepository');
  },
};

const bdcCrawlerProvider = {
  provide: BdcCrawler,
  useFactory: () => new BdcCrawler(),
};

const bdcQueueProvider = {
  provide: BDC_QUEUE,
  useFactory: () => new Queue(BDC_QUEUE_NAME, { connection: redisConnection() }),
};

const bdcPricingRepositoryProvider = {
  provide: BDC_PRICING_REPOSITORY,
  useFactory: (): BdcPricingRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBdcPricingRepository(getDb(url));
    new Logger('BdcModule').warn(
      'DATABASE_URL not set — autonomous pricing uses volatile memory',
    );
    return new InMemoryBdcPricingRepository();
  },
};

const bdcLineAnalyzerProvider = {
  provide: BdcLineAnalyzer,
  inject: [LLM_CLIENT],
  useFactory: (llm: LlmClient | null) => new BdcLineAnalyzer(llm),
};

const bdcInternalEvidenceProvider = {
  provide: BDC_INTERNAL_EVIDENCE,
  inject: [BDC_REPOSITORY],
  useFactory: (repository: BdcRepository): PriceEvidenceAdapter =>
    new BdcInternalEvidenceAdapter(repository),
};

const bdcWebEvidenceProvider = {
  provide: BDC_WEB_EVIDENCE,
  useFactory: (): PriceEvidenceAdapter => {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
    const allowHosts = (process.env.BDC_PRICE_SOURCE_DOMAINS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!apiKey || allowHosts.length === 0) {
      new Logger('BdcModule').warn(
        'Market price search disabled — configure BRAVE_SEARCH_API_KEY and BDC_PRICE_SOURCE_DOMAINS',
      );
      return { search: async () => [] };
    }
    return new MoroccanWebPriceAdapter(
      new BraveSearchClient(apiKey),
      new SafePricePageFetcher({
        allowHosts,
        timeoutMs:
          Number(process.env.BDC_PRICE_FETCH_TIMEOUT_MS) || 12_000,
      }),
    );
  },
};

const bdcPricingNormalizationProvider = {
  provide: BDC_PRICING_NORMALIZATION_POLICY,
  useFactory: () => ({
    now: new Date(),
    defaultTvaPct: 20,
    annualInflationPct: Number(process.env.BDC_PRICE_ANNUAL_INFLATION_PCT) || 0,
    regionMultipliers: {},
    maxAgeDays: Number(process.env.BDC_PRICE_MAX_AGE_DAYS) || 1_095,
  }),
};

const bdcPricingLearningProvider = {
  provide: BdcPricingLearning,
  inject: [BDC_PRICING_REPOSITORY],
  useFactory: (repository: BdcPricingRepository) =>
    new BdcPricingLearning(repository, {
      minSegmentSamples:
        Number(process.env.BDC_PRICING_MIN_SEGMENT_SAMPLES) || 20,
      historyDays: Number(process.env.BDC_PRICING_HISTORY_DAYS) || 1_095,
    }),
};

@Module({
  imports: [BrainModule],
  controllers: [BdcController, BdcPricingController],
  providers: [
    bdcRepositoryProvider,
    bdcCrawlerProvider,
    BdcSyncService,
    bdcQueueProvider,
    bdcPricingRepositoryProvider,
    bdcLineAnalyzerProvider,
    bdcInternalEvidenceProvider,
    bdcWebEvidenceProvider,
    bdcPricingNormalizationProvider,
    bdcPricingLearningProvider,
    bdcPricingQueueProvider,
    BdcPricingService,
    BdcPricingWorker,
  ],
  exports: [bdcRepositoryProvider, BdcPricingService],
})
export class BdcModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BdcModule');
  private worker: Worker | null = null;

  constructor(
    @Inject(BdcSyncService)
    private readonly sync: BdcSyncService,
    @Inject(BDC_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // The API process remains responsive; only the dedicated worker polls the
    // public portal and writes the mirror.
    if (process.env.WATCH_WORKER_ENABLED !== 'true') {
      this.logger.log('BDC worker DISABLED — this is an API-only process');
      return;
    }
    this.worker = new Worker(
      BDC_QUEUE_NAME,
      async () => this.sync.run(),
      { connection: redisConnection(), lockDuration: 15 * 60 * 1000 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`BDC job ${job?.id} failed: ${error.message}`),
    );
    const cron = process.env.BDC_CRON ?? '*/15 * * * *';
    await this.queue.upsertJobScheduler('bdc-schedule', { pattern: cron });
    // Do not make a fresh deployment wait for the next cron boundary.
    await this.queue.add(
      'sweep',
      { trigger: 'startup' },
      { removeOnComplete: 20, removeOnFail: 20 },
    );
    this.logger.log(`BDC synchronisation planifiée: ${cron}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
