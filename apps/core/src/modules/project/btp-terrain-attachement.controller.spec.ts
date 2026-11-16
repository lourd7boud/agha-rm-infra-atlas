import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BtpTerrainController } from './btp-terrain.controller';
import type { BtpTerrainRepository } from './btp-terrain.repository';
import type { BtpExecutionRepository } from './btp.repository';

const fields = {
  ligneId: 'line-1', designation: 'Canal', unite: 'ML', quantite: 10,
};
const createAttachement = vi.fn();
const controller = new BtpTerrainController(
  { createAttachement } as unknown as BtpTerrainRepository,
  { getBordereau: async () => ({ lignes: [{ id: 'line-1', numero: 1, designation: 'Canal', unite: 'ML' }] }) } as unknown as BtpExecutionRepository,
);

describe('terrain attachment execution date', () => {
  beforeEach(() => createAttachement.mockClear());

  it('records the exact declared execution day', async () => {
    await controller.createAttachement('project', { ...fields, date: '2026-11-14', isExecutionDate: true }, {});
    expect(createAttachement).toHaveBeenCalledWith(expect.objectContaining({
      date: new Date('2026-11-14T00:00:00Z'), isExecutionDate: true,
    }));
  });

  it('keeps a legacy ISO timestamp unconfirmed', async () => {
    await controller.createAttachement('project', { ...fields, date: '2026-11-14T22:00:00.000Z' }, {});
    expect(createAttachement).toHaveBeenCalledWith(expect.objectContaining({
      date: new Date('2026-11-14T22:00:00Z'), isExecutionDate: false,
    }));
  });

  it.each([null, 0, '2026-02-30', '2026-11-14T22:00:00.000Z'])('rejects an invalid execution day (%s)', async (date) => {
    await expect(controller.createAttachement('project', { ...fields, date, isExecutionDate: true }, {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(createAttachement).not.toHaveBeenCalled();
  });
});
