import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { actorFrom, type BidRequest } from './bid.controller';

const MAX_CONCURRENT_UPLOADS_PER_SIGNER_TASK = 2;

export function canonicalSigningUploadKey(taskId: string, signerSub: string): string {
  return `${taskId.toLowerCase()}:${signerSub}`;
}

type UploadRequest = BidRequest & {
  params?: { taskId?: string };
  signingUploadSlotKey?: string;
};

@Injectable()
export class SigningUploadLimiter {
  private readonly active = new Map<string, number>();

  acquire(key: string): boolean {
    const count = this.active.get(key) ?? 0;
    if (count >= MAX_CONCURRENT_UPLOADS_PER_SIGNER_TASK) return false;
    this.active.set(key, count + 1);
    return true;
  }

  release(key: string): void {
    const count = this.active.get(key) ?? 0;
    if (count <= 1) this.active.delete(key);
    else this.active.set(key, count - 1);
  }
}

@Injectable()
export class SigningUploadConcurrencyGuard implements CanActivate {
  constructor(
    @Inject(SigningUploadLimiter) private readonly limiter: SigningUploadLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const taskId = request.params?.taskId;
    if (!taskId) {
      throw new HttpException(
        'Signing upload slot unavailable',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const key = canonicalSigningUploadKey(taskId, actorFrom(request).sub);
    if (!this.limiter.acquire(key)) {
      throw new HttpException(
        'Too many concurrent signing uploads',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    request.signingUploadSlotKey = key;
    return true;
  }
}

@Injectable()
export class SigningUploadReleaseInterceptor implements NestInterceptor {
  constructor(
    @Inject(SigningUploadLimiter) private readonly limiter: SigningUploadLimiter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    return next.handle().pipe(
      finalize(() => {
        if (request.signingUploadSlotKey) {
          this.limiter.release(request.signingUploadSlotKey);
          request.signingUploadSlotKey = undefined;
        }
      }),
    );
  }
}
