import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Headers,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  claimBidSigningTaskSchema,
  cancelBidSigningTaskSchema,
  createBidSigningTaskSchema,
  bidSignedArtifactMetadataSchema,
  startBidWorkspaceSchema,
} from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
import { actorFrom, type BidRequest } from './bid.controller';
import {
  BidSigningConflictError,
  BidSigningService,
  BidSigningStateError,
} from './bid-signing.service';
import {
  BidSigningArtifactService,
  BidSigningArtifactStateError,
} from './bid-signing-artifact.service';
import {
  SigningUploadConcurrencyGuard,
  SigningUploadReleaseInterceptor,
} from './bid-signing-upload-limiter';

const COMPANY_ID = process.env.ATLAS_COMPANY_ID ?? 'agha-rm-infra';

@Injectable()
export class SigningLeaseGuard implements CanActivate {
  constructor(
    @Inject(BidSigningService) private readonly service: BidSigningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params?: { taskId?: string };
      headers?: { 'x-atlas-signing-lease'?: string };
    }>();
    const taskId = request.params?.taskId;
    const lease = request.headers?.['x-atlas-signing-lease'];
    if (!taskId || !lease) throw new UnauthorizedException('Signing lease rejected');
    try {
      await this.service.authorizeLease(
        parseUuid(taskId),
        lease,
        actorFrom(request as BidRequest).sub,
      );
      return true;
    } catch {
      throw new UnauthorizedException('Signing lease rejected');
    }
  }
}

@Controller('bid/signing')
@Roles('marches', 'direction', 'admin-si')
export class BidSigningController {
  constructor(
    @Inject(BidSigningService) private readonly service: BidSigningService,
  ) {}

  @Post('workspaces/:id/tasks')
  async create(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const workspaceId = parseUuid(id);
    const input = createBidSigningTaskSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.createTask(
        COMPANY_ID,
        workspaceId,
        input.data,
        actorFrom(request),
      );
    } catch (error) {
      if (error instanceof BidSigningConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof BidSigningStateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('workspaces/:id/tasks/active')
  getActive(@Param('id') id: string) {
    return this.service.getActiveTask(COMPANY_ID, parseUuid(id));
  }

  @Post('workspaces/:id/tasks/:taskId/cancel')
  async cancel(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const input = cancelBidSigningTaskSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.cancelTask(
        COMPANY_ID,
        parseUuid(id),
        parseUuid(taskId),
        input.data,
        actorFrom(request),
      );
    } catch (error) {
      if (error instanceof BidSigningConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof BidSigningStateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

/**
 * Task-scoped bridge surface. OIDC binds the task to the assigned signer while
 * the one-time pairing/lease secret acts as a second, task-scoped capability.
 */
@Controller('bid/signing/bridge')
@Roles('marches', 'direction', 'admin-si')
export class BidSigningBridgeController {
  constructor(
    @Inject(BidSigningService) private readonly service: BidSigningService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(BidSigningArtifactService)
    private readonly artifacts: BidSigningArtifactService,
  ) {}

  @Post('claim')
  async claim(@Req() request: BidRequest, @Body() body: unknown) {
    const input = claimBidSigningTaskSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.claimTask(input.data, actorFrom(request));
    } catch (error) {
      if (
        error instanceof BidSigningConflictError ||
        error instanceof BidSigningStateError
      ) {
        throw new UnauthorizedException('Signing task claim rejected');
      }
      throw error;
    }
  }

  @Get('tasks/:taskId')
  async status(
    @Req() request: BidRequest,
    @Param('taskId') taskId: string,
    @Headers('x-atlas-signing-lease') leaseSecret?: string,
  ) {
    const parsedTaskId = parseUuid(taskId);
    if (!leaseSecret) throw new UnauthorizedException('Missing signing lease');
    try {
      return await this.service.authorizeLease(
        parsedTaskId,
        leaseSecret,
        actorFrom(request).sub,
      );
    } catch (error) {
      if (
        error instanceof BidSigningConflictError ||
        error instanceof BidSigningStateError
      ) {
        throw new UnauthorizedException('Signing lease rejected');
      }
      throw error;
    }
  }

  @Get('tasks/:taskId/files/:fileId')
  async download(
    @Req() request: BidRequest,
    @Param('taskId') taskId: string,
    @Param('fileId') fileId: string,
    @Headers('x-atlas-signing-lease') leaseSecret?: string,
  ): Promise<StreamableFile> {
    const parsedTaskId = parseUuid(taskId);
    const parsedFileId = parseUuid(fileId);
    if (!leaseSecret) throw new UnauthorizedException('Missing signing lease');
    try {
      const snapshot = await this.service.authorizeLease(
        parsedTaskId,
        leaseSecret,
        actorFrom(request).sub,
      );
      const file = snapshot.files.find((candidate) => candidate.id === parsedFileId);
      if (!file) throw new UnauthorizedException('Signing file access rejected');
      const object = await this.storage.getObject(file.objectKey);
      if (
        object.sizeBytes !== undefined &&
        object.sizeBytes !== file.sizeBytes
      ) {
        throw new UnauthorizedException('Signing input integrity mismatch');
      }
      return new StreamableFile(object.body, {
        type: file.mime,
        length: file.sizeBytes,
        disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (
        error instanceof BidSigningConflictError ||
        error instanceof BidSigningStateError
      ) {
        throw new UnauthorizedException('Signing lease rejected');
      }
      throw error;
    }
  }

  @Post('tasks/:taskId/files/:fileId/artifacts')
  @UseGuards(SigningLeaseGuard, SigningUploadConcurrencyGuard)
  @UseInterceptors(
    SigningUploadReleaseInterceptor,
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async uploadArtifact(
    @Req() request: BidRequest,
    @Param('taskId') taskId: string,
    @Param('fileId') fileId: string,
    @Headers('x-atlas-signing-lease') leaseSecret: string | undefined,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const parsedTaskId = parseUuid(taskId);
    const parsedFileId = parseUuid(fileId);
    if (!leaseSecret || !file) {
      throw new UnauthorizedException('Signing artifact upload rejected');
    }
    const metadata = bidSignedArtifactMetadataSchema.safeParse(body);
    if (!metadata.success) throw new BadRequestException(metadata.error.flatten());
    try {
      return await this.artifacts.stage(
        parsedTaskId,
        leaseSecret,
        actorFrom(request).sub,
        parsedFileId,
        {
          filename: file.originalname,
          mime: file.mimetype,
          body: file.buffer,
        },
        metadata.data,
      );
    } catch (error) {
      if (error instanceof BidSigningArtifactStateError) {
        throw new UnauthorizedException('Signing artifact upload rejected');
      }
      throw error;
    }
  }
}

function parseUuid(value: string): string {
  const parsed = startBidWorkspaceSchema.shape.tenderId.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}
