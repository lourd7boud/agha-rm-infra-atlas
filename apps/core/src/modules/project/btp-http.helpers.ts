// Shared HTTP helpers of the BTP controllers — kept in their own module so
// btp.module.ts and btp-registres.controller.ts don't import each other
// (a controller↔module cycle hits the decorator TDZ at boot under tsx).
import { ConflictException } from '@nestjs/common';
import { BtpTransitionError } from './btp-registres.domain';

export interface AuthedRequest {
  user?: { sub: string; username: string; roles: string[] };
}

export function actorFrom(req: AuthedRequest): { sub: string; name: string } {
  return { sub: req.user?.sub ?? 'unknown', name: req.user?.username ?? 'unknown' };
}

export function toHttp(error: unknown): never {
  if (error instanceof BtpTransitionError) throw new ConflictException(error.message);
  throw error;
}

export const WRITE_ROLES = ['travaux', 'direction', 'marches', 'admin-si'] as const;
