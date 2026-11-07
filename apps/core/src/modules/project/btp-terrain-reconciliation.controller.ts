import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { actorFrom, WRITE_ROLES, type AuthedRequest } from './btp-http.helpers';
import {
  BTP_TERRAIN_RECONCILIATION_REPOSITORY,
  terrainExpenseReconciliationSchema,
  TerrainReconciliationError,
  TerrainReconciliationConflict,
  type BtpTerrainReconciliationRepository,
} from './btp-terrain-reconciliation.repository';

function uuid(value: string): string {
  if (!z.string().uuid().safeParse(value).success) throw new BadRequestException('UUID invalide');
  return value;
}

@Controller('btp/projects/:projectId/terrain/depenses')
export class BtpTerrainReconciliationController {
  constructor(
    @Inject(BTP_TERRAIN_RECONCILIATION_REPOSITORY)
    private readonly repository: BtpTerrainReconciliationRepository,
  ) {}
  @Get('rapprochements')
  list(@Param('projectId') projectId: string) {
    return this.repository.list(uuid(projectId));
  }

  @Patch(':id/rapprocher')
  @Roles(...WRITE_ROLES)
  async reconcile(
    @Param('projectId') projectId: string,
    @Param('id') expenseId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = terrainExpenseReconciliationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.repository.reconcile(
        uuid(projectId),
        uuid(expenseId),
        parsed.data,
        actorFrom(req).name,
      );
    } catch (error) {
      if (error instanceof TerrainReconciliationConflict)
        throw new ConflictException(error.message);
      if (error instanceof TerrainReconciliationError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
