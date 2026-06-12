import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Roles } from '../auth/auth.module';
import { TenderModule } from '../tender/tender.module';
import {
  TENDER_REPOSITORY,
  type TenderRepository,
} from '../tender/tender.repository';
import { VaultModule } from '../vault/vault.module';
import { computeReadiness } from '../vault/validity';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import { buildDigest, renderDigestFr } from './digest.domain';

@Controller('digest')
export class DigestController {
  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository,
  ) {}

  /** The 07:30 brief — JSON + rendered French text (email/WhatsApp body). */
  @Roles('marches', 'direction', 'admin-si', 'finance')
  @Get()
  async today() {
    const now = new Date();
    const [tenders, documents] = await Promise.all([
      this.tenders.findAll(),
      this.vault.findAll(),
    ]);
    const digest = buildDigest(tenders, computeReadiness(documents, now), now);
    return { ...digest, texte: renderDigestFr(digest) };
  }
}

@Module({
  imports: [TenderModule, VaultModule],
  controllers: [DigestController],
})
export class DigestModule {}
