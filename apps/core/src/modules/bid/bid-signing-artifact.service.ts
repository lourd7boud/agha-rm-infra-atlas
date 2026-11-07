import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BidSignedArtifactMetadata } from '@atlas/contracts';
import {
  OBJECT_STORAGE,
  sanitizeFilename,
  sha256Hex,
  type ObjectStorage,
} from '../vault/storage';
import { hashSigningSecret } from './bid-signing.domain';
import {
  BID_SIGNING_REPOSITORY,
  type BidSigningArtifactRecord,
  type BidSigningRepository,
} from './bid-signing.repository';

const MAX_SIGNED_ARTIFACT_BYTES = 50 * 1024 * 1024;
const UPLOAD_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

export class BidSigningArtifactStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidSigningArtifactStateError';
  }
}

export interface BidSignedArtifactUpload {
  filename: string;
  mime: string;
  body: Buffer;
}

@Injectable()
export class BidSigningArtifactService {
  private readonly logger = new Logger(BidSigningArtifactService.name);

  constructor(
    @Inject(BID_SIGNING_REPOSITORY)
    private readonly repository: BidSigningRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async stage(
    taskId: string,
    leaseSecret: string,
    claimantSub: string,
    packageFileId: string,
    upload: BidSignedArtifactUpload,
    metadata: BidSignedArtifactMetadata,
  ): Promise<BidSigningArtifactRecord> {
    if (upload.body.length === 0 || upload.body.length > MAX_SIGNED_ARTIFACT_BYTES) {
      throw new BidSigningArtifactStateError('Signed artifact size is invalid');
    }
    const now = new Date();
    const authorized = await this.repository.authorizeLease({
      taskId,
      claimantSub,
      leaseSecretSha256: hashSigningSecret(leaseSecret),
      now,
    });
    if (authorized.kind !== 'authorized') {
      throw new BidSigningArtifactStateError('Signing lease rejected');
    }
    const input = authorized.snapshot.files.find((file) => file.id === packageFileId);
    if (!input) throw new BidSigningArtifactStateError('Signing file not found');
    if (upload.mime !== input.mime) {
      throw new BidSigningArtifactStateError('Signed artifact MIME differs from input');
    }
    const sha256 = sha256Hex(upload.body);
    if (sha256 === input.sha256) {
      throw new BidSigningArtifactStateError(
        'Signed artifact is identical to frozen input',
      );
    }
    const filename = sanitizeFilename(upload.filename || `signed-${input.filename}`);
    const objectKey = `bid/${authorized.snapshot.task.workspaceId}/signing/${taskId}/${packageFileId}/${sha256}/${filename}`;
    const reservationResult = await this.repository.reserveArtifactUpload({
      taskId,
      packageFileId,
      claimantSub,
      leaseSecretSha256: hashSigningSecret(leaseSecret),
      objectKey,
      sha256,
      expiresAt: new Date(now.getTime() + UPLOAD_RESERVATION_TTL_MS),
      now,
    });
    if (reservationResult.kind === 'artifact_recorded') {
      return reservationResult.artifact;
    }
    if (reservationResult.kind !== 'reserved') {
      throw new BidSigningArtifactStateError(
        reservationResult.kind === 'invalid_state'
          ? reservationResult.reason
          : reservationResult.kind,
      );
    }
    const reservation = reservationResult.reservation;
    const existedBeforeUpload = await this.storage.exists(objectKey);
    const stored = await this.storage.put(objectKey, upload.body, upload.mime);
    if (stored.sha256 !== sha256 || stored.sizeBytes !== upload.body.length) {
      if (!existedBeforeUpload) await this.abandonRejectedUpload(reservation.id, stored.key);
      throw new BidSigningArtifactStateError('Stored signed artifact integrity mismatch');
    }
    try {
      const result = await this.repository.recordArtifact({
        reservationId: reservation.id,
        taskId,
        packageFileId,
        claimantSub,
        leaseSecretSha256: hashSigningSecret(leaseSecret),
        now: new Date(),
        artifact: {
          bucket: stored.bucket,
          objectKey: stored.key,
          filename,
          mime: stored.mime,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          certificateThumbprint: metadata.certificateThumbprint,
          certificateSubject: metadata.certificateSubject,
          signedAt: metadata.signedAt,
        },
      });
      if (result.kind === 'artifact_recorded') return result.artifact;
      if (!existedBeforeUpload) await this.abandonRejectedUpload(reservation.id, stored.key);
      throw new BidSigningArtifactStateError(
        result.kind === 'invalid_state' ? result.reason : result.kind,
      );
    } catch (error) {
      if (!(error instanceof BidSigningArtifactStateError)) {
        if (!existedBeforeUpload) await this.abandonRejectedUpload(reservation.id, stored.key);
      }
      throw error;
    }
  }

  private async abandonRejectedUpload(reservationId: string, key: string): Promise<void> {
    let cleanupError: string | undefined;
    try {
      await this.storage.delete(key);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to delete rejected signing object ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    await this.repository.abandonUpload(
      reservationId,
      new Date(),
      cleanupError,
    );
  }
}
