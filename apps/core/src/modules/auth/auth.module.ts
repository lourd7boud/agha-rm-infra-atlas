import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  extractBearerToken,
  hasAnyRole,
  rolesFromPayload,
  type AuthenticatedUser,
} from './auth.domain';

export const IS_PUBLIC_KEY = 'atlas:isPublic';
/** Marks a route as reachable without authentication (health checks only). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'atlas:roles';
/** Restricts a route to holders of at least one of the given realm roles. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface TokenVerifier {
  verify(token: string): Promise<Record<string, unknown>>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

class KeycloakTokenVerifier implements TokenVerifier {
  private readonly jwks;

  constructor(private readonly issuer: string) {
    this.jwks = createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`),
    );
  }

  async verify(token: string): Promise<Record<string, unknown>> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
    });
    return payload;
  }
}

interface AuthedRequest {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
}

@Injectable()
export class AtlasAuthGuard implements CanActivate {
  // Explicit @Inject required everywhere: tsx/esbuild does not emit decorator
  // metadata, so Nest cannot infer constructor parameter types.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // No verifier configured (OIDC_ISSUER unset): dev-only open mode,
    // loudly warned at boot by the provider factory below.
    if (!this.verifier) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: Record<string, unknown>;
    try {
      payload = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user: AuthenticatedUser = {
      sub: typeof payload['sub'] === 'string' ? payload['sub'] : 'unknown',
      username:
        typeof payload['preferred_username'] === 'string'
          ? payload['preferred_username']
          : 'unknown',
      roles: rolesFromPayload(payload),
    };
    request.user = user;

    const required =
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length > 0 && !hasAnyRole(user.roles, required)) {
      throw new ForbiddenException(
        `Requires one of roles: ${required.join(', ')}`,
      );
    }
    return true;
  }
}

const tokenVerifierProvider = {
  provide: TOKEN_VERIFIER,
  useFactory: (): TokenVerifier | null => {
    const issuer = process.env.OIDC_ISSUER;
    if (issuer) {
      new Logger('AuthModule').log(`OIDC token verification active (${issuer})`);
      return new KeycloakTokenVerifier(issuer);
    }
    // Fail fast: a production process must never boot with auth disabled.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: OIDC_ISSUER must be set when NODE_ENV=production');
    }
    new Logger('AuthModule').warn(
      'OIDC_ISSUER not set — AUTHENTICATION DISABLED (dev mode only, never production)',
    );
    return null;
  },
};

@Module({
  providers: [
    tokenVerifierProvider,
    { provide: APP_GUARD, useClass: AtlasAuthGuard },
  ],
  exports: [tokenVerifierProvider],
})
export class AuthModule {}
