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
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import { buildPayables, type PayableInput } from './supply.domain';
import {
  DrizzleSupplyRepository,
  InMemorySupplyRepository,
  SUPPLY_REPOSITORY,
  type SupplyRepository,
} from './supply.repository';

// ── pagination (datao-parity: DB-side LIMIT/OFFSET) ──────────────────────────
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Parse the ?page / ?limit query into a bounded DB page window. */
function parsePaging(
  page?: string,
  limit?: string,
): { limit: number; offset: number } {
  const pageNum = Math.floor(Number(page));
  const p = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 0;
  const limitNum = Math.floor(Number(limit));
  const size =
    Number.isFinite(limitNum) && limitNum > 0
      ? Math.min(limitNum, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { limit: size, offset: p * size };
}

const supplierSchema = z.object({
  name: z.string().min(2).max(300),
  ice: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
});

const orderLineSchema = z.object({
  designation: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().max(20).optional(),
  unitPriceMad: z.number().nonnegative().max(100_000_000),
  orderIndex: z.number().int().nonnegative().optional(),
});

const orderSchema = z.object({
  supplierId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  reference: z.string().min(2).max(100),
  objet: z.string().min(3).max(500),
  amountMad: z.number().positive().max(100_000_000),
  orderedAt: z.coerce.date(),
  // Optional bon-de-commande lines. When present, the repository overrides
  // amountMad with Σ lineTotal; when absent, amountMad above is used as today.
  lines: z.array(orderLineSchema).max(200).optional(),
});

const invoiceSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  reference: z.string().min(2).max(100),
  amountMad: z.number().positive().max(100_000_000),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
});

const ORDER_TRANSITIONS: Record<string, string[]> = {
  brouillon: ['envoye', 'annule'],
  envoye: ['recu', 'annule'],
  recu: [],
  annule: [],
};

@Controller('supply')
export class SupplyController {
  constructor(
    @Inject(SUPPLY_REPOSITORY) private readonly repository: SupplyRepository,
  ) {}

  @Roles('finance', 'direction', 'travaux', 'admin-si')
  @Post('suppliers')
  async createSupplier(@Body() body: unknown) {
    const parsed = supplierSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.createSupplier(parsed.data);
  }

  @Roles('finance', 'direction', 'travaux', 'marches', 'admin-si')
  @Get('suppliers')
  async listSuppliers() {
    return this.repository.listSuppliers();
  }

  /** Bon de commande. */
  @Roles('finance', 'direction', 'travaux', 'admin-si')
  @Post('orders')
  async createOrder(@Body() body: unknown) {
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const supplier = await this.repository.findSupplierById(
      parsed.data.supplierId,
    );
    if (!supplier) throw new NotFoundException('Fournisseur introuvable');
    return this.repository.createOrder(parsed.data);
  }

  @Roles('finance', 'direction', 'travaux', 'marches', 'admin-si')
  @Get('orders')
  async listOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repository.listOrders(parsePaging(page, limit));
  }

  // Declared BEFORE orders/:id so the static path wins the route match.
  @Roles('finance', 'direction', 'travaux', 'marches', 'admin-si')
  @Get('orders/summary')
  async ordersSummary() {
    return this.repository.ordersSummary();
  }

  /** Bon de commande détaillé — order + its line items. */
  @Roles('finance', 'direction', 'travaux', 'marches', 'admin-si')
  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    const order = await this.repository.getOrder(id);
    if (!order) throw new NotFoundException(`Order not found: ${id}`);
    return order;
  }

  @Roles('finance', 'direction')
  @Post('orders/:id/transition')
  async transitionOrder(@Param('id') id: string, @Body() body: unknown) {
    const parsed = z.object({ to: z.string() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const order = await this.repository.getOrder(id);
    if (!order) throw new NotFoundException(`Order not found: ${id}`);
    if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(parsed.data.to)) {
      throw new ConflictException(
        `Illegal transition: ${order.status} -> ${parsed.data.to}`,
      );
    }
    return this.repository.setOrderStatus(id, parsed.data.to as never);
  }

  /** Facture fournisseur. */
  @Roles('finance', 'direction', 'admin-si')
  @Post('invoices')
  async createInvoice(@Body() body: unknown) {
    const parsed = invoiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const supplier = await this.repository.findSupplierById(
      parsed.data.supplierId,
    );
    if (!supplier) throw new NotFoundException('Fournisseur introuvable');
    return this.repository.createInvoice(parsed.data);
  }

  @Roles('finance', 'direction', 'admin-si')
  @Get('invoices')
  async listInvoices(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repository.listInvoices(parsePaging(page, limit));
  }

  /** Validate (recue→validee). */
  @Roles('finance', 'direction')
  @Post('invoices/:id/validate')
  async validateInvoice(@Param('id') id: string) {
    const invoice = await this.repository.findInvoiceById(id);
    if (!invoice) throw new NotFoundException(`Invoice not found: ${id}`);
    if (invoice.status !== 'recue') {
      throw new ConflictException(`Déjà ${invoice.status}`);
    }
    return this.repository.setInvoiceStatus(id, 'validee');
  }

  /** Pay (validee→payee). */
  @Roles('finance', 'direction')
  @Post('invoices/:id/pay')
  async payInvoice(@Param('id') id: string) {
    const invoice = await this.repository.findInvoiceById(id);
    if (!invoice) throw new NotFoundException(`Invoice not found: ${id}`);
    if (invoice.status !== 'validee') {
      throw new ConflictException('Seules les factures validées sont payables');
    }
    new Logger('Supply').log(
      `invoice.paid ${invoice.reference} (${invoice.amountMad} MAD)`,
    );
    return this.repository.setInvoiceStatus(id, 'payee', new Date());
  }

  /** Dettes fournisseurs — aging mirror of the receivables side. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('payables')
  async payables() {
    const [invoices, suppliers] = await Promise.all([
      // Ages the WHOLE set — the payables aggregate cannot run off one page.
      this.repository.listAllInvoices(),
      this.repository.listSuppliers(),
    ]);
    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const inputs: PayableInput[] = invoices.map((invoice) => ({
      supplierName: nameById.get(invoice.supplierId) ?? 'Fournisseur',
      reference: invoice.reference,
      amountMad: invoice.amountMad,
      dueDate: invoice.dueDate,
      status: invoice.status,
    }));
    return buildPayables(inputs, new Date());
  }
}

const supplyRepositoryProvider = {
  provide: SUPPLY_REPOSITORY,
  useFactory: (): SupplyRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleSupplyRepository(getDb(url));
    new Logger('SupplyModule').warn(
      'DATABASE_URL not set — supply uses a non-persistent in-memory repository',
    );
    return new InMemorySupplyRepository();
  },
};

@Module({
  controllers: [SupplyController],
  providers: [supplyRepositoryProvider],
})
export class SupplyModule {}
