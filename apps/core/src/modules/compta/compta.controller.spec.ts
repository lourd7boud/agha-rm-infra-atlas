import { describe, expect, test, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.module';
import { ComptaCoreController } from './compta.module';
import type { ComptaRepository } from './compta.repository';
import type { ComptaRegistresRepository } from './compta-registres.repository';
import type { ComptaAutoPostingService } from './compta-auto-posting.service';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = { user: { username: 'comptable-1' } };

function makeController() {
  const compta = {
    validateSelectedEntries: vi.fn(async () => [{ id: ENTRY_ID }]),
    updateFaitGenerateurTva: vi.fn(async (value) => ({
      faitGenerateurTva: value,
    })),
  } as unknown as ComptaRepository;
  const autoPosting = {
    listSalesReconciliation: vi.fn(async () => []),
    reconcileSalesEvents: vi.fn(async () => ({
      projected: 0,
      blocked: 0,
      pending: 0,
      records: [],
    })),
  } as unknown as ComptaAutoPostingService;
  const controller = new ComptaCoreController(
    compta,
    {} as ComptaRegistresRepository,
    autoPosting,
  );
  return { controller, compta, autoPosting };
}

describe('ComptaCoreController financial approval guards', () => {
  test.each([
    'patchTvaProfile',
    'validerEcriture',
    'validateSelection',
  ] as const)('%s allows only direction and comptable', (method) => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ComptaCoreController.prototype[method],
    );
    expect(roles).toEqual(['direction', 'comptable']);
    expect(roles).not.toContain('admin-si');
  });

  test('validates an explicit selection atomically with the audit actor', async () => {
    const { controller, compta } = makeController();
    const result = await controller.validateSelection(
      { ids: [ENTRY_ID] },
      REQUEST,
    );
    expect(compta.validateSelectedEntries).toHaveBeenCalledWith(
      [ENTRY_ID],
      'comptable-1',
    );
    expect(result).toEqual([{ id: ENTRY_ID }]);
  });

  test('updates only the TVA taxable event through the guarded endpoint', async () => {
    const { controller, compta } = makeController();
    await controller.patchTvaProfile(
      { faitGenerateurTva: 'encaissement' },
      REQUEST,
    );
    expect(compta.updateFaitGenerateurTva).toHaveBeenCalledWith(
      'encaissement',
      'comptable-1',
    );
  });

  test('lists and retries durable sales reconciliation events', async () => {
    const { controller, autoPosting } = makeController();
    await controller.salesReconciliation('2026');
    await controller.retrySalesReconciliation(
      { ids: [ENTRY_ID] },
      REQUEST,
    );
    expect(autoPosting.listSalesReconciliation).toHaveBeenCalledWith({
      year: 2026,
    });
    expect(autoPosting.reconcileSalesEvents).toHaveBeenCalledWith({
      ids: [ENTRY_ID],
      year: undefined,
      actor: 'comptable-1',
    });
  });
});
