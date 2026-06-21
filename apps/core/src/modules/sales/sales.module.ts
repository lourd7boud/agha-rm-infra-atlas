import {
  BadRequestException,
  Body,
  ConflictException,
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
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { DrizzleSalesRepository } from './sales.drizzle.repository';
import { InMemorySalesRepository } from './sales.repository';
import {
  SALES_REPOSITORY,
  type SalesRepository,
} from './sales.types';

// ── edge validation (zod) ────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().min(2).max(300),
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
  reference: z.string().min(2).max(100),
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
  reference: z.string().min(2).max(100),
  deliveryDate: z.coerce.date(),
  notes: z.string().max(2000).optional(),
  lines: z.array(deliveryLineSchema).min(1),
});

const invoiceSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  reference: z.string().min(2).max(100),
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

const invoiceStatusSchema = z.object({
  status: z.enum(['brouillon', 'envoyee', 'payee', 'annulee']),
});

@Controller('sales')
export class SalesController {
  constructor(
    @Inject(SALES_REPOSITORY) private readonly repository: SalesRepository,
  ) {}

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
  async listClients() {
    return this.repository.listClients();
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
  ) {
    const filter = quoteStatusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listQuotes({
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
  ) {
    const parsedStatus = z
      .enum(['brouillon', 'livre'])
      .safeParse(status);
    return this.repository.listDeliveryNotes({
      clientId: clientId || undefined,
      status: parsedStatus.success ? parsedStatus.data : undefined,
    });
  }

  @Roles('direction', 'finance', 'marches', 'travaux', 'admin-si')
  @Get('delivery-notes/:id')
  async getDeliveryNote(@Param('id') id: string) {
    const note = await this.repository.getDeliveryNote(id);
    if (!note) throw new NotFoundException('Bon de livraison introuvable');
    return note;
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
  ) {
    const parsedStatus = invoiceStatusSchema
      .pick({ status: true })
      .partial()
      .safeParse({ status });
    return this.repository.listInvoices({
      clientId: clientId || undefined,
      status: parsedStatus.success ? parsedStatus.data.status : undefined,
    });
  }

  @Roles('direction', 'finance', 'marches', 'admin-si')
  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string) {
    const invoice = await this.repository.getInvoice(id);
    if (!invoice) throw new NotFoundException('Facture introuvable');
    return invoice;
  }

  @Roles('direction', 'finance', 'admin-si')
  @Patch('invoices/:id/status')
  async setInvoiceStatus(@Param('id') id: string, @Body() body: unknown) {
    const parsed = invoiceStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.repository.getInvoice(id);
    if (!existing) throw new NotFoundException('Facture introuvable');
    if (existing.status === 'annulee') {
      throw new ConflictException('Facture déjà annulée');
    }
    const paidAt = parsed.data.status === 'payee' ? new Date() : undefined;
    if (parsed.data.status === 'payee') {
      new Logger('Sales').log(
        `invoice.paid ${existing.reference} (${existing.totalTtcMad} MAD TTC)`,
      );
    }
    return this.repository.setInvoiceStatus(id, parsed.data.status, paidAt);
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
  controllers: [SalesController],
  providers: [salesRepositoryProvider],
})
export class SalesModule {}
