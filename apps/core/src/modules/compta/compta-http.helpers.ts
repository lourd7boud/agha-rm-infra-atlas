// Helpers HTTP du module compta — extraits dans une feuille pour éviter tout
// cycle contrôleur ↔ module (leçon du module BTP : TDZ au boot).
import { HttpException } from '@nestjs/common';
import { ComptaError } from './compta.repository';
import { ComptaValidationError } from './compta-livres.domain';

/** Rôles autorisés à LIRE ET ÉCRIRE la comptabilité — données sensibles :
 *  direction, finance, admin-si et le rôle dédié `comptable` (cabinets
 *  externes). Appliqué au niveau classe des contrôleurs. */
export const COMPTA_ROLES = ['direction', 'finance', 'admin-si', 'comptable'] as const;

export interface AuthedRequest {
  user?: { sub?: string; username?: string; roles?: string[] };
}

export function actorFrom(request: AuthedRequest): string | null {
  return request.user?.username ?? request.user?.sub ?? null;
}

/** Convertit les erreurs domaine/repository en réponses HTTP typées. */
export function toComptaHttp(error: unknown): never {
  if (error instanceof ComptaError) {
    throw new HttpException(error.message, error.status);
  }
  if (error instanceof ComptaValidationError) {
    throw new HttpException(error.message, 400);
  }
  throw error;
}
