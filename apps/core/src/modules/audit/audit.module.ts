import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  Module,
  NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getDb, type Db } from '../../db/client';
import { auditLog } from '../../db/schema';
import type { AuthenticatedUser } from '../auth/auth.domain';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AuditedRequest {
  method: string;
  originalUrl?: string;
  url: string;
  body?: unknown;
  user?: AuthenticatedUser;
}

/**
 * Append-only audit trail (security-compliance §3): every mutating request
 * is recorded with its actor and outcome. Writes never block the response;
 * failures are logged, not swallowed.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');
  private readonly db: Db | null;

  constructor() {
    const url = process.env.DATABASE_URL;
    this.db = url ? getDb(url) : null;
    if (!this.db) {
      this.logger.warn('DATABASE_URL not set — audit entries go to logs only');
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => this.record(request, 'success'),
        error: (error: Error) => this.record(request, `error:${error.name}`),
      }),
    );
  }

  private record(request: AuditedRequest, outcome: string): void {
    const entry = {
      actor: request.user?.username ?? 'anonymous',
      method: request.method,
      path: request.originalUrl ?? request.url,
      outcome,
      payload: request.body ?? null,
    };
    if (!this.db) {
      this.logger.log(JSON.stringify(entry));
      return;
    }
    Promise.resolve(this.db.insert(auditLog).values(entry)).catch(
      (error: Error) =>
        this.logger.error(`Audit write failed: ${error.message}`),
    );
  }
}

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AuditModule {}
