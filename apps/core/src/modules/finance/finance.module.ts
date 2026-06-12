import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
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

@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(CAUTION_REPOSITORY) private readonly cautions: CautionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
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
    const allProjects = await this.projects.findAll();
    const inputs: ReceivableInput[] = [];
    for (const project of allProjects) {
      const situations = await this.projects.listSituations(project.id);
      for (const situation of situations) {
        inputs.push({
          projectReference: project.reference,
          buyerName: project.buyerName,
          numero: situation.numero,
          netAPayerMad: situation.netAPayerMad,
          periodEnd: situation.periodEnd,
          status: situation.status,
        });
      }
    }
    return buildReceivables(inputs, new Date());
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

@Module({
  imports: [ProjectModule],
  controllers: [FinanceController],
  providers: [cautionRepositoryProvider],
  exports: [cautionRepositoryProvider],
})
export class FinanceModule {}
