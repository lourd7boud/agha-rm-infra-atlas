import { ConflictException, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import { BtpTransitionError } from './btp-registres.domain';

/** Translate source-protection conflicts without leaking SQL or replacing unexpected failures. */
@Injectable()
export class BtpTerrainErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(catchError((error: unknown) => {
      const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
      const databaseError = cause ?? error;
      if (error instanceof BtpTransitionError) return throwError(() => new ConflictException(error.message));
      if (databaseError && typeof databaseError === 'object' && 'code' in databaseError && databaseError.code === '55000') {
        return throwError(() => new ConflictException('Cette ressource a été validée. Demandez une correction de la journée source.'));
      }
      return throwError(() => error);
    }));
  }
}
