import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { ComptaRepositoryModule } from '../compta/compta-repository.module';
import {
  COMPTA_REPOSITORY,
  type ComptaRepository,
} from '../compta/compta.repository';
import { actorFrom, type AuthedRequest } from '../compta/compta-http.helpers';
import { DrizzleSalesRepository } from './sales.drizzle.repository';
import { InMemorySalesRepository } from './sales.repository';
import { SalesAccountingEventModule } from './sales-accounting-event.module';
import {
  SALES_REPOSITORY,
  type SalesRepository,
} from './sales.types';

// ── edge validation (zod) ────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().min(2).max(300),
  clientType: z.enum(['professionnel', 'particulier']).optional(),
  ice: z.string().max(20).optional(),
  contactName: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

const docLineSchema = z.object({
  designation: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().max(20).optional(),
  unitPriceMad: z.number().nonnegative().max(100_000_000),
  orderIndex: z.number().int().min(0).optional(),
});

const deliveryLineSchema = z.object({
  designation: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().max(20).optional(),
  orderIndex: z.number().int().min(0).optional(),
});

const quoteSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // No `reference`: the server assigns a gap-free sequential number (art. 145).
  objet: z.string().max(500).optional(),
  quoteDate: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  tvaPct: z.number().min(0).max(100),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineSchema).min(1),
});

const deliveryNoteSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  // No `reference`: the server assigns BL-{exercice}-NNNN sequentially.
  deliveryDate: z.coerce.date(),
  notes: z.string().max(2000).optional(),
  lines: z.array(deliveryLineSchema).min(1),
});

const invoiceSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  // No `reference`: the server assigns the legal sequential FAC-{exercice}-NNNN
  // (art. 145 CGI) — invoice numbers must be system-controlled, never user-typed.
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  tvaPct: z.number().min(0).max(100),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineSchema).min(1),
});

const quoteStatusSchema = z.object({
  status: z.enum(['brouillon', 'envoye', 'accepte', 'refuse', 'expire']),
});

const deliveryNoteStatusSchema = z.object({
  status: z.enum(['brouillon', 'livre']),
});

const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const paymentSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(['virement', 'cheque', 'especes', 'carte']),
  treasuryAccount: z.string().regex(/^\d{4,6}$/),
  valueDate: civilDateSchema,
  reference: z.string().min(1).max(200).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

const paymentReversalSchema = z.object({
  valueDate: civilDateSchema,
  idempotencyKey: z.string().min(8).max(200),
});

const creditNoteSchema = z.object({
  creditDate: civilDateSchema,
  totalHtCents: z.number().int().nonnegative(),
  tvaCents: z.number().int().nonnegative(),
  reason: z.string().min(2).max(500),
});

const updateInvoiceDraftSchema = z.object({
  version: z.number().int().positive(),
  dueDate: civilDateSchema.optional(),
  paymentTerms: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

// ── pagination (datao-parity: DB-side LIMIT/OFFSET) ──────────────────────────
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Parse the ?page / ?limit query into a bounded DB page window. */
function parsePaging(page?: string, limit?: string): { limit: number; offset: number } {
  const pageNum = Math.floor(Number(page));
  const p = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 0;
  const limitNum = Math.floor(Number(limit));
  const size =
    Number.isFinite(limitNum) && limitNum > 0
      ? Math.min(limitNum, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { limit: size, offset: p * size };
}

@Controller('sales')
export class SalesController {
  constructor(
    @Inject(SALES_REPOSITORY) private readonly repository: SalesRepository,
    @Inject(COMPTA_REPOSITORY) private readonly compta: ComptaRepository,
  ) {}

  private actor(req: AuthedRequest): string {
    const actor = actorFrom(req);
    if (!actor) throw new BadRequestException('Identité acteur requise.');
    return actor;
  }

  // ── clients ─────────────────────────────────────────────────────────────────

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Post('clients')
  async createClient(@Body() body: unknown) {
    const parsed = clientSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.upsertClient(parsed.data);
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('clients')
  async listClients(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repository.listClients(parsePaging(page, limit));
  }

  // Declared BEFORE clients/:id so the static path wins the route match.
  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('clients/summary')
  async clientsSummary() {
    return this.repository.clientsSummary();
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('clients/:id')
  async getClient(@Param('id') id: string) {
    const client = await this.repository.getClient(id);
    if (!client) throw new NotFoundException('Client introuvable');
    return client;
  }

  // ── quotes / devis ────────────────────────────────────────────────────────

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Post('quotes')
  async createQuote(@Body() body: unknown) {
    const parsed = quoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const client = await this.repository.getClient(parsed.data.clientId);
    if (!client) throw new NotFoundException('Client introuvable');
    return this.repository.createQuote(parsed.data);
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('quotes')
  async listQuotes(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filter = quoteStatusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listQuotes(
      {
        clientId: clientId || undefined,
        status: filter.success ? filter.data.status : undefined,
      },
      parsePaging(page, limit),
    );
  }

  // Declared BEFORE quotes/:id so the static path wins the route match.
  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('quotes/summary')
  async quotesSummary(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
  ) {
    const filter = quoteStatusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.quotesSummary({
      clientId: clientId || undefined,
      status: filter.success ? filter.data.status : undefined,
    });
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('quotes/:id')
  async getQuote(@Param('id') id: string) {
    const quote = await this.repository.getQuote(id);
    if (!quote) throw new NotFoundException('Devis introuvable');
    return quote;
  }

  @Roles('direction', 'finance', 'marches')
  @Post('quotes/:id/issue')
  async issueQuote(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.repository.issueQuote(id, this.actor(req), new Date());
  }

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Patch('quotes/:id/status')
  async setQuoteStatus(@Param('id') id: string, @Body() body: unknown) {
    const parsed = quoteStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.repository.setQuoteStatus(id, parsed.data.status);
    if (!updated) throw new NotFoundException('Devis introuvable');
    return updated;
  }

  // ── delivery notes / bons de livraison ──────────────────────────────────────

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Post('delivery-notes')
  async createDeliveryNote(@Body() body: unknown) {
    const parsed = deliveryNoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const client = await this.repository.getClient(parsed.data.clientId);
    if (!client) throw new NotFoundException('Client introuvable');
    return this.repository.createDeliveryNote(parsed.data);
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('delivery-notes')
  async listDeliveryNotes(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = z
      .enum(['brouillon', 'livre'])
      .safeParse(status);
    return this.repository.listDeliveryNotes(
      {
        clientId: clientId || undefined,
        status: parsedStatus.success ? parsedStatus.data : undefined,
      },
      parsePaging(page, limit),
    );
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('delivery-notes/:id')
  async getDeliveryNote(@Param('id') id: string) {
    const note = await this.repository.getDeliveryNote(id);
    if (!note) throw new NotFoundException('Bon de livraison introuvable');
    return note;
  }

  @Roles('direction', 'finance', 'marches')
  @Post('delivery-notes/:id/issue')
  async issueDeliveryNote(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.repository.issueDeliveryNote(id, this.actor(req), new Date());
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Patch('delivery-notes/:id/status')
  async setDeliveryNoteStatus(@Param('id') id: string, @Body() body: unknown) {
    const parsed = deliveryNoteStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const updated = await this.repository.setDeliveryNoteStatus(
      id,
      parsed.data.status,
    );
    if (!updated) throw new NotFoundException('Bon de livraison introuvable');
    return updated;
  }

  // ── invoices / factures ─────────────────────────────────────────────────────

  @Roles('direction', 'finance', 'admin-si')
  @Post('invoices')
  async createInvoice(@Body() body: unknown) {
    const parsed = invoiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const client = await this.repository.getClient(parsed.data.clientId);
    if (!client) throw new NotFoundException('Client introuvable');
    return this.repository.createInvoice(parsed.data);
  }

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Get('invoices')
  async listInvoices(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = z
      .enum(['brouillon', 'emise', 'annulee', 'envoyee', 'payee'])
      .safeParse(status);
    return this.repository.listInvoices(
      {
        clientId: clientId || undefined,
        status: parsedStatus.success ? parsedStatus.data : undefined,
      },
      parsePaging(page, limit),
    );
  }

  // Declared BEFORE invoices/:id so the static path wins the route match.
  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Get('invoices/summary')
  async invoicesSummary(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
  ) {
    const parsedStatus = z
      .enum(['brouillon', 'emise', 'annulee', 'envoyee', 'payee'])
      .safeParse(status);
    return this.repository.invoicesSummary({
      clientId: clientId || undefined,
      status: parsedStatus.success ? parsedStatus.data : undefined,
    });
  }

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string) {
    const invoice = await this.repository.getInvoice(id);
    if (!invoice) throw new NotFoundException('Facture introuvable');
    return invoice;
  }

  @Roles('direction', 'finance')
  @Post('invoices/:id/issue')
  async issueInvoice(@Param('id') id: string, @Req() req: AuthedRequest) {
    const invoice = await this.repository.getInvoice(id);
    if (!invoice) throw new NotFoundException('Facture introuvable');
    const client = await this.repository.getClient(invoice.clientId);
    if (!client) throw new NotFoundException('Client introuvable');
    if (!client.address?.trim()) {
      throw new BadRequestException('Adresse du client requise pour émettre.');
    }
    if (client.clientType === 'professionnel' && !client.ice?.trim()) {
      throw new BadRequestException(
        'ICE du client professionnel requis pour émettre.',
      );
    }
    const profile = await this.compta.getProfil();
    const requiredSeller = [
      profile.raisonSociale,
      profile.adresse,
      profile.ice,
      profile.identifiantFiscal,
      profile.registreCommerce,
    ];
    if (requiredSeller.some((value) => !value?.trim())) {
      throw new BadRequestException(
        'Profil légal vendeur incomplet pour émettre la facture.',
      );
    }
    return this.repository.issueInvoice(id, this.actor(req), new Date(), {
      legalName: profile.raisonSociale,
      address: profile.adresse!,
      ice: profile.ice!,
      taxId: profile.identifiantFiscal!,
      tradeRegister: profile.registreCommerce!,
      professionalTaxId: profile.taxeProfessionnelle ?? undefined,
    });
  }

  @Roles('direction', 'finance')
  @Patch('invoices/:id')
  async updateInvoiceDraft(@Param('id') id: string, @Body() body: unknown) {
    const parsed = updateInvoiceDraftSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.updateDraftInvoice(id, parsed.data);
  }

  @Roles('direction', 'finance')
  @Delete('invoices/:id')
  async deleteInvoiceDraft(@Param('id') id: string) {
    await this.repository.deleteDraftInvoice(id);
    return { deleted: true };
  }

  @Roles('direction', 'finance')
  @Post('invoices/:id/payments')
  async recordPayment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.recordPayment({
      invoiceId: id,
      ...parsed.data,
      actor: this.actor(req),
    });
  }

  @Roles('direction', 'finance')
  @Post('invoices/:id/payments/:paymentId/reverse')
  async reversePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = paymentReversalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.reversePayment({
      invoiceId: id,
      paymentId,
      ...parsed.data,
      actor: this.actor(req),
    });
  }

  @Roles('direction', 'finance')
  @Post('invoices/:id/credit-notes')
  async createCreditNote(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = creditNoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.createCreditNote({
      invoiceId: id,
      ...parsed.data,
      createdBy: this.actor(req),
    });
  }

  @Roles('direction', 'finance')
  @Post('credit-notes/:id/issue')
  async issueCreditNote(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.repository.issueCreditNote(id, this.actor(req), new Date());
  }

}

const salesRepositoryProvider = {
  provide: SALES_REPOSITORY,
  useFactory: (): SalesRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleSalesRepository(getDb(url));
    new Logger('SalesModule').warn(
      'DATABASE_URL not set — sales uses a non-persistent in-memory repository',
    );
    return new InMemorySalesRepository();
  },
};

@Module({
  imports: [ComptaRepositoryModule, SalesAccountingEventModule],
  controllers: [SalesController],
  providers: [salesRepositoryProvider],
  exports: [salesRepositoryProvider, SalesAccountingEventModule],
})
export class SalesModule {}
