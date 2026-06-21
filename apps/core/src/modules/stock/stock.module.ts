import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import {
  DrizzleStockRepository,
  InMemoryStockRepository,
  STOCK_REPOSITORY,
  type MovementFilter,
  type StockRepository,
} from './stock.repository';

const materialSchema = z.object({
  code: z.string().min(1).max(60),
  designation: z.string().min(2).max(300),
  unit: z.string().min(1).max(30),
  category: z.string().max(100).optional(),
  unitCostMad: z.number().nonnegative().max(100_000_000).optional(),
});

const depotSchema = z.object({
  name: z.string().min(2).max(200),
  location: z.string().max(300).optional(),
});

// A movement's required depots follow the signing convention in stock.domain.ts:
//   initial / purchase / adjustment → toDepotId   (lands stock in a depot)
//   consumption                     → fromDepotId  (draws stock from a depot)
//   transfer                        → both depots  (moves between two depots)
// adjustment alone may carry a negative quantity (corrections); all other kinds
// require a strictly positive quantity. superRefine rejects shapes the domain
// fold would otherwise silently ignore.
const movementSchema = z
  .object({
    kind: z.enum([
      'initial',
      'purchase',
      'transfer',
      'consumption',
      'adjustment',
    ]),
    materialId: z.string().uuid(),
    quantity: z.number().finite().max(100_000_000),
    unitCostMad: z.number().nonnegative().max(100_000_000).optional(),
    fromDepotId: z.string().uuid().optional(),
    toDepotId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    reference: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== 'adjustment' && value.quantity <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'quantity must be positive',
      });
    }
    const needsTo =
      value.kind === 'initial' ||
      value.kind === 'purchase' ||
      value.kind === 'adjustment' ||
      value.kind === 'transfer';
    const needsFrom =
      value.kind === 'consumption' || value.kind === 'transfer';
    if (needsTo && !value.toDepotId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toDepotId'],
        message: `toDepotId is required for ${value.kind}`,
      });
    }
    if (needsFrom && !value.fromDepotId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromDepotId'],
        message: `fromDepotId is required for ${value.kind}`,
      });
    }
  });

const movementFilterSchema = z.object({
  depotId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

@Controller('stock')
export class StockController {
  constructor(
    @Inject(STOCK_REPOSITORY) private readonly repository: StockRepository,
  ) {}

  /** Matériau du catalogue (idempotent sur le code). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('materials')
  async upsertMaterial(@Body() body: unknown) {
    const parsed = materialSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const outcome = await this.repository.upsertMaterial(parsed.data);
    return { outcome };
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('materials')
  async listMaterials() {
    return this.repository.listMaterials();
  }

  /** Dépôt / magasin (idempotent sur le nom). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('depots')
  async upsertDepot(@Body() body: unknown) {
    const parsed = depotSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const outcome = await this.repository.upsertDepot(parsed.data);
    return { outcome };
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('depots')
  async listDepots() {
    return this.repository.listDepots();
  }

  /** Mouvement de stock — journal append-only (entrée/sortie/transfert). */
  @Roles('travaux', 'direction', 'terrain', 'admin-si')
  @Post('movements')
  async recordMovement(@Body() body: unknown) {
    const parsed = movementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.recordMovement(parsed.data);
  }

  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('movements')
  async listMovements(@Query() query: unknown) {
    const parsed = movementFilterSchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const filter: MovementFilter = parsed.data;
    return this.repository.listMovements(filter);
  }

  /** Soldes par (dépôt, matériau), repliés depuis le journal. */
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('balances')
  async balances() {
    return this.repository.balances();
  }

  /** Consommation matériaux valorisée d'un chantier. */
  @Roles('travaux', 'direction', 'terrain', 'finance', 'admin-si')
  @Get('projects/:id/consumption')
  async projectConsumption(@Param('id') id: string) {
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.repository.projectConsumption(parsed.data);
  }
}

const stockRepositoryProvider = {
  provide: STOCK_REPOSITORY,
  useFactory: (): StockRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleStockRepository(getDb(url));
    new Logger('StockModule').warn(
      'DATABASE_URL not set — stock uses a non-persistent in-memory repository',
    );
    return new InMemoryStockRepository();
  },
};

@Module({
  controllers: [StockController],
  providers: [stockRepositoryProvider],
  // Exported so ProjectModule can inject STOCK_REPOSITORY for the cost rollup.
  exports: [stockRepositoryProvider],
})
export class StockModule {}
