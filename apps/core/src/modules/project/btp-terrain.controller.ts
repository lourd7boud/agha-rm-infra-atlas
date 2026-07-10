// Controller Terrain — la saisie chantier des chefs de chantier (rôle
// `chantier` autorisé en écriture, en plus des rôles bureau) + le pont
// entreprise pour le wizard de création.
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
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { actorFrom, WRITE_ROLES, type AuthedRequest } from './btp-http.helpers';
import {
  DEPENSE_CATEGORIES,
  DEPENSE_METHODES,
  METEO_VALUES,
  MODE_OBTENTION_LABELS,
  NOTRE_ENTREPRISE,
} from './btp-terrain.domain';
import { BTP_TERRAIN_REPOSITORY, type BtpTerrainRepository } from './btp-terrain.repository';

/** Le chef de chantier saisit le terrain; le bureau garde la main partout. */
export const TERRAIN_ROLES = [...WRITE_ROLES, 'chantier'] as const;

// ─── Zod ─────────────────────────────────────────────────────────────────────
const rapportSchema = z.object({
  reportDate: z.coerce.date(),
  effectifs: z.number().int().min(0).max(10_000),
  travauxRealises: z.string().min(1).max(4000),
  materiel: z.string().max(2000).nullish(),
  meteo: z.enum(METEO_VALUES).nullish(),
  blocages: z.string().max(2000).nullish(),
  incidentsSecurite: z.number().int().min(0).max(1000).default(0),
  heuresTravail: z.number().min(0).max(24).nullish(),
  visites: z.string().max(2000).nullish(),
  avancement: z.string().max(2000).nullish(),
  photoIds: z.array(z.string().uuid()).max(50).default([]),
});

const rapportPatchSchema = rapportSchema.partial().refine((p) => Object.keys(p).length > 0, {
  message: 'Au moins un champ à modifier est requis',
});

const materielSchema = z.object({
  date: z.coerce.date(),
  engin: z.string().min(1).max(300),
  equipmentId: z.string().uuid().nullish(),
  regime: z.enum(['propre', 'location']).default('propre'),
  heuresUtilisation: z.number().min(0).max(10_000).nullish(),
  carburantL: z.number().min(0).max(100_000).nullish(),
  coutCarburantMad: z.number().min(0).max(10_000_000).default(0),
  coutLocationMad: z.number().min(0).max(10_000_000).default(0),
  note: z.string().max(1000).nullish(),
});

const consommationSchema = z.object({
  date: z.coerce.date(),
  article: z.string().min(1).max(300),
  unite: z.string().min(1).max(20).default('u'),
  quantite: z.number().positive().max(1_000_000_000),
  prixUnitaireMad: z.number().min(0).max(10_000_000).nullish(),
  coutMad: z.number().min(0).max(100_000_000).default(0),
  fournisseur: z.string().max(300).nullish(),
  bonLivraison: z.string().max(200).nullish(),
  note: z.string().max(1000).nullish(),
});

const attachementSchema = z.object({
  date: z.coerce.date(),
  ligneId: z.string().min(1).max(100),
  numeroPrix: z.string().max(50).nullish(),
  designation: z.string().min(1).max(2000),
  unite: z.string().min(1).max(20),
  quantite: z.number().positive().max(1_000_000_000),
  note: z.string().max(1000).nullish(),
});

const depenseSchema = z.object({
  spentAt: z.coerce.date(),
  category: z.enum(DEPENSE_CATEGORIES),
  label: z.string().min(1).max(500),
  amountMad: z.number().positive().max(100_000_000),
  method: z.enum(DEPENSE_METHODES).nullish(),
  reference: z.string().max(200).nullish(),
  notes: z.string().max(1000).nullish(),
  justificatifAssetId: z.string().uuid().nullish(),
});

const pointageSchema = z.object({
  assignmentId: z.string().uuid(),
  workDate: z.coerce.date(),
  daysWorked: z.number().min(0).max(2),
  notes: z.string().max(500).nullish(),
});

// ─── Controller ──────────────────────────────────────────────────────────────
@Controller('btp/projects/:projectId/terrain')
export class BtpTerrainController {
  constructor(
    @Inject(BTP_TERRAIN_REPOSITORY) private readonly terrain: BtpTerrainRepository,
  ) {}

  /** Tableau de bord terrain: coûts réels + compteurs + derniers rapports. */
  @Get('overview')
  async overview(@Param('projectId') projectId: string) {
    const [couts, counts, rapports] = await Promise.all([
      this.terrain.getCouts(projectId),
      this.terrain.getCounts(projectId),
      this.terrain.listRapports(projectId, 7),
    ]);
    return { couts, counts, derniersRapports: rapports };
  }

  // Rapports de chantier
  @Get('rapports')
  async listRapports(@Param('projectId') projectId: string, @Query('limit') limit?: string) {
    const n = limit ? Math.min(Number(limit) || 60, 365) : 60;
    return this.terrain.listRapports(projectId, n);
  }

  @Roles(...TERRAIN_ROLES)
  @Post('rapports')
  async createRapport(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = rapportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.terrain.createRapport({
      projectId,
      reportDate: parsed.data.reportDate,
      effectifs: parsed.data.effectifs,
      travauxRealises: parsed.data.travauxRealises,
      materiel: parsed.data.materiel ?? null,
      meteo: parsed.data.meteo ?? null,
      blocages: parsed.data.blocages ?? null,
      incidentsSecurite: parsed.data.incidentsSecurite,
      heuresTravail: parsed.data.heuresTravail ?? null,
      visites: parsed.data.visites ?? null,
      avancement: parsed.data.avancement ?? null,
      photoIds: parsed.data.photoIds,
      createdBy: actorFrom(req).name,
    });
  }

  @Roles(...TERRAIN_ROLES)
  @Patch('rapports/:id')
  async updateRapport(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = rapportPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.terrain.updateRapport(projectId, id, parsed.data);
    if (!updated) throw new NotFoundException(`Rapport introuvable: ${id}`);
    return updated;
  }

  @Roles(...TERRAIN_ROLES)
  @Delete('rapports/:id')
  async deleteRapport(@Param('projectId') projectId: string, @Param('id') id: string) {
    const ok = await this.terrain.deleteRapport(projectId, id);
    if (!ok) throw new NotFoundException(`Rapport introuvable: ${id}`);
    return { deleted: true };
  }

  // Matériel
  @Get('materiel')
  async listMateriel(@Param('projectId') projectId: string) {
    return this.terrain.listMateriel(projectId);
  }

  @Roles(...TERRAIN_ROLES)
  @Post('materiel')
  async createMateriel(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = materielSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.terrain.createMateriel({
      projectId,
      date: parsed.data.date,
      engin: parsed.data.engin,
      equipmentId: parsed.data.equipmentId ?? null,
      regime: parsed.data.regime,
      heuresUtilisation: parsed.data.heuresUtilisation ?? null,
      carburantL: parsed.data.carburantL ?? null,
      coutCarburantMad: parsed.data.coutCarburantMad,
      coutLocationMad: parsed.data.coutLocationMad,
      note: parsed.data.note ?? null,
      saisiPar: actorFrom(req).name,
    });
  }

  @Roles(...TERRAIN_ROLES)
  @Delete('materiel/:id')
  async deleteMateriel(@Param('projectId') projectId: string, @Param('id') id: string) {
    const ok = await this.terrain.deleteMateriel(projectId, id);
    if (!ok) throw new NotFoundException(`Ligne matériel introuvable: ${id}`);
    return { deleted: true };
  }

  // Consommations
  @Get('consommations')
  async listConsommations(@Param('projectId') projectId: string) {
    return this.terrain.listConsommations(projectId);
  }

  @Roles(...TERRAIN_ROLES)
  @Post('consommations')
  async createConsommation(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = consommationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.terrain.createConsommation({
      projectId,
      date: parsed.data.date,
      article: parsed.data.article,
      unite: parsed.data.unite,
      quantite: parsed.data.quantite,
      prixUnitaireMad: parsed.data.prixUnitaireMad ?? null,
      coutMad: parsed.data.coutMad,
      fournisseur: parsed.data.fournisseur ?? null,
      bonLivraison: parsed.data.bonLivraison ?? null,
      note: parsed.data.note ?? null,
      saisiPar: actorFrom(req).name,
    });
  }

  @Roles(...TERRAIN_ROLES)
  @Delete('consommations/:id')
  async deleteConsommation(@Param('projectId') projectId: string, @Param('id') id: string) {
    const ok = await this.terrain.deleteConsommation(projectId, id);
    if (!ok) throw new NotFoundException(`Consommation introuvable: ${id}`);
    return { deleted: true };
  }

  // Attachements terrain
  @Get('attachements')
  async listAttachements(@Param('projectId') projectId: string) {
    return this.terrain.listAttachements(projectId);
  }

  @Roles(...TERRAIN_ROLES)
  @Post('attachements')
  async createAttachement(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = attachementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.terrain.createAttachement({
      projectId,
      date: parsed.data.date,
      ligneId: parsed.data.ligneId,
      numeroPrix: parsed.data.numeroPrix ?? null,
      designation: parsed.data.designation,
      unite: parsed.data.unite,
      quantite: parsed.data.quantite,
      note: parsed.data.note ?? null,
      saisiPar: actorFrom(req).name,
    });
  }

  /** L'intégration au métré officiel reste un geste du bureau. */
  @Roles(...WRITE_ROLES)
  @Post('attachements/:id/integrer')
  async integrerAttachement(@Param('projectId') projectId: string, @Param('id') id: string) {
    const updated = await this.terrain.setAttachementStatut(projectId, id, 'integre');
    if (!updated) throw new NotFoundException(`Attachement introuvable: ${id}`);
    return updated;
  }

  @Roles(...TERRAIN_ROLES)
  @Delete('attachements/:id')
  async deleteAttachement(@Param('projectId') projectId: string, @Param('id') id: string) {
    const ok = await this.terrain.deleteAttachement(projectId, id);
    if (!ok) throw new NotFoundException(`Attachement introuvable: ${id}`);
    return { deleted: true };
  }

  // Dépenses
  @Get('depenses')
  async listDepenses(@Param('projectId') projectId: string) {
    return this.terrain.listDepenses(projectId);
  }

  @Roles(...TERRAIN_ROLES)
  @Post('depenses')
  async createDepense(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = depenseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.terrain.createDepense({
      projectId,
      category: parsed.data.category,
      label: parsed.data.label,
      amountMad: parsed.data.amountMad,
      method: parsed.data.method ?? undefined,
      reference: parsed.data.reference ?? undefined,
      spentAt: parsed.data.spentAt,
      notes: parsed.data.notes ?? undefined,
      justificatifAssetId: parsed.data.justificatifAssetId ?? undefined,
      saisiPar: actorFrom(req).name,
    });
  }

  @Roles(...TERRAIN_ROLES)
  @Delete('depenses/:id')
  async deleteDepense(@Param('projectId') projectId: string, @Param('id') id: string) {
    const ok = await this.terrain.deleteDepense(projectId, id);
    if (!ok) throw new NotFoundException(`Dépense introuvable: ${id}`);
    return { deleted: true };
  }

  // Pointage
  @Get('pointage')
  async pointage(@Param('projectId') projectId: string) {
    const [crew, pointages] = await Promise.all([
      this.terrain.getCrew(projectId),
      this.terrain.listPointages(projectId, 120),
    ]);
    return { crew, pointages };
  }

  @Roles(...TERRAIN_ROLES)
  @Post('pointage')
  async upsertPointage(@Param('projectId') projectId: string, @Body() body: unknown) {
    const parsed = pointageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    // L'assignment doit appartenir au chantier — évite de pointer un autre projet.
    const crew = await this.terrain.getCrew(projectId);
    if (!crew.some((m) => m.assignmentId === parsed.data.assignmentId)) {
      throw new BadRequestException("Cette affectation n'appartient pas à ce chantier");
    }
    await this.terrain.upsertPointage({
      assignmentId: parsed.data.assignmentId,
      workDate: parsed.data.workDate,
      daysWorked: parsed.data.daysWorked,
      notes: parsed.data.notes ?? undefined,
    });
    return { ok: true };
  }
}

/** Référentiel entreprise + libellés modes — consommé par le wizard web. */
@Controller('btp')
export class BtpEntrepriseController {
  @Get('notre-entreprise')
  entreprise() {
    return { entreprise: NOTRE_ENTREPRISE, modes: MODE_OBTENTION_LABELS };
  }
}
