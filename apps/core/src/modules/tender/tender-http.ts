import type { AuthenticatedUser } from '../auth/auth.domain';

/** Express request after the OIDC guard attaches the authenticated principal.
 *  Shared by the tender controllers that scope data to the caller (req.user). */
export interface RequestWithUser {
  user?: AuthenticatedUser;
}
