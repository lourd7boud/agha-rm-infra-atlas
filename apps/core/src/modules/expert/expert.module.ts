import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { TenderModule } from '../tender/tender.module';
import { VaultModule } from '../vault/vault.module';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';

/**
 * Agent AGHA-RM-INFRA — the company's public-procurement expert. Pulls its
 * grounding from the modules that already own the data: TenderModule
 * (catalogue + DCE extractions), IntelModule (published bids + rebate
 * calibration), BrainModule (LLM), VaultModule (company documents).
 */
@Module({
  imports: [TenderModule, IntelModule, BrainModule, VaultModule],
  controllers: [ExpertController],
  providers: [ExpertService],
})
export class ExpertModule {}
