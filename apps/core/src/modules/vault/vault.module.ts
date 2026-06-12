import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { vaultDocumentInputSchema } from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import { getDb } from '../../db/client';
import {
  InMemoryObjectStorage,
  MAX_UPLOAD_BYTES,
  OBJECT_STORAGE,
  S3ObjectStorage,
  sanitizeFilename,
  validateUpload,
  type ObjectStorage,
} from './storage';
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

// Company documents are handled by the back-office circle — terrain excluded.
@Roles('marches', 'direction', 'admin-si', 'finance')
@Controller('vault')
export class VaultController {
  constructor(
    @Inject(VAULT_REPOSITORY) private readonly repository: VaultRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
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

  /** Attach the physical file to a vault document (hash-verified, MinIO). */
  @Post('documents/:id/file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Champ multipart "file" requis');
    const validation = validateUpload(file.mimetype, file.size);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const doc = await this.repository.findById(id);
    if (!doc) throw new NotFoundException(`Document introuvable: ${id}`);

    const key = `${doc.kind}/${doc.id}/${sanitizeFilename(file.originalname)}`;
    const stored = await this.storage.put(key, file.buffer, file.mimetype);
    const updated = await this.repository.updateFile(id, {
      bucket: stored.bucket,
      objectKey: stored.key,
      sha256: stored.sha256,
      mime: stored.mime,
    });
    if (!updated) throw new NotFoundException(`Document introuvable: ${id}`);
    return present(updated);
  }

  /** Short-lived presigned download URL for the attached file. */
  @Get('documents/:id/file')
  async fileUrl(@Param('id') id: string) {
    const doc = await this.repository.findById(id);
    if (!doc) throw new NotFoundException(`Document introuvable: ${id}`);
    if (!doc.objectKey) throw new NotFoundException('Aucun fichier attaché à ce document');
    const expiresInSeconds = 600;
    return {
      url: await this.storage.presignedGetUrl(doc.objectKey, expiresInSeconds),
      sha256: doc.sha256,
      expiresInSeconds,
    };
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

const objectStorageProvider = {
  provide: OBJECT_STORAGE,
  useFactory: (): ObjectStorage => {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;
    const bucket = process.env.VAULT_BUCKET ?? 'atlas-vault';
    if (endpoint && accessKey && secretKey) {
      return new S3ObjectStorage(bucket, { endpoint, accessKey, secretKey });
    }
    new Logger('VaultModule').warn(
      'S3_* not configured — vault files use non-persistent in-memory storage',
    );
    return new InMemoryObjectStorage(bucket);
  },
};

@Module({
  controllers: [VaultController],
  providers: [vaultRepositoryProvider, objectStorageProvider],
  exports: [vaultRepositoryProvider],
})
export class VaultModule implements OnModuleInit {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureBucket();
  }
}
