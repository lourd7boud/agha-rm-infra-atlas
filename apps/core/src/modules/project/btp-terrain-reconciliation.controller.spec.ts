import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BtpTerrainReconciliationController } from './btp-terrain-reconciliation.controller';
import {
  TerrainReconciliationConflict,
  TerrainReconciliationError,
  terrainExpenseReconciliationSchema,
} from './btp-terrain-reconciliation.repository';
import { ROLES_KEY } from '../auth/auth.module';

describe('terrain expense reconciliation boundary', () => {
  it.each([
    { expectedVersion: 0, treatment: 'linked_resource', note: 'Livraison' },
    {
      expectedVersion: 0,
      treatment: 'standalone',
      resourceKind: 'materiel',
      resourceId: '20000000-0000-4000-8000-000000000001',
      note: 'Transport',
    },
    { expectedVersion: 0, treatment: 'non_cost', note: '  ' },
  ])('rejects inconsistent classification %j', (input) => {
    expect(terrainExpenseReconciliationSchema.safeParse(input).success).toBe(false);
  });

  it('maps project/resource validation failures to actionable HTTP400', async () => {
    const controller = new BtpTerrainReconciliationController({
      list: vi.fn(),
      reconcile: async () => {
        throw new TerrainReconciliationError('Coût inconnu');
      },
    });
    await expect(
      controller.reconcile(
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        { expectedVersion: 0, treatment: 'standalone', note: 'Transport' },
        { user: { sub: 'office', name: 'Bureau' } } as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('limits financial classification to office roles', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, BtpTerrainReconciliationController.prototype.reconcile),
    ).toEqual(['travaux', 'direction', 'marches', 'admin-si']);
  });

  it('returns HTTP409 when another office user changed the decision', async () => {
    const controller = new BtpTerrainReconciliationController({
      list: vi.fn(),
      reconcile: async () => {
        throw new TerrainReconciliationConflict('Décision modifiée');
      },
    });
    await expect(
      controller.reconcile(
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        { expectedVersion: 0, treatment: 'standalone', note: 'Transport' },
        { user: { sub: 'office', username: 'Bureau' } } as never,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
