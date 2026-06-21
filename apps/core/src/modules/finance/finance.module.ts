import {
  BadRequestException,
  Body,
  Controller,
  forwardRef,
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
import { ProjectModule } from '../project/project.module';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../project/project.repository';
import {
  CAUTION_REPOSITORY,
  DrizzleCautionRepository,
  InMemoryCautionRepository,
  type CautionRepository,
} from './caution.repository';
import {
  buildReceivables,
  summarizeCautions,
  type ReceivableInput,
} from './finance.domain';
import { EXPENSE_CATEGORIES } from './ledger.domain';
import {
  DrizzleFinanceLedgerRepository,
  FINANCE_LEDGER_REPOSITORY,
  InMemoryFinanceLedgerRepository,
  type FinanceLedgerRepository,
} from './ledger.repository';

const cautionInputSchema = z.object({
  kind: z.enum(['provisoire', 'definitive', 'retenue_remplacee']),
  reference: z.string().min(3).max(200),
  amountMad: z.number().positive().max(1_000_000_000),
  issuedAt: z.coerce.date(),
  tenderId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  bankName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const paymentInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  label: z.string().min(3).max(300),
  payerName: z.string().max(200).optional(),
  amountMad: z.number().positive().max(1_000_000_000),
  method: z.enum(['virement', 'cheque', 'espece', 'effet', 'autre']),
  transferReference: z.string().max(200).optional(),
  bankName: z.string().max(200).optional(),
  paidAt: z.coerce.date(),
  notes: z.string().max(2000).optional(),
});

const expenseInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  label: z.string().min(3).max(300),
  amountMad: z.number().positive().max(1_000_000_000),
  method: z.string().max(50).optional(),
  reference: z.string().max(200).optional(),
  supplierId: z.string().uuid().optional(),
  spentAt: z.coerce.date(),
  notes: z.string().max(2000).optional(),
});

const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

/**
 * Upper bound on rows returned by the journal list endpoints. Neither
 * /finance/payments nor /finance/expenses is paginated yet, so a hard cap keeps
 * a single request from streaming the entire ledger as it grows. Newest-first
 * ordering means the cap keeps the most recent entries.
 */
const LEDGER_LIST_LIMIT = 200;

@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(CAUTION_REPOSITORY) private readonly cautions: CautionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(FINANCE_LEDGER_REPOSITORY)
    private readonly ledger: FinanceLedgerRepository,
  ) {}

  /** Register a bank guarantee (cash locked until release). */
  @Roles('finance', 'direction', 'admin-si')
  @Post('cautions')
  async createCaution(@Body() body: unknown) {
    const parsed = cautionInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.cautions.create(parsed.data);
  }

  /** Guarantees register + locked-cash summary. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('cautions')
  async listCautions() {
    const records = await this.cautions.findAll();
    return {
      summary: summarizeCautions(records, new Date()),
      items: records,
    };
  }

  /** Release a guarantee (mainlevée obtained). */
  @Roles('finance', 'direction')
  @Post('cautions/:id/release')
  async releaseCaution(@Param('id') id: string) {
    const updated = await this.cautions.release(id, new Date());
    if (!updated) throw new NotFoundException(`Caution not found: ${id}`);
    new Logger('Finance').log(
      `caution.released ${updated.reference} (${updated.amountMad} MAD)`,
    );
    return updated;
  }

  /** Validated décomptes awaiting payment — aging for the TGR chase. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('receivables')
  async receivables() {
    // One project⋈situation query for the whole portfolio (no per-project N+1).
    const situations = await this.projects.listAllSituations();
    const inputs: ReceivableInput[] = situations.map((situation) => ({
      projectReference: situation.projectReference,
      buyerName: situation.buyerName,
      numero: situation.numero,
      netAPayerMad: situation.netAPayerMad,
      periodEnd: situation.periodEnd,
      status: situation.status,
    }));
    return buildReceivables(inputs, new Date());
  }

  /** Record an encaissement (recette) — TGR payment, acompte, avance. */
  @Roles('finance', 'direction', 'admin-si')
  @Post('payments')
  async createPayment(@Body() body: unknown) {
    const parsed = paymentInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ledger.createPayment(parsed.data);
  }

  /** Recettes journal, newest first; optionally scoped to one chantier. */
  @Roles('finance', 'direction', 'admin-si', 'marches')
  @Get('payments')
  async listPayments(@Query('projectId') projectId?: string) {
    return this.ledger.listPayments({ projectId, limit: LEDGER_LIST_LIMIT });
  }

  /** Record a dépense classified by category (validated against the closed list). */
  @Roles('finance', 'direction', 'terrain', 'admin-si')
  @Post('expenses')
  async createExpense(@Body() body: unknown) {
    const parsed = expenseInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ledger.createExpense(parsed.data);
  }

  /** Dépenses journal, newest first; filter by category and/or chantier. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('expenses')
  async listExpenses(
    @Query('category') category?: string,
    @Query('projectId') projectId?: string,
  ) {
    const parsedCategory = category
      ? expenseCategorySchema.safeParse(category)
      : undefined;
    if (parsedCategory && !parsedCategory.success) {
      throw new BadRequestException(parsedCategory.error.flatten());
    }
    return this.ledger.listExpenses({
      category: parsedCategory?.success ? parsedCategory.data : undefined,
      projectId,
      limit: LEDGER_LIST_LIMIT,
    });
  }

  /** Dépenses broken down by category — desc by spend, with a grand total. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('expenses/summary')
  async expenseSummary() {
    return this.ledger.expenseSummary();
  }

  /** Net cashflow (recettes − dépenses); optionally scoped to one chantier. */
  @Roles('finance', 'direction', 'admin-si')
  @Get('cashflow')
  async cashflow(@Query('projectId') projectId?: string) {
    return this.ledger.cashflow(projectId);
  }
}

const cautionRepositoryProvider = {
  provide: CAUTION_REPOSITORY,
  useFactory: (): CautionRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleCautionRepository(getDb(url));
    new Logger('FinanceModule').warn(
      'DATABASE_URL not set — finance uses a non-persistent in-memory repository',
    );
    return new InMemoryCautionRepository();
  },
};

const financeLedgerRepositoryProvider = {
  provide: FINANCE_LEDGER_REPOSITORY,
  useFactory: (): FinanceLedgerRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleFinanceLedgerRepository(getDb(url));
    new Logger('FinanceModule').warn(
      'DATABASE_URL not set — finance ledger uses a non-persistent in-memory repository',
    );
    return new InMemoryFinanceLedgerRepository();
  },
};

@Module({
  // forwardRef breaks the module cycle: ProjectModule imports FinanceModule for
  // the cost rollup (FINANCE_LEDGER_REPOSITORY), and FinanceModule imports
  // ProjectModule for PROJECT_REPOSITORY (receivables join).
  imports: [forwardRef(() => ProjectModule)],
  controllers: [FinanceController],
  providers: [cautionRepositoryProvider, financeLedgerRepositoryProvider],
  exports: [cautionRepositoryProvider, financeLedgerRepositoryProvider],
})
export class FinanceModule {}
