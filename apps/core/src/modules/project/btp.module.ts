// Module Projets BTP — the marché-de-travaux execution system rebuilt natively
// from the source construction-management app. Routes live under /api/btp/*;
// the legacy chantier surface (/api/project/*) is untouched.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { VaultModule } from '../vault/vault.module';
import {
  BTP_EXECUTION_REPOSITORY,
  type BtpExecutionRepository,
  type BtpProjectRecord,
} from './btp.repository';
import { BTP_REGISTRES_REPOSITORY, type BtpRegistresRepository } from './btp-registres.repository';
import { BTP_ASSETS_REPOSITORY, type BtpAssetsRepository } from './btp-assets.repository';
import { BtpRepositoryModule } from './btp-repository.module';
import { BtpAssetsController, BtpRegistresController } from './btp-registres.controller';
import { BtpExportService } from './btp-export.service';
import { toHttp, WRITE_ROLES } from './btp-http.helpers';
import { computeDelaiInfo } from './btp-registres.domain';
import { calculateDecompteRevision, type IndexValues } from './btp-revision.domain';
import { round2, toDecimal, toNumber } from './btp-finance.domain';
import { BtpEntrepriseController, BtpTerrainController } from './btp-terrain.controller';
import {
  MODES_OBTENTION,
  NOTRE_ENTREPRISE,
  parseAcquisition,
  type ModeObtention,
} from './btp-terrain.domain';

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const arretSchema = z.object({
  id: z.string().optional(),
  dateArret: z.string().min(8),
  dateReprise: z.string().nullish(),
  motif: z.string().max(500).nullish(),
});

const ficheSchema = z.object({
  reference: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  objet: z.string().max(4000).optional(),
  buyerName: z.string().max(300).optional(),
  annee: z.string().max(10).optional(),
  societe: z.string().max(300).optional(),
  commune: z.string().max(200).optional(),
  typeMarche: z.enum(['normal', 'negocie']).optional(),
  modePassation: z.string().max(200).optional(),
  ordreServiceDate: z.coerce.date().optional(),
  delaiMois: z.number().positive().max(240).optional(),
  dateOuverture: z.coerce.date().optional(),
  assistanceTechnique: z.string().max(300).optional(),
  maitreOeuvre: z.string().max(300).optional(),
  rc: z.string().max(100).optional(),
  cb: z.string().max(100).optional(),
  cnss: z.string().max(100).optional(),
  patente: z.string().max(100).optional(),
  programme: z.string().max(300).optional(),
  projetLibelle: z.string().max(300).optional(),
  ligneBudgetaire: z.string().max(300).optional(),
  chapitre: z.string().max(300).optional(),
  status: z.enum(['preparation', 'en_cours', 'suspendu', 'receptionne', 'clos']).optional(),
  // Mode d'obtention du marché + payload spécifique (validé par mode dans
  // create/updateFiche via parseAcquisition — pas ici, le schéma dépend du mode).
  modeObtention: z.enum(MODES_OBTENTION).optional(),
  acquisition: z.record(z.string(), z.unknown()).optional(),
});

const fichePatchSchema = ficheSchema
  .extend({
    receptionProvisoire: z.coerce.date().nullable(),
    receptionDefinitive: z.coerce.date().nullable(),
    achevementTravaux: z.coerce.date().nullable(),
    ordreServiceDate: z.coerce.date().nullable(),
    delaiMois: z.number().positive().max(240).nullable(),
    dateOuverture: z.coerce.date().nullable(),
    arrets: z.array(arretSchema),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Au moins un champ à modifier est requis',
  });

const bordereauLigneSchema = z.object({
  id: z.string().optional(),
  numero: z.number().int().positive(),
  designation: z.string().min(1).max(2000),
  unite: z.string().min(1).max(20),
  quantite: z.number().nonnegative().max(1_000_000_000),
  prixUnitaire: z.number().nonnegative().max(1_000_000_000),
});

const bordereauSchema = z.object({
  reference: z.string().max(200).optional(),
  designation: z.string().max(1000).optional(),
  lignes: z.array(bordereauLigneSchema).min(1).max(2000),
});

const periodeInputSchema = z.object({
  libelle: z.string().max(200).optional(),
  dateDebut: z.coerce.date().optional(),
  dateFin: z.coerce.date().optional(),
  tauxTva: z.number().min(0).max(100).optional(),
  tauxRetenue: z.number().min(0).max(100).optional(),
  isDecompteDernier: z.boolean().optional(),
});

const periodePatchSchema = z
  .object({
    libelle: z.string().max(200),
    dateDebut: z.coerce.date().nullable(),
    dateFin: z.coerce.date().nullable(),
    tauxTva: z.number().min(0).max(100),
    tauxRetenue: z.number().min(0).max(100),
    isDecompteDernier: z.boolean(),
    statut: z.enum(['en_cours', 'validee', 'facturee']),
    observations: z.string().max(4000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Aucun champ' });

const metreLigneSchema = z.object({
  id: z.string(),
  sectionId: z.string().optional(),
  subSectionId: z.string().optional(),
  numero: z.number().optional(),
  designation: z.string().max(1000).optional(),
  nombreSemblables: z.number().nonnegative().optional(),
  longueur: z.number().nonnegative().optional(),
  largeur: z.number().nonnegative().optional(),
  profondeur: z.number().nonnegative().optional(),
  nombre: z.number().nonnegative().optional(),
  diametre: z.number().nonnegative().optional(),
  partiel: z.number().optional(),
  observations: z.string().max(1000).optional(),
});

const metreSaveSchema = z.object({
  entries: z
    .array(
      z.object({
        bordereauLigneId: z.string().min(1),
        sections: z.array(
          z.object({
            id: z.string(),
            titre: z.string().max(300),
            ordre: z.number().optional(),
            couleur: z.string().max(30).optional(),
          }),
        ),
        sousSections: z.array(
          z.object({
            id: z.string(),
            sectionId: z.string().optional(),
            titre: z.string().max(300),
            ordre: z.number().optional(),
            nombreElements: z.number().nonnegative().optional(),
          }),
        ),
        lignes: z.array(metreLigneSchema).max(2000),
      }),
    )
    .min(1)
    .max(500),
});

const decomptePatchSchema = z
  .object({
    dateDecompte: z.coerce.date().nullable(),
    statut: z.enum(['draft', 'submitted', 'validated', 'paid']),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Aucun champ' });

const revisionConfigSchema = z.object({
  formulaId: z.string().uuid().nullable().optional(),
  baseIndexes: z.record(z.string(), z.number()).optional(),
  baseDate: z.coerce.date().nullable().optional(),
  isEnabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function parsePaging(page?: string, limit?: string): { page: number; limit: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const l = Math.min(100, Math.max(1, Number.parseInt(limit ?? '24', 10) || 24));
  return { page: p, limit: l };
}

// ─── Portfolio / fiche marché ────────────────────────────────────────────────

@Controller('btp')
export class BtpProjectsController {
  constructor(
    @Inject(BTP_EXECUTION_REPOSITORY) private readonly execution: BtpExecutionRepository,
    @Inject(BTP_REGISTRES_REPOSITORY) private readonly registres: BtpRegistresRepository,
    @Inject(BTP_ASSETS_REPOSITORY) private readonly assets: BtpAssetsRepository,
  ) {}

  @Get('projects')
  async list(
    @Query('search') search?: string,
    @Query('statut') statut?: string,
    @Query('annee') annee?: string,
    @Query('at') assistanceTechnique?: string,
    @Query('moe') maitreOeuvre?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const paging = parsePaging(page, limit);
    return this.execution.listPortfolio({
      search: search?.trim() || undefined,
      statut: statut?.trim() || undefined,
      annee: annee?.trim() || undefined,
      assistanceTechnique: assistanceTechnique?.trim() || undefined,
      maitreOeuvre: maitreOeuvre?.trim() || undefined,
      ...paging,
    });
  }

  @Roles(...WRITE_ROLES)
  @Post('projects')
  async create(@Body() body: unknown) {
    const parsed = ficheSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const mode: ModeObtention = parsed.data.modeObtention ?? 'ao_direct';
    const acquisition = parseAcquisition(mode, parsed.data.acquisition);
    if (!acquisition.ok) throw new BadRequestException(acquisition.error.flatten());
    // NOUS sommes l'attributaire (direct/BC) → identité de notre société,
    // sauf si la fiche fournit explicitement d'autres valeurs.
    const nous = mode === 'ao_direct' || mode === 'bon_commande';
    return this.execution.createProject({
      ...parsed.data,
      modeObtention: mode,
      acquisition: acquisition.value,
      societe: parsed.data.societe ?? (nous ? NOTRE_ENTREPRISE.societe : undefined),
      rc: parsed.data.rc ?? (nous ? NOTRE_ENTREPRISE.rc : undefined),
      cnss: parsed.data.cnss ?? (nous ? NOTRE_ENTREPRISE.cnss : undefined),
      patente: parsed.data.patente ?? (nous ? NOTRE_ENTREPRISE.patente : undefined),
    });
  }

  /** Autocomplete data for société / AT / MOE (derived from existing fiches). */
  @Get('projects/intervenants')
  async intervenants() {
    return this.execution.listIntervenants();
  }

  /** Corbeille — soft-deleted projects, restorable. */
  @Get('projects/corbeille')
  async corbeille() {
    return this.execution.listDeletedProjects();
  }

  /** Gestion des délais — the whole portfolio's délai status computed live. */
  @Get('projects/delais')
  async delais() {
    const { items } = await this.execution.listPortfolio({ page: 1, limit: 100 });
    return items.map((project) => ({
      project: {
        id: project.id,
        reference: project.reference,
        objet: project.objet ?? project.name,
        societe: project.societe,
        status: project.status,
        ordreServiceDate: project.ordreServiceDate,
        delaiMois: project.delaiMois,
        arrets: project.arrets,
      },
      delai: computeDelaiInfo({
        ordreServiceDate: project.ordreServiceDate,
        delaiMois: project.delaiMois,
        arrets: project.arrets,
        receptionProvisoire: project.receptionProvisoire,
        receptionDefinitive: project.receptionDefinitive,
      }),
    }));
  }

  /** Fiche complète + compteurs + délai + situation contractuelle. */
  @Get('projects/:id')
  async detail(@Param('id') id: string) {
    const project = await this.findOr404(id);
    const [bordereau, periodes, decomptes, assetCounts, avenants] = await Promise.all([
      this.execution.getBordereau(id),
      this.execution.listPeriodes(id),
      this.execution.listDecomptes(id),
      this.assets.countAssets(id),
      this.registres.avenantSummary(id),
    ]);
    const dernier = decomptes[decomptes.length - 1];
    return {
      ...project,
      delai: computeDelaiInfo({
        ordreServiceDate: project.ordreServiceDate,
        delaiMois: project.delaiMois,
        arrets: project.arrets,
        receptionProvisoire: project.receptionProvisoire,
        receptionDefinitive: project.receptionDefinitive,
      }),
      counts: {
        bordereauLignes: bordereau?.lignes.length ?? 0,
        periodes: periodes.length,
        decomptes: decomptes.length,
        photos: assetCounts.photo,
        pv: assetCounts.pv,
        documents: assetCounts.document,
      },
      dernierDecompte: dernier
        ? {
            id: dernier.id,
            numero: dernier.numero,
            totalTtcMad: dernier.totalTtcMad,
            montantAcompteMad: dernier.montantAcompteMad,
            statut: dernier.statut,
          }
        : null,
      situationContractuelle: avenants,
    };
  }

  @Roles(...WRITE_ROLES)
  @Patch('projects/:id')
  async patch(@Param('id') id: string, @Body() body: unknown) {
    const parsed = fichePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const patch = { ...parsed.data } as Record<string, unknown>;
    // Le payload acquisition se valide contre le mode (patché ou existant).
    if (patch.modeObtention !== undefined || patch.acquisition !== undefined) {
      const current = await this.findOr404(id);
      const mode = (patch.modeObtention ?? current.modeObtention) as ModeObtention;
      const acquisition = parseAcquisition(mode, patch.acquisition ?? current.acquisition);
      if (!acquisition.ok) throw new BadRequestException(acquisition.error.flatten());
      patch.modeObtention = mode;
      patch.acquisition = acquisition.value;
    }
    const updated = await this.execution.updateFiche(id, patch as never);
    if (!updated) throw new NotFoundException(`Marché introuvable: ${id}`);
    return updated;
  }

  @Roles('direction', 'admin-si')
  @Delete('projects/:id')
  async softDelete(@Param('id') id: string) {
    const ok = await this.execution.softDeleteProject(id);
    if (!ok) throw new NotFoundException(`Marché introuvable: ${id}`);
    return { deleted: true };
  }

  @Roles('direction', 'admin-si')
  @Post('projects/:id/restore')
  async restore(@Param('id') id: string) {
    const ok = await this.execution.restoreProject(id);
    if (!ok) throw new NotFoundException(`Marché introuvable dans la corbeille: ${id}`);
    return { restored: true };
  }

  private async findOr404(id: string): Promise<BtpProjectRecord> {
    const record = await this.execution.getProject(id);
    if (!record || record.deletedAt) throw new NotFoundException(`Marché introuvable: ${id}`);
    return record;
  }
}

// ─── Exécution: bordereau → périodes → métrés → décomptes ────────────────────

@Controller('btp/projects/:projectId')
export class BtpExecutionController {
  constructor(
    @Inject(BTP_EXECUTION_REPOSITORY) private readonly execution: BtpExecutionRepository,
    @Inject(BTP_REGISTRES_REPOSITORY) private readonly registres: BtpRegistresRepository,
    @Inject(BtpExportService) private readonly exports: BtpExportService,
  ) {}

  // Bordereau
  @Get('bordereau')
  async getBordereau(@Param('projectId') projectId: string) {
    return (await this.execution.getBordereau(projectId)) ?? { projectId, lignes: [] };
  }

  @Roles(...WRITE_ROLES)
  @Put('bordereau')
  async saveBordereau(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = bordereauSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    // N° de prix must be unique and non-empty — the métré join key depends on it.
    const numeros = new Set<number>();
    for (const ligne of parsed.data.lignes) {
      if (numeros.has(ligne.numero)) {
        throw new BadRequestException(`N° de prix dupliqué: ${ligne.numero}`);
      }
      numeros.add(ligne.numero);
    }
    try {
      return await this.execution.saveBordereau(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  // Périodes ("Nouveau métré" = période + décompte shell)
  @Get('periodes')
  async listPeriodes(@Param('projectId') projectId: string) {
    return this.execution.listPeriodes(projectId);
  }

  @Roles(...WRITE_ROLES)
  @Post('periodes')
  async createPeriode(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = periodeInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.execution.createPeriode(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Patch('periodes/:periodeId')
  async patchPeriode(
    @Param('projectId') projectId: string,
    @Param('periodeId') periodeId: string,
    @Body() body: unknown,
  ) {
    const parsed = periodePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.execution.updatePeriode(projectId, periodeId, parsed.data);
      if (!updated) throw new NotFoundException(`Période introuvable: ${periodeId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Delete('periodes/:periodeId')
  async deletePeriode(
    @Param('projectId') projectId: string,
    @Param('periodeId') periodeId: string,
  ) {
    try {
      const ok = await this.execution.deletePeriode(projectId, periodeId);
      if (!ok) throw new NotFoundException(`Période introuvable: ${periodeId}`);
      return { deleted: true };
    } catch (error) {
      toHttp(error);
    }
  }

  // Métrés
  @Get('periodes/:periodeId/metres')
  async metreContext(
    @Param('projectId') projectId: string,
    @Param('periodeId') periodeId: string,
  ) {
    const context = await this.execution.getMetreContext(projectId, periodeId);
    if (!context) throw new NotFoundException(`Période introuvable: ${periodeId}`);
    return context;
  }

  /** Saving the métré auto-regenerates the décompte — the source app's core automation. */
  @Roles(...WRITE_ROLES)
  @Put('periodes/:periodeId/metres')
  async saveMetres(
    @Param('projectId') projectId: string,
    @Param('periodeId') periodeId: string,
    @Body() body: unknown,
  ) {
    const parsed = metreSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.execution.saveMetres(projectId, periodeId, parsed.data.entries);
    } catch (error) {
      toHttp(error);
    }
  }

  // Décomptes
  @Get('decomptes')
  async listDecomptes(@Param('projectId') projectId: string) {
    return this.execution.listDecomptes(projectId);
  }

  @Get('decomptes/:decompteId')
  async getDecompte(@Param('decompteId') decompteId: string) {
    const decompte = await this.execution.getDecompte(decompteId);
    if (!decompte) throw new NotFoundException(`Décompte introuvable: ${decompteId}`);
    return decompte;
  }

  @Roles(...WRITE_ROLES)
  @Patch('decomptes/:decompteId')
  async patchDecompte(
    @Param('projectId') projectId: string,
    @Param('decompteId') decompteId: string,
    @Body() body: unknown,
  ) {
    const parsed = decomptePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.execution.patchDecompte(projectId, decompteId, parsed.data);
      if (!updated) throw new NotFoundException(`Décompte introuvable: ${decompteId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  // Attachement (quantity certification — no prices)
  @Get('attachement')
  async attachement(
    @Param('projectId') projectId: string,
    @Query('periodeId') periodeId?: string,
  ) {
    const attachement = await this.execution.getAttachement(projectId, periodeId || undefined);
    if (!attachement) throw new NotFoundException('Aucun bordereau — attachement indisponible');
    return attachement;
  }

  // Révision des prix (per-marché view: config + analysis table)
  @Get('revision')
  async revision(@Param('projectId') projectId: string) {
    const [config, formulas, indexes, decomptes, periodes, project] = await Promise.all([
      this.registres.getRevisionConfig(projectId),
      this.registres.listFormulas(),
      this.registres.listIndexes(),
      this.execution.listDecomptes(projectId),
      this.execution.listPeriodes(projectId),
      this.execution.getProject(projectId),
    ]);
    const formula = config?.formulaId
      ? (formulas.find((f) => f.id === config.formulaId) ?? null)
      : null;
    const monthlyIndexes = new Map<string, IndexValues>(
      indexes.map((i) => [
        `${i.monthDate.getFullYear()}-${String(i.monthDate.getMonth() + 1).padStart(2, '0')}`,
        i.indexValues,
      ]),
    );
    const periodeById = new Map(periodes.map((p) => [p.id, p]));
    // Source (RevisionTab): la chaîne d'analyse démarre à l'O.S.C, chaque
    // décompte couvre [fin du décompte précédent → sa date de fin] — la date
    // de début des périodes est ignorée (souvent laissée au jour de saisie).
    let previousEnd: Date | null = project?.ordreServiceDate ?? null;
    let previousHt = 0;
    const table = decomptes.map((decompte) => {
      const periode = decompte.periodeId ? periodeById.get(decompte.periodeId) : undefined;
      // Montant à réviser = HT de la période (delta, non cumulatif).
      const montantAReviser = toNumber(round2(toDecimal(decompte.totalHtMad).minus(previousHt)));
      previousHt = decompte.totalHtMad;
      const dateFin = periode?.dateFin ?? null;
      if (!config || !formula || !previousEnd || !dateFin) {
        return {
          decompteId: decompte.id,
          numero: decompte.numero,
          periodeLibelle: decompte.periodeLibelle,
          montantAReviser,
          coefficient: null,
          montantRevision: null,
          missingMonths: [] as string[],
          details: [],
          applied: decompte.isDernier && decompte.revisionMontantMad !== 0,
        };
      }
      const result = calculateDecompteRevision({
        montantAReviser,
        periodStart: previousEnd,
        periodEnd: dateFin,
        baseIndexes: config.baseIndexes,
        monthlyIndexes,
        formula: {
          name: formula.name,
          fixedPart: formula.fixedPart,
          weights: formula.weights,
        },
      });
      previousEnd = dateFin;
      return {
        decompteId: decompte.id,
        numero: decompte.numero,
        periodeLibelle: decompte.periodeLibelle,
        montantAReviser,
        coefficient: result.coefficient,
        montantRevision: result.montantRevision,
        totalDays: result.totalDays,
        details: result.details,
        missingMonths: result.missingMonths,
        applied: decompte.isDernier && decompte.revisionMontantMad !== 0,
      };
    });
    return { config, formulas, formula, indexes, table };
  }

  @Roles(...WRITE_ROLES)
  @Put('revision/config')
  async saveRevisionConfig(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = revisionConfigSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const config = await this.registres.saveRevisionConfig(projectId, parsed.data);
    // The révision feeds the dernier décompte — recompute the chain.
    await this.execution.rebuildProjectChain(projectId);
    return config;
  }

  // Export Excel
  @Get('export/bordereau')
  async exportBordereau(@Param('projectId') projectId: string) {
    return this.exports.bordereau(projectId);
  }

  @Get('export/decomptes/:decompteId')
  async exportDecompte(
    @Param('projectId') projectId: string,
    @Param('decompteId') decompteId: string,
  ) {
    return this.exports.decompte(projectId, decompteId);
  }

  @Get('export/attachement')
  async exportAttachement(
    @Param('projectId') projectId: string,
    @Query('periodeId') periodeId?: string,
  ) {
    return this.exports.attachement(projectId, periodeId || undefined);
  }

  @Get('export/recapitulatif')
  async exportRecapitulatif(@Param('projectId') projectId: string) {
    return this.exports.recapitulatif(projectId);
  }
}

@Module({
  imports: [BtpRepositoryModule, VaultModule],
  controllers: [
    BtpProjectsController,
    BtpExecutionController,
    BtpRegistresController,
    BtpAssetsController,
    BtpTerrainController,
    BtpEntrepriseController,
  ],
  providers: [BtpExportService],
  exports: [BtpRepositoryModule],
})
export class BtpModule {}
