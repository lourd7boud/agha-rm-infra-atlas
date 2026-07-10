// Module Comptabilité — contrôleur cœur (profil, exercices, plan comptable,
// journaux, écritures, livres, tableau de bord) + câblage Nest. Le registre
// fiscal/social/immobilisations/banques/documents vit dans
// compta-registres.controller.ts. Accès restreint aux rôles COMPTA_ROLES
// (classe entière) — la comptabilité est une donnée sensible.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { VaultModule } from '../vault/vault.module';
import { ComptaRepositoryModule } from './compta-repository.module';
import { ComptaRegistresController } from './compta-registres.controller';
import {
  COMPTA_REPOSITORY,
  type ComptaRepository,
  type EcritureInput,
} from './compta.repository';
import {
  COMPTA_REGISTRES_REPOSITORY,
  type ComptaRegistresRepository,
} from './compta-registres.repository';
import {
  classifyEcheance,
  computeCotisationMinimale,
  computeCss,
  computeIs,
  VEILLE_REGLEMENTAIRE,
} from './compta-fiscal.domain';
import { COMPTA_ROLES, actorFrom, toComptaHttp, type AuthedRequest } from './compta-http.helpers';

// ── Zod ──────────────────────────────────────────────────────────────────────

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => {
    const [y = 0, m = 1, d = 1] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  });

const anneeSchema = z.coerce.number().int().min(2000).max(2100);

const profilPatchSchema = z
  .object({
    raisonSociale: z.string().min(1).max(200),
    formeJuridique: z.string().min(1).max(50),
    capitalSocial: z.coerce.number().min(0).nullable(),
    registreCommerce: z.string().max(100).nullable(),
    identifiantFiscal: z.string().max(100).nullable(),
    ice: z.string().max(100).nullable(),
    taxeProfessionnelle: z.string().max(100).nullable(),
    cnssAffiliation: z.string().max(100).nullable(),
    adresse: z.string().max(500).nullable(),
    ville: z.string().max(100).nullable(),
    gerant: z.string().max(200).nullable(),
    dateCreation: dateSchema.nullable(),
    exerciceClotureMois: z.coerce.number().int().min(1).max(12),
    regimeTva: z.enum(['mensuel', 'trimestriel']),
    prorataTva: z.coerce.number().min(0).max(100),
    tauxIs: z.coerce.number().min(0).max(60),
    tauxCotisationMinimale: z.coerce.number().min(0).max(5),
    effectif: z.coerce.number().int().min(0).nullable(),
    assujettiTp: z.coerce.boolean(),
    exonerationTpJusquau: dateSchema.nullable(),
    notes: z.string().max(4000).nullable(),
  })
  .partial();

const compteInputSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/),
  intitule: z.string().min(2).max(300),
  parentCode: z.string().max(6).optional(),
});

const comptePatchSchema = z
  .object({ intitule: z.string().min(2).max(300), actif: z.boolean() })
  .partial();

const ligneSchema = z.object({
  compteCode: z.string().min(4).max(6),
  libelle: z.string().max(300).optional(),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  tiers: z.string().max(200).optional(),
});

const ecritureInputSchema = z.object({
  journalCode: z.string().min(1).max(10),
  dateEcriture: dateSchema,
  pieceRef: z.string().max(100).optional(),
  libelle: z.string().min(2).max(500),
  lignes: z.array(ligneSchema).min(2).max(60),
});

// ── Contrôleur cœur ──────────────────────────────────────────────────────────

@Roles(...COMPTA_ROLES)
@Controller('compta')
export class ComptaCoreController {
  constructor(
    @Inject(COMPTA_REPOSITORY) private readonly compta: ComptaRepository,
    @Inject(COMPTA_REGISTRES_REPOSITORY) private readonly registres: ComptaRegistresRepository,
  ) {}

  // Profil & paramètres.
  @Get('profil')
  async profil() {
    return this.compta.getProfil();
  }

  @Patch('profil')
  async patchProfil(@Body() body: unknown) {
    const parsed = profilPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.compta.updateProfil(parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  // Exercices.
  @Get('exercices')
  async exercices() {
    return this.compta.listExercices();
  }

  @Post('exercices')
  async createExercice(@Body() body: unknown) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.compta.ensureExercice(parsed.data.annee);
  }

  @Patch('exercices/:annee')
  async patchExercice(@Param('annee') anneeStr: string, @Body() body: unknown) {
    const parsed = z.object({ statut: z.enum(['ouvert', 'cloture']) }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.compta.setExerciceStatut(Number(anneeStr), parsed.data.statut);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  // Plan comptable.
  @Get('plan')
  async plan(
    @Query('q') q?: string,
    @Query('classe') classe?: string,
    @Query('actifs') actifs?: string,
  ) {
    return this.compta.listComptes({
      q: q || undefined,
      classe: classe ? Number(classe) : undefined,
      actifsSeulement: actifs === '1',
    });
  }

  @Post('plan')
  async createCompte(@Body() body: unknown) {
    const parsed = compteInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.compta.createCompte(parsed.data);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Patch('plan/:code')
  async patchCompte(@Param('code') code: string, @Body() body: unknown) {
    const parsed = comptePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.compta.patchCompte(code, parsed.data);
    if (!updated) throw new NotFoundException(`Compte introuvable: ${code}`);
    return updated;
  }

  @Get('journaux')
  async journaux() {
    return this.compta.listJournaux();
  }

  // Écritures.
  @Get('ecritures')
  async ecritures(
    @Query('annee') anneeStr?: string,
    @Query('journal') journal?: string,
    @Query('q') q?: string,
    @Query('statut') statut?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    const page = Math.max(1, Number(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitStr) || 25));
    return this.compta.listEcritures({
      annee,
      journalCode: journal || undefined,
      q: q || undefined,
      statut: statut || undefined,
      page,
      limit,
    });
  }

  @Get('ecritures/:id')
  async ecriture(@Param('id') id: string) {
    const record = await this.compta.getEcriture(id);
    if (!record) throw new NotFoundException('Écriture introuvable');
    return record;
  }

  @Post('ecritures')
  async createEcriture(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = ecritureInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.compta.createEcriture(parsed.data as EcritureInput, actorFrom(req));
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Patch('ecritures/:id')
  async updateEcriture(@Param('id') id: string, @Body() body: unknown) {
    const parsed = ecritureInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.compta.updateEcriture(id, parsed.data as EcritureInput);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Post('ecritures/:id/valider')
  async validerEcriture(@Param('id') id: string) {
    try {
      return await this.compta.validerEcriture(id);
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Delete('ecritures/:id')
  async deleteEcriture(@Param('id') id: string) {
    try {
      const ok = await this.compta.deleteEcriture(id);
      if (!ok) throw new NotFoundException('Écriture introuvable');
      return { deleted: true };
    } catch (error) {
      toComptaHttp(error);
    }
  }

  @Post('ecritures/generer-ventes')
  async genererVentes(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = z.object({ annee: anneeSchema }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const crees = await this.compta.genererEcrituresVentes(parsed.data.annee, actorFrom(req));
      return { crees };
    } catch (error) {
      toComptaHttp(error);
    }
  }

  // Livres.
  @Get('livres/grand-livre')
  async grandLivre(@Query('compte') compte?: string, @Query('annee') anneeStr?: string) {
    if (!compte) throw new BadRequestException('Paramètre `compte` requis');
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.compta.grandLivre({ compteCode: compte, annee });
  }

  @Get('livres/balance')
  async balance(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.compta.balance(annee);
  }

  @Get('livres/etats')
  async etats(@Query('annee') anneeStr?: string) {
    const annee = anneeStr ? Number(anneeStr) : new Date().getFullYear();
    return this.compta.etatsSynthese(annee);
  }

  // Simulateur IS / CM / CSS — outil du comptable.
  @Get('outils/is')
  async simulateurIs(
    @Query('resultat') resultatStr?: string,
    @Query('produits') produitsStr?: string,
  ) {
    const profil = await this.compta.getProfil();
    const resultat = Number(resultatStr) || 0;
    const produits = Number(produitsStr) || 0;
    const is = computeIs(resultat, profil.tauxIs);
    const cm = computeCotisationMinimale(produits, profil.tauxCotisationMinimale);
    return {
      resultatFiscal: resultat,
      baseProduits: produits,
      is,
      cotisationMinimale: cm,
      impotDu: Math.max(is, cm),
      css: computeCss(resultat),
      tauxIs: profil.tauxIs,
    };
  }

  // Tableau de bord — vue d'ensemble de la situation de l'entreprise.
  @Get('dashboard')
  async dashboard() {
    const annee = new Date().getFullYear();
    const [profil, exercices, echeances, etats, tva] = await Promise.all([
      this.compta.getProfil(),
      this.compta.listExercices(),
      this.registres.echeancesOuvertes(),
      this.compta.etatsSynthese(annee),
      this.registres.listTva(annee),
    ]);

    const today = new Date();
    const classified = echeances.map((echeance) => ({
      ...echeance,
      urgence: classifyEcheance(echeance.dateEcheance, echeance.statut, today),
    }));
    const enRetard = classified.filter((e) => e.urgence === 'en_retard');
    const sous30j = classified.filter((e) => e.urgence === 'urgent' || e.urgence === 'proche');

    // Complétude de la fiche légale — le "statut juridique" à compléter.
    const manquants: string[] = [];
    if (!profil.identifiantFiscal) manquants.push('Identifiant fiscal (IF)');
    if (!profil.ice) manquants.push('ICE');
    if (!profil.registreCommerce) manquants.push('Registre de commerce');
    if (!profil.cnssAffiliation) manquants.push('Affiliation CNSS');
    if (!profil.taxeProfessionnelle) manquants.push('N° taxe professionnelle');

    const moisCourant = `${annee}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const tvaCourante =
      tva.find((t) => t.periodeKey === moisCourant) ??
      tva.find((t) => t.statut !== 'payee') ??
      null;

    return {
      profil,
      exercices,
      exerciceCourant: exercices.find((e) => e.annee === annee) ?? null,
      resultatProvisoire: etats.cpc.resultatNet,
      chiffreAffaires: etats.cpc.produitsExploitation,
      tresorerie: etats.bilan.tresorerieActif - etats.bilan.tresoreriePassif,
      echeances: classified.slice(0, 30),
      compteurs: {
        enRetard: enRetard.length,
        sous30Jours: sous30j.length,
        total: classified.length,
      },
      tvaCourante,
      ficheLegaleManquants: manquants,
      veille: VEILLE_REGLEMENTAIRE,
    };
  }
}

@Module({
  imports: [ComptaRepositoryModule, VaultModule],
  controllers: [ComptaCoreController, ComptaRegistresController],
})
export class ComptaModule {}
