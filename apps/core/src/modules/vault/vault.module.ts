import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { vaultDocumentInputSchema } from '@atlas/contracts';
import { getDb } from '../../db/client';
import { computeReadiness, computeStatus, dueAlerts } from './validity';
import {
  DrizzleVaultRepository,
  InMemoryVaultRepository,
  VAULT_REPOSITORY,
  type VaultDocumentRecord,
  type VaultRepository,
} from './vault.repository';

function present(doc: VaultDocumentRecord) {
  const today = new Date();
  return {
    ...doc,
    status: computeStatus(doc.kind, doc.expiresAt ?? null, today),
    dueAlerts: dueAlerts(doc.kind, doc.expiresAt ?? null, today),
  };
}

@Controller('vault')
export class VaultController {
  constructor(
    @Inject(VAULT_REPOSITORY) private readonly repository: VaultRepository,
  ) {}

  @Post('documents')
  async create(@Body() body: unknown) {
    const parsed = vaultDocumentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const created = await this.repository.create(parsed.data);
    return present(created);
  }

  @Get('documents')
  async list() {
    const docs = await this.repository.findAll();
    return docs.map(present);
  }

  @Get('readiness')
  async readiness() {
    const docs = await this.repository.findAll();
    return computeReadiness(docs, new Date());
  }
}

const vaultRepositoryProvider = {
  provide: VAULT_REPOSITORY,
  useFactory: (): VaultRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleVaultRepository(getDb(url));
    new Logger('VaultModule').warn(
      'DATABASE_URL not set — vault uses a non-persistent in-memory repository',
    );
    return new InMemoryVaultRepository();
  },
};

@Module({
  controllers: [VaultController],
  providers: [vaultRepositoryProvider],
})
export class VaultModule {}
