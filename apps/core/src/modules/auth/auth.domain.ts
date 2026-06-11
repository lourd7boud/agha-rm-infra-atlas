/** Pure auth helpers — unit-tested independently of NestJS and jose. */

export interface AuthenticatedUser {
  sub: string;
  username: string;
  roles: readonly string[];
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/** Keycloak puts realm roles at realm_access.roles — defensively extracted. */
export function rolesFromPayload(payload: Record<string, unknown>): readonly string[] {
  const realmAccess = payload['realm_access'];
  if (typeof realmAccess !== 'object' || realmAccess === null) return [];
  const roles = (realmAccess as Record<string, unknown>)['roles'];
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === 'string');
}

export function hasAnyRole(
  userRoles: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((role) => userRoles.includes(role));
}
