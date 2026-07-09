// Registres + assets controllers — avenants, ODS, pénalités/cautions/retenues,
// circuit de validation, révision reference data (formules + index mensuels),
// and the photothèque/PV/documents endpoints (files in MinIO).
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import {
  MAX_UPLOAD_BYTES,
  OBJECT_STORAGE,
  sanitizeFilename,
  type ObjectStorage,
} from '../vault/storage';
import {
  BTP_ASSETS_REPOSITORY,
  type AssetType,
  type BtpAssetsRepository,
} from './btp-assets.repository';
import { BTP_REGISTRES_REPOSITORY, type BtpRegistresRepository } from './btp-registres.repository';
import { ODS_TYPES } from './btp-registres.domain';
import { validateFormula } from './btp-revision.domain';
import { actorFrom, toHttp, WRITE_ROLES, type AuthedRequest } from './btp-http.helpers';

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const avenantInputSchema = z.object({
  objet: z.string().min(3).max(2000),
  reference: z.string().max(200).optional(),
  typeAvenant: z.enum(['modification', 'prix_nouveaux', 'mixte', 'diminution']).optional(),
  dateAvenant: z.coerce.date().optional(),
  dateNotification: z.coerce.date().optional(),
  montantDeltaMad: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
  delaiDeltaMois: z.number().min(-120).max(120).optional(),
  modifications: z.array(z.record(z.string(), z.unknown())).optional(),
  prixNouveaux: z.array(z.record(z.string(), z.unknown())).optional(),
  observations: z.string().max(4000).optional(),
});

const avenantTransitionSchema = z.object({
  to: z.enum(['brouillon', 'en_attente', 'approuve', 'rejete', 'annule']),
  dateApprobation: z.coerce.date().optional(),
});

const odsInputSchema = z.object({
  type: z.enum(ODS_TYPES).optional(),
  objet: z.string().min(3).max(2000),
  description: z.string().max(4000).optional(),
  motif: z.string().max(2000).optional(),
  dateEmission: z.coerce.date().optional(),
  dateEffet: z.coerce.date().optional(),
  dateFin: z.coerce.date().optional(),
  delaiJours: z.number().int().min(0).max(10000).optional(),
  impactFinancierMad: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
  impactDelaiJours: z.number().int().min(-10000).max(10000).optional(),
  emetteur: z.string().max(300).optional(),
  emetteurFonction: z.string().max(300).optional(),
  destinataire: z.string().max(300).optional(),
  avenantId: z.string().uuid().optional(),
});

const odsActionSchema = z.object({
  action: z.enum(['emit', 'notify', 'acknowledge', 'execute', 'close', 'cancel']),
  accusePar: z.string().max(300).optional(),
});

const penaliteInputSchema = z.object({
  type: z
    .enum(['retard', 'malfacon', 'non_conformite', 'securite', 'environnement', 'autre'])
    .optional(),
  dateDebut: z.coerce.date().optional(),
  dateFin: z.coerce.date().optional(),
  nombreJours: z.number().int().min(0).max(10000),
  taux: z.number().min(0).max(1).optional(),
  baseCalculMad: z.number().nonnegative().optional(),
  plafondPourcentage: z.number().min(0).max(100).optional(),
  motif: z.string().max(2000).optional(),
  observations: z.string().max(4000).optional(),
});

const penaliteTransitionSchema = z.object({
  to: z.enum(['notifiee', 'contestee', 'appliquee', 'annulee', 'remise']),
  referenceNotification: z.string().max(200).optional(),
  dateNotification: z.coerce.date().optional(),
});

const cautionInputSchema = z.object({
  type: z.enum([
    'caution_provisoire',
    'caution_definitive',
    'retenue_garantie',
    'caution_avance',
    'caution_bonne_execution',
    'garantie_decennale',
  ]),
  montantMad: z.number().nonnegative().optional(),
  pourcentage: z.number().min(0).max(100).optional(),
  baseCalculMad: z.number().nonnegative().optional(),
  organisme: z.string().max(300).optional(),
  referenceOrganisme: z.string().max(300).optional(),
  dateEmission: z.coerce.date().optional(),
  dateExpiration: z.coerce.date().optional(),
  observations: z.string().max(4000).optional(),
});

const cautionTransitionSchema = z.object({
  to: z.enum(['active', 'expiree', 'liberee', 'saisie', 'annulee']),
  dateMainlevee: z.coerce.date().optional(),
});

const approvalInputSchema = z.object({
  documentType: z.enum(['decompte', 'avenant', 'pv', 'ods', 'attachement', 'autre']),
  documentId: z.string().max(200).optional(),
  documentReference: z.string().max(300).optional(),
  priority: z.enum(['basse', 'normal', 'haute', 'urgente']).optional(),
  dueDate: z.coerce.date().optional(),
  note: z.string().max(2000).optional(),
  montantMad: z.number().optional(),
  steps: z
    .array(
      z.object({ stepLabel: z.string().min(2).max(200), role: z.string().max(100).optional() }),
    )
    .max(10)
    .optional(),
});

const approvalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'cancel']),
  comment: z.string().max(2000).optional(),
});

const formulaInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  fixedPart: z.number().min(0).max(1),
  weights: z.record(z.string(), z.number().min(0).max(1)),
  isDefault: z.boolean().optional(),
});

const indexMonthSchema = z.object({
  monthDate: z.coerce.date(),
  indexValues: z.record(z.string(), z.number()),
  source: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(['provisoire', 'definitif']).optional(),
});

const albumInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  color: z.string().max(30).optional(),
  icon: z.string().max(50).optional(),
  periodeId: z.string().uuid().optional(),
});

const albumPatchSchema = albumInputSchema
  .extend({ sortOrder: z.number().int().min(0).max(10000) })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Aucun champ' });

const assetPatchSchema = z
  .object({
    albumId: z.string().uuid().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Aucun champ' });

/** Broader than the vault: chantier photos + administrative documents. */
const BTP_ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'text/plain',
]);

// ─── Registres ───────────────────────────────────────────────────────────────

@Controller('btp')
export class BtpRegistresController {
  constructor(
    @Inject(BTP_REGISTRES_REPOSITORY) private readonly registres: BtpRegistresRepository,
  ) {}

  // Révision reference data (Gestion des Index)
  @Get('revision/formulas')
  async listFormulas() {
    return this.registres.listFormulas();
  }

  @Roles('direction', 'admin-si')
  @Post('revision/formulas')
  async saveFormula(@Body() body: unknown) {
    const parsed = formulaInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const total = validateFormula({
      name: parsed.data.name,
      fixedPart: parsed.data.fixedPart,
      weights: parsed.data.weights,
    });
    if (!total.valid) {
      throw new BadRequestException(
        `Partie fixe + Σ pondérations = ${total.total.toFixed(4)} (doit valoir 1.0000)`,
      );
    }
    try {
      return await this.registres.saveFormula(parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles('direction', 'admin-si')
  @Delete('revision/formulas/:id')
  async deleteFormula(@Param('id') id: string) {
    try {
      const ok = await this.registres.deleteFormula(id);
      if (!ok) throw new NotFoundException(`Formule introuvable: ${id}`);
      return { deleted: true };
    } catch (error) {
      toHttp(error);
    }
  }

  @Get('revision/indexes')
  async listIndexes(@Query('year') year?: string) {
    const parsedYear = year ? Number.parseInt(year, 10) : undefined;
    return this.registres.listIndexes(Number.isNaN(parsedYear) ? undefined : parsedYear);
  }

  @Roles('direction', 'admin-si')
  @Put('revision/indexes')
  async upsertIndexMonth(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = indexMonthSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.registres.upsertIndexMonth(parsed.data, actorFrom(req));
  }

  @Roles('direction', 'admin-si')
  @Delete('revision/indexes/:month')
  async deleteIndexMonth(@Param('month') month: string, @Req() req: AuthedRequest) {
    const date = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Mois invalide: ${month} (attendu YYYY-MM)`);
    }
    const ok = await this.registres.deleteIndexMonth(date, actorFrom(req));
    if (!ok) throw new NotFoundException(`Mois introuvable: ${month}`);
    return { deleted: true };
  }

  @Get('revision/indexes-audit')
  async indexAudit() {
    return this.registres.listIndexAudit(150);
  }

  // Avenants
  @Get('projects/:projectId/avenants')
  async listAvenants(@Param('projectId') projectId: string) {
    const [avenants, summary] = await Promise.all([
      this.registres.listAvenants(projectId),
      this.registres.avenantSummary(projectId),
    ]);
    return { avenants, summary };
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/avenants')
  async createAvenant(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = avenantInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createAvenant(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Patch('projects/:projectId/avenants/:avenantId')
  async updateAvenant(
    @Param('projectId') projectId: string,
    @Param('avenantId') avenantId: string,
    @Body() body: unknown,
  ) {
    const parsed = avenantInputSchema.partial().safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.updateAvenant(projectId, avenantId, parsed.data);
      if (!updated) throw new NotFoundException(`Avenant introuvable: ${avenantId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  /** Approving an avenant moves the contract ceiling — direction only. */
  @Roles('direction')
  @Post('projects/:projectId/avenants/:avenantId/transition')
  async transitionAvenant(
    @Param('projectId') projectId: string,
    @Param('avenantId') avenantId: string,
    @Body() body: unknown,
  ) {
    const parsed = avenantTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.transitionAvenant(
        projectId,
        avenantId,
        parsed.data.to,
        parsed.data.dateApprobation,
      );
      if (!updated) throw new NotFoundException(`Avenant introuvable: ${avenantId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Delete('projects/:projectId/avenants/:avenantId')
  async deleteAvenant(
    @Param('projectId') projectId: string,
    @Param('avenantId') avenantId: string,
  ) {
    try {
      const ok = await this.registres.deleteAvenant(projectId, avenantId);
      if (!ok) throw new NotFoundException(`Avenant introuvable: ${avenantId}`);
      return { deleted: true };
    } catch (error) {
      toHttp(error);
    }
  }

  // ODS
  @Get('projects/:projectId/ods')
  async listOds(@Param('projectId') projectId: string) {
    return this.registres.listOds(projectId);
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/ods')
  async createOds(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = odsInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createOds(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Patch('projects/:projectId/ods/:odsId')
  async updateOds(
    @Param('projectId') projectId: string,
    @Param('odsId') odsId: string,
    @Body() body: unknown,
  ) {
    const parsed = odsInputSchema.partial().safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.updateOds(projectId, odsId, parsed.data);
      if (!updated) throw new NotFoundException(`ODS introuvable: ${odsId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/ods/:odsId/action')
  async actionOds(
    @Param('projectId') projectId: string,
    @Param('odsId') odsId: string,
    @Body() body: unknown,
  ) {
    const parsed = odsActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.actionOds(projectId, odsId, parsed.data.action, {
        accusePar: parsed.data.accusePar,
      });
      if (!updated) throw new NotFoundException(`ODS introuvable: ${odsId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Delete('projects/:projectId/ods/:odsId')
  async deleteOds(@Param('projectId') projectId: string, @Param('odsId') odsId: string) {
    const ok = await this.registres.deleteOds(projectId, odsId);
    if (!ok) {
      throw new NotFoundException(`ODS introuvable ou non-brouillon: ${odsId}`);
    }
    return { deleted: true };
  }

  // Pénalités / cautions / retenues
  @Get('projects/:projectId/penalites')
  async penalites(@Param('projectId') projectId: string) {
    const [penalites, cautions, retenues] = await Promise.all([
      this.registres.listPenalites(projectId),
      this.registres.listCautions(projectId),
      this.registres.syncRetenuesFromDecomptes(projectId),
    ]);
    return { penalites, cautions, retenues };
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/penalites')
  async createPenalite(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = penaliteInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createPenalite(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/penalites/:penaliteId/transition')
  async transitionPenalite(
    @Param('projectId') projectId: string,
    @Param('penaliteId') penaliteId: string,
    @Body() body: unknown,
  ) {
    const parsed = penaliteTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.transitionPenalite(
        projectId,
        penaliteId,
        parsed.data.to,
        parsed.data,
      );
      if (!updated) throw new NotFoundException(`Pénalité introuvable: ${penaliteId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Delete('projects/:projectId/penalites/:penaliteId')
  async deletePenalite(
    @Param('projectId') projectId: string,
    @Param('penaliteId') penaliteId: string,
  ) {
    const ok = await this.registres.deletePenalite(projectId, penaliteId);
    if (!ok) throw new NotFoundException(`Pénalité introuvable: ${penaliteId}`);
    return { deleted: true };
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/cautions')
  async createCaution(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = cautionInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createCaution(projectId, parsed.data);
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/cautions/:cautionId/transition')
  async transitionCaution(
    @Param('projectId') projectId: string,
    @Param('cautionId') cautionId: string,
    @Body() body: unknown,
  ) {
    const parsed = cautionTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.transitionCaution(
        projectId,
        cautionId,
        parsed.data.to,
        parsed.data.dateMainlevee,
      );
      if (!updated) throw new NotFoundException(`Caution introuvable: ${cautionId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles(...WRITE_ROLES)
  @Delete('projects/:projectId/cautions/:cautionId')
  async deleteCaution(
    @Param('projectId') projectId: string,
    @Param('cautionId') cautionId: string,
  ) {
    const ok = await this.registres.deleteCaution(projectId, cautionId);
    if (!ok) throw new NotFoundException(`Caution introuvable: ${cautionId}`);
    return { deleted: true };
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/retenues/:retenueId/liberer')
  async libererRetenue(
    @Param('projectId') projectId: string,
    @Param('retenueId') retenueId: string,
  ) {
    const updated = await this.registres.libererRetenue(projectId, retenueId);
    if (!updated) throw new NotFoundException(`Retenue introuvable: ${retenueId}`);
    return updated;
  }

  // Circuit de validation
  @Get('projects/:projectId/validations')
  async listApprovals(@Param('projectId') projectId: string) {
    return this.registres.listApprovals(projectId);
  }

  @Roles(...WRITE_ROLES)
  @Post('projects/:projectId/validations')
  async createApproval(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = approvalInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createApproval(projectId, parsed.data, actorFrom(req));
    } catch (error) {
      toHttp(error);
    }
  }

  @Roles('direction', 'marches', 'admin-si')
  @Post('validations/:requestId/decision')
  async decideApproval(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = approvalDecisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const updated = await this.registres.decideApproval(
        requestId,
        parsed.data.decision,
        actorFrom(req),
        parsed.data.comment,
      );
      if (!updated) throw new NotFoundException(`Demande introuvable: ${requestId}`);
      return updated;
    } catch (error) {
      toHttp(error);
    }
  }
}

// ─── Photothèque / PV / documents ────────────────────────────────────────────

@Controller('btp/projects/:projectId')
export class BtpAssetsController {
  constructor(
    @Inject(BTP_ASSETS_REPOSITORY) private readonly assets: BtpAssetsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get('albums')
  async listAlbums(@Param('projectId') projectId: string) {
    return this.assets.listAlbums(projectId);
  }

  @Roles(...WRITE_ROLES)
  @Post('albums')
  async createAlbum(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = albumInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assets.createAlbum(projectId, parsed.data, actorFrom(req).sub);
  }

  @Roles(...WRITE_ROLES)
  @Patch('albums/:albumId')
  async updateAlbum(
    @Param('projectId') projectId: string,
    @Param('albumId') albumId: string,
    @Body() body: unknown,
  ) {
    const parsed = albumPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.assets.updateAlbum(projectId, albumId, parsed.data);
    if (!updated) throw new NotFoundException(`Album introuvable: ${albumId}`);
    return updated;
  }

  @Roles(...WRITE_ROLES)
  @Delete('albums/:albumId')
  async deleteAlbum(@Param('projectId') projectId: string, @Param('albumId') albumId: string) {
    const ok = await this.assets.deleteAlbum(projectId, albumId);
    if (!ok) throw new NotFoundException(`Album introuvable: ${albumId}`);
    return { deleted: true };
  }

  @Get('assets')
  async listAssets(@Param('projectId') projectId: string, @Query('type') type?: string) {
    const assetType =
      type === 'photo' || type === 'pv' || type === 'document' ? (type as AssetType) : undefined;
    const records = await this.assets.listAssets(projectId, assetType);
    return Promise.all(
      records.map(async (asset) => ({
        ...asset,
        url: asset.storageKey ? await this.storage.presignedGetUrl(asset.storageKey, 3600) : null,
      })),
    );
  }

  @Get('assets/counts')
  async counts(@Param('projectId') projectId: string) {
    return this.assets.countAssets(projectId);
  }

  /** Multi-file upload (photos / PV / documents) → MinIO, rows in Postgres. */
  @Roles(...WRITE_ROLES)
  @Post('assets/upload')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: Record<string, string | undefined>,
    @Req() req: AuthedRequest,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('Aucun fichier reçu');
    const type: AssetType =
      body.type === 'pv' || body.type === 'document' ? (body.type as AssetType) : 'photo';
    let metadata: Record<string, unknown> = {};
    if (body.metadata) {
      try {
        metadata = JSON.parse(body.metadata) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('metadata: JSON invalide');
      }
    }
    if (body.description) metadata.description = body.description;
    const albumId = body.albumId || undefined;
    const actor = actorFrom(req);

    const created = [];
    for (const file of files) {
      if (!BTP_ALLOWED_MIMES.has(file.mimetype)) {
        throw new BadRequestException(`Type de fichier non autorisé: ${file.mimetype}`);
      }
      if (type === 'photo' && !file.mimetype.startsWith('image/')) {
        throw new BadRequestException(`Une photo doit être une image (reçu ${file.mimetype})`);
      }
      const fileName = sanitizeFilename(file.originalname);
      const key = `btp/${projectId}/${randomUUID()}/${fileName}`;
      const stored = await this.storage.put(key, file.buffer, file.mimetype);
      const asset = await this.assets.createAsset({
        projectId,
        type,
        fileName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageKey: key,
        sha256: stored.sha256,
        albumId,
        metadata,
        createdBy: actor.sub,
      });
      created.push({ ...asset, url: await this.storage.presignedGetUrl(key, 3600) });
    }
    return created;
  }

  @Roles(...WRITE_ROLES)
  @Patch('assets/:assetId')
  async patchAsset(
    @Param('projectId') projectId: string,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ) {
    const parsed = assetPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.assets.updateAssetMetadata(projectId, assetId, parsed.data);
    if (!updated) throw new NotFoundException(`Fichier introuvable: ${assetId}`);
    return updated;
  }

  @Get('assets/:assetId/url')
  async assetUrl(@Param('assetId') assetId: string) {
    const asset = await this.assets.getAsset(assetId);
    if (!asset?.storageKey) throw new NotFoundException(`Fichier introuvable: ${assetId}`);
    return { url: await this.storage.presignedGetUrl(asset.storageKey, 3600) };
  }

  @Roles(...WRITE_ROLES)
  @Delete('assets/:assetId')
  async deleteAsset(@Param('projectId') projectId: string, @Param('assetId') assetId: string) {
    const ok = await this.assets.deleteAsset(projectId, assetId);
    if (!ok) throw new NotFoundException(`Fichier introuvable: ${assetId}`);
    return { deleted: true };
  }
}
