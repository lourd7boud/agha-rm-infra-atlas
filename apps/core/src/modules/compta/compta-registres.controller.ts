// Contrôleur des registres compta — TVA, déclarations fiscales, CNSS,
// immobilisations, banques, documents légaux (MinIO) et obligations
// annuelles. Gardé par COMPTA_ROLES au niveau classe.
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import {
  MAX_UPLOAD_BYTES,
  OBJECT_STORAGE,
  sanitizeFilename,
  type ObjectStorage,
} from '../vault/storage';
import { COMPTA_REPOSITORY, type ComptaRepository } from './compta.repository';
import {
  COMPTA_REGISTRES_REPOSITORY,
  type ComptaRegistresRepository,
} from './compta-registres.repository';
import { computeAcomptesIs } from './compta-fiscal.domain';
import { computeTvaFromLignes, tvaPeriodeBornes } from './compta-tva.domain';
import { computeIrMensuel } from './compta-social.domain';
import { COMPTA_ROLES, actorFrom, toComptaHttp, type AuthedRequest } from './compta-http.helpers';
import { extractAndCacheLegalDocText } from '../tender/legal-doc-text';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => {
    const [y = 0, m = 1, d = 1] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  });

const anneeSchema = z.coerce.number().int().min(2000).max(2100);
const montantSchema = z.coerce.number().min(-100_000_000_000).max(100_000_000_000);

const statutDatesSchema = z
  .object({
    statut: z.string().max(30),
    dateDeclaration: dateSchema.nullable(),
    datePaiement: dateSchema.nullable(),
    reference: z.string().max(200).nullable(),
    note: z.string().max(2000).nullable(),
  })
  .partial();

const tvaPatchSchema = statutDatesSchema.extend({
  tvaCollectee: montantSchema.optional(),
  tvaDeductibleCharges: montantSchema.optional(),
  tvaDeductibleImmo: montantSchema.optional(),
  creditAnterieur: montantSchema.optional(),
});

const declarationPatchSchema = statutDatesSchema.extend({
  base: montantSchema.nullable().optional(),
  montant: montantSchema.optional(),
  dateEcheance: dateSchema.optional(),
});

const declarationCreateSchema = z.object({
  type: z.string().min(2).max(50).default('autre'),
  annee: anneeSchema,
  label: z.string().min(3).max(300),
  montant: montantSchema.default(0),
  dateEcheance: dateSchema,
  note: z.string().max(2000).optional(),
});

const socialPatchSchema = statutDatesSchema.extend({
  masseSalariale: montantSchema.optional(),
  massePlafonnee: montantSchema.optional(),
  effectif: z.coerce.number().int().min(0).optional(),
});

const immoCreateSchema = z.object({
  designation: z.string().min(2).max(300),
  compteCode: z.string().regex(/^2\d{3,5}$/),
  categorie: z.string().min(2).max(50).default('materiel_technique'),
  dateAcquisition: dateSchema,
  dateMiseEnService: dateSchema.optional(),
  valeurHt: z.coerce.number().positive(),
  tauxAmortissement: z.coerce.number().positive().max(100),
  fournisseur: z.string().max(200).optional(),
  pieceRef: z.string().max(100).optional(),
  note: z.string().max(2000).optional(),
});

const immoPatchSchema = z
  .object({
    designation: z.string().min(2).max(300),
    compteCode: z.string().regex(/^2\d{3,5}$/),
    categorie: z.string().min(2).max(50),
    dateMiseEnService: dateSchema.nullable(),
    tauxAmortissement: z.coerce.number().positive().max(100),
    statut: z.enum(['actif', 'cede', 'sorti']),
    dateSortie: dateSchema.nullable(),
    prixCession: montantSchema.nullable(),
    note: z.string().max(2000).nullable(),
  })
  .partial();

const banqueCreateSchema = z.object({
  banque: z.string().min(2).max(200),
  agence: z.string().max(200).optional(),
  rib: z.string().max(50).optional(),
  soldeInitial: montantSchema.default(0),
  dateSoldeInitial: dateSchema.optional(),
  note: z.string().max(2000).optional(),
});

const mouvementCreateSchema = z.object({
  dateMouvement: dateSchema,
  libelle: z.string().min(2).max(300),
  montant: montantSchema.refine((v) => v !== 0, 'Montant non nul requis'),
  reference: z.string().max(100).optional(),
  note: z.string().max(1000).optional(),
});

const documentPatchSchema = z
  .object({
    titre: z.string().min(2).max(300),
    annee: anneeSchema.nullable(),
    dateEmission: dateSchema.nullable(),
    dateExpiration: dateSchema.nullable(),
    note: z.string().max(2000).nullable(),
  })
  .partial();

const obligationPatchSchema = z
  .object({
    statut: z.enum(['a_faire', 'fait', 'na']),
    dateFait: dateSchema.nullable(),
    note: z.string().max(2000).nullable(),
  })
  .partial();

const COMPTA_ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
]);

@Roles(...COMPTA_ROLES)
@Controller('compta')
export class ComptaRegistresController {
  private readonly logger = new Logger('ComptaRegistres');

  constructor(
    @Inject(COMPTA_REPOSITORY) private readonly compta: ComptaRepository,
    @Inject(COMPTA_REGISTRES_REPOSITORY) private readonly registres: ComptaRegistresRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ── TVA ────────────────────────────────────────────────────────────────────

  @Get('tva')
  async tva(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.registres.listTva(annee);
  }

  @Post('tva/generer')
  async genererTva(@Body() body: unknown) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const profil = await this.compta.getProfil();
    const crees = await this.registres.genererTva(
      parsed.data.annee,
      profil.regimeTva === 'trimestriel' ? 'trimestriel' : 'mensuel',
    );
    return { crees };
  }

  @Patch('tva/:id')
  async patchTva(@Param('id') id: string, @Body() body: unknown) {
    const parsed = tvaPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.patchTva(id, parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  /** Pré-remplit la période depuis les écritures (4455 / 34551 / 34552). */
  @Post('tva/:id/calculer')
  async calculerTva(@Param('id') id: string) {
    const declaration = await this.registres.getTva(id);
    if (!declaration) throw new NotFoundException('Déclaration TVA introuvable');
    const bornes = tvaPeriodeBornes(declaration.periodeKey);
    const lignes = await this.compta.lignesEntre(bornes.debut, bornes.fin);
    const montants = computeTvaFromLignes(lignes);
    try {
      return await this.registres.patchTva(id, {
        tvaCollectee: montants.collectee,
        tvaDeductibleCharges: montants.deductibleCharges,
        tvaDeductibleImmo: montants.deductibleImmo,
      });
    } catch (error) {
      toComptaHttp(error);
    }
  }

  // ── Déclarations fiscales & échéancier ─────────────────────────────────────

  @Get('declarations')
  async declarations(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.registres.listDeclarations(annee);
  }

  @Post('declarations/generer')
  async genererEcheancier(@Body() body: unknown) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const [crees, creesObligations, creesSocial] = await Promise.all([
      this.registres.genererEcheancier(parsed.data.annee),
      this.registres.genererObligations(parsed.data.annee),
      this.registres.genererSocial(parsed.data.annee),
    ]);
    const profil = await this.compta.getProfil();
    const creesTva = await this.registres.genererTva(
      parsed.data.annee,
      profil.regimeTva === 'trimestriel' ? 'trimestriel' : 'mensuel',
    );
    return { crees, creesObligations, creesSocial, creesTva };
  }

  /** Calcule et applique les 4 acomptes IS depuis l'impôt de référence N-1. */
  @Post('declarations/acomptes')
  async acomptes(@Body() body: unknown) {
    const parsed = z
      .object({
        annee: anneeSchema,
        isN1: montantSchema.default(0),
        cotisationMinimaleN1: montantSchema.default(0),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const acomptes = computeAcomptesIs(parsed.data);
    const montant = acomptes[0]?.montant ?? 0;
    await this.registres.setAcomptesIs(parsed.data.annee, montant);
    return { montantParAcompte: montant, acomptes };
  }

  @Post('declarations')
  async createDeclaration(@Body() body: unknown) {
    const parsed = declarationCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.createDeclaration(parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Patch('declarations/:id')
  async patchDeclaration(@Param('id') id: string, @Body() body: unknown) {
    const parsed = declarationPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.patchDeclaration(id, parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  // ── Social (CNSS / AMO) ────────────────────────────────────────────────────

  @Get('social')
  async social(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.registres.listSocial(annee);
  }

  @Post('social/generer')
  async genererSocial(@Body() body: unknown) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const crees = await this.registres.genererSocial(parsed.data.annee);
    return { crees };
  }

  @Patch('social/:id')
  async patchSocial(@Param('id') id: string, @Body() body: unknown) {
    const parsed = socialPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.patchSocial(id, parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  /** Estimateur IR mensuel (outil paie). */
  @Get('outils/ir')
  async simulateurIr(@Query('brut') brutStr?: string, @Query('personnes') personnesStr?: string) {
    const brut = Number(brutStr) || 0;
    return computeIrMensuel({
      brutMensuel: brut,
      personnesACharge: Number(personnesStr) || 0,
    });
  }

  // ── Immobilisations ────────────────────────────────────────────────────────

  @Get('immobilisations')
  async immobilisations(@Query('annee') anneeStr?: string, @Query('statut') statut?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.registres.listImmobilisations(annee, statut || undefined);
  }

  @Get('immobilisations/:id')
  async immobilisation(@Param('id') id: string, @Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    const record = await this.registres.getImmobilisation(id, annee);
    if (!record) throw new NotFoundException('Immobilisation introuvable');
    return record;
  }

  @Post('immobilisations')
  async createImmobilisation(@Body() body: unknown) {
    const parsed = immoCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const id = await this.registres.createImmobilisation(parsed.data);
      return { id };
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Patch('immobilisations/:id')
  async patchImmobilisation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = immoPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ok = await this.registres.patchImmobilisation(id, parsed.data);
    if (!ok) throw new NotFoundException('Immobilisation introuvable');
    return { updated: true };
  }

  @Delete('immobilisations/:id')
  async deleteImmobilisation(@Param('id') id: string) {
    const ok = await this.registres.deleteImmobilisation(id);
    if (!ok) throw new NotFoundException('Immobilisation introuvable');
    return { deleted: true };
  }

  // ── Banques ────────────────────────────────────────────────────────────────

  @Get('banques')
  async banques() {
    return this.registres.listBanqueComptes();
  }

  @Post('banques')
  async createBanque(@Body() body: unknown) {
    const parsed = banqueCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const id = await this.registres.createBanqueCompte(parsed.data);
    return { id };
  }

  @Get('banques/:id/mouvements')
  async mouvements(@Param('id') compteId: string, @Query('limit') limitStr?: string) {
    const limit = Math.min(500, Math.max(1, Number(limitStr) || 100));
    return this.registres.listMouvements(compteId, limit);
  }

  @Post('banques/:id/mouvements')
  async createMouvement(@Param('id') compteId: string, @Body() body: unknown) {
    const parsed = mouvementCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const id = await this.registres.createMouvement({ compteId, ...parsed.data });
    return { id };
  }

  @Post('mouvements/:id/rapprocher')
  async rapprocher(@Param('id') id: string) {
    const ok = await this.registres.toggleRapproche(id);
    if (!ok) throw new NotFoundException('Mouvement introuvable');
    return { updated: true };
  }

  @Delete('mouvements/:id')
  async deleteMouvement(@Param('id') id: string) {
    const ok = await this.registres.deleteMouvement(id);
    if (!ok) throw new NotFoundException('Mouvement introuvable');
    return { deleted: true };
  }

  // ── Documents légaux ───────────────────────────────────────────────────────

  @Get('documents')
  async documents(@Query('type') type?: string) {
    return this.registres.listDocuments(type || undefined);
  }

  /** Upload d'un document (attestation, PV d'AG, liasse…) vers MinIO. */
  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string | undefined>,
    @Req() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    if (!COMPTA_ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Type de fichier non autorisé: ${file.mimetype}`);
    }
    const meta = z
      .object({
        type: z.string().min(2).max(50).default('autre'),
        titre: z.string().min(2).max(300),
        annee: anneeSchema.optional(),
        dateEmission: dateSchema.optional(),
        dateExpiration: dateSchema.optional(),
        note: z.string().max(2000).optional(),
      })
      .safeParse({
        type: body['type'],
        titre: body['titre'] || file.originalname,
        annee: body['annee'] || undefined,
        dateEmission: body['dateEmission'] || undefined,
        dateExpiration: body['dateExpiration'] || undefined,
        note: body['note'] || undefined,
      });
    if (!meta.success) throw new BadRequestException(meta.error.flatten());
    const fileName = sanitizeFilename(file.originalname);
    const key = `compta/${randomUUID()}/${fileName}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const doc = await this.registres.createDocument({
      ...meta.data,
      storageKey: key,
      fileName,
      mimeType: file.mimetype,
      fileSize: file.size,
      createdBy: actorFrom(req) ?? undefined,
    });
    // Fire-and-forget OCR: extract the (possibly SCANNED) document's text with
    // ocrmypdf (fra+ara) and cache it so the AI agent can read its CONTENT, not
    // just its title. Runs in the background — the upload responds immediately;
    // the text becomes available a few seconds later.
    const bytes = new Uint8Array(file.buffer);
    void extractAndCacheLegalDocText(this.storage, doc.id, bytes, fileName, true)
      .then((text) => this.logger.log(`legal doc OCR ${doc.id} → ${text.length} chars`))
      .catch((e) => this.logger.warn(`legal doc OCR failed (${doc.id}): ${(e as Error).message}`));
    return doc;
  }

  /** Relaie l'objet MinIO (inline) — même chemin BFF que les assets BTP. */
  @Get('documents/:id/download')
  async downloadDocument(@Param('id') id: string): Promise<StreamableFile> {
    const doc = await this.registres.getDocument(id);
    if (!doc?.storageKey) throw new NotFoundException('Document introuvable');
    const objet = await this.storage.getObject(doc.storageKey);
    const fileName = encodeURIComponent(doc.fileName ?? 'document');
    return new StreamableFile(objet.body, {
      type: doc.mimeType ?? objet.mime,
      disposition: `inline; filename*=UTF-8''${fileName}`,
      length: doc.fileSize ?? objet.sizeBytes,
    });
  }

  @Patch('documents/:id')
  async patchDocument(@Param('id') id: string, @Body() body: unknown) {
    const parsed = documentPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const ok = await this.registres.patchDocument(id, parsed.data);
    if (!ok) throw new NotFoundException('Document introuvable');
    return { updated: true };
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string) {
    const ok = await this.registres.deleteDocument(id);
    if (!ok) throw new NotFoundException('Document introuvable');
    return { deleted: true };
  }

  // ── Obligations légales ────────────────────────────────────────────────────

  @Get('obligations')
  async obligations(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.registres.listObligations(annee);
  }

  @Post('obligations/generer')
  async genererObligations(@Body() body: unknown) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const crees = await this.registres.genererObligations(parsed.data.annee);
    return { crees };
  }

  @Patch('obligations/:id')
  async patchObligation(@Param('id') id: string, @Body() body: unknown) {
    const parsed = obligationPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.registres.patchObligation(id, parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }
}
