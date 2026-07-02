import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { ExpertService } from './expert.service';

// Hard ceiling = the offre-anormalement-basse regulatory threshold (décret
// 2-22-431, mirrored in pricing.domain SEUIL_OFFRE_ANORMALEMENT_BASSE_PCT):
// a caller-supplied rabais bypasses the scenario engine, so the schema itself
// must refuse a legally non-compliant discount.
const bpuBodySchema = z
  .object({
    rabaisPct: z.number().min(0).max(25).optional(),
  })
  .strict()
  .optional();

/**
 * Agent AGHA-RM-INFRA — the expert surface. All routes are staff-guarded;
 * the analyze/bpu POSTs are throttled because each one costs LLM budget.
 */
@Controller('expert')
export class ExpertController {
  constructor(@Inject(ExpertService) private readonly expert: ExpertService) {}

  /** What the agent knows today — market map, competition, rebate memory. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('knowledge')
  async knowledge() {
    return this.expert.getKnowledge();
  }

  /** Full expert analysis of one consultation (persisted on the tender). */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tenders/:id/analyze')
  async analyze(@Param('id') id: string) {
    return this.expert.analyzeTender(id);
  }

  /** Last stored analysis (404 before the first run). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/analysis')
  async analysis(@Param('id') id: string) {
    return this.expert.getAnalysis(id);
  }

  /** Fill the bordereau des prix (optional body: { rabaisPct }). */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tenders/:id/bpu')
  async proposeBpu(@Param('id') id: string, @Body() body: unknown) {
    const parsed = bpuBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        'rabaisPct doit être un nombre entre 0 et 25 (seuil offre anormalement basse)',
      );
    }
    return this.expert.proposeBpu(id, parsed.data ?? {});
  }

  /** Last stored BPU proposal (404 before the first run). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/bpu')
  async bpu(@Param('id') id: string) {
    return this.expert.getBpu(id);
  }

  /** Administrative + financial submission checklist. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('tenders/:id/dossier-admin')
  async dossierAdmin(@Param('id') id: string) {
    return this.expert.adminDossier(id);
  }
}
