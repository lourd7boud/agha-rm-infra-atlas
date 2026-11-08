import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ComptaAutoPostingService,
  type AccountingProjectionPort,
  type SalesAccountingEvent,
  type SalesAccountingEventStore,
} from './compta-auto-posting.service';

const EVENT: SalesAccountingEvent = {
  id: 'event-1',
  eventKey: 'invoice_issued:invoice-1:2',
  eventType: 'invoice_issued',
  sourceId: 'invoice-1',
  sourceVersion: 2,
  occurredAt: new Date('2026-06-21T00:00:00Z'),
  status: 'pending',
  attempts: 0,
  payload: {
    reference: 'FAC-2026-000001',
    clientName: 'Client BTP',
    totalHtCents: 100_000,
    tvaCents: 20_000,
    totalTtcCents: 120_000,
  },
};

function makeHarness(event: SalesAccountingEvent = EVENT) {
  let stored = { ...event };
  const events: SalesAccountingEventStore = {
    getEvent: vi.fn(async () => stored),
    listReconciliation: vi.fn(async () => [stored]),
    markProjected: vi.fn(async (_id, entryId) => {
      stored = {
        ...stored,
        status: 'projected',
        accountingEntryId: entryId,
        attempts: stored.attempts + 1,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      };
      return stored;
    }),
    markBlocked: vi.fn(async (_id, code, message) => {
      stored = {
        ...stored,
        status: 'blocked',
        attempts: stored.attempts + 1,
        lastErrorCode: code,
        lastErrorMessage: message,
      };
      return stored;
    }),
    markRetryableFailure: vi.fn(async (_id, code, message) => {
      stored = {
        ...stored,
        status: 'pending',
        attempts: stored.attempts + 1,
        lastErrorCode: code,
        lastErrorMessage: message,
      };
      return stored;
    }),
  };
  const projection: AccountingProjectionPort = {
    getContext: vi.fn(async () => ({
      faitGenerateurTva: 'encaissement' as const,
      exerciseOpen: true,
      accounts: {
        client: '3421',
        revenue: '71242',
        tvaPending: '4455',
        tvaDue: '4456',
      },
    })),
    findEntryByEvent: vi.fn(async () => null),
    createDraftEntry: vi.fn(async () => ({
      id: 'entry-1',
      status: 'brouillon' as const,
    })),
  };
  return {
    service: new ComptaAutoPostingService(events, projection),
    events,
    projection,
  };
}

describe('ComptaAutoPostingService.projectEvent', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  test('creates one balanced draft and marks the event projected', async () => {
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.status).toBe('projected');
    expect(harness.projection.createDraftEntry).toHaveBeenCalledWith(
      EVENT,
      expect.objectContaining({ kind: 'ready' }),
      'comptable-1',
    );
    expect(harness.events.markProjected).toHaveBeenCalledWith(
      'event-1',
      'entry-1',
    );
  });

  test('replay returns the existing entry without duplication', async () => {
    vi.mocked(harness.projection.findEntryByEvent).mockResolvedValue({
      id: 'entry-existing',
      status: 'brouillon',
    });
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.accountingEntryId).toBe('entry-existing');
    expect(harness.projection.createDraftEntry).not.toHaveBeenCalled();
  });

  test.each([
    ['non_configure', true, 'fait_generateur_tva_non_configure'],
    ['encaissement', false, 'exercice_cloture'],
  ] as const)(
    'marks %s context blocked with a stable code',
    async (faitGenerateurTva, exerciseOpen, code) => {
      vi.mocked(harness.projection.getContext).mockResolvedValue({
        faitGenerateurTva,
        exerciseOpen,
        accounts: {
          client: '3421',
          revenue: '71242',
          tvaPending: '4455',
          tvaDue: '4456',
        },
      });
      const result = await harness.service.projectEvent('event-1', 'comptable-1');
      expect(result.status).toBe('blocked');
      expect(result.lastErrorCode).toBe(code);
      expect(harness.projection.createDraftEntry).not.toHaveBeenCalled();
    },
  );

  test('missing account mapping blocks without guessing an account', async () => {
    vi.mocked(harness.projection.getContext).mockResolvedValue({
      faitGenerateurTva: 'debits',
      exerciseOpen: true,
      accounts: {
        client: '3421',
        revenue: null,
        tvaPending: '4455',
        tvaDue: '4456',
      },
    });
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.lastErrorCode).toBe('compte_manquant');
  });

  test('transient persistence failure increments attempts and remains retryable', async () => {
    vi.mocked(harness.projection.createDraftEntry).mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.status).toBe('pending');
    expect(result.attempts).toBe(1);
    expect(result.lastErrorCode).toBe('projection_transitoire');
  });

  test('records invalid event payloads as blocked instead of aborting reconciliation', async () => {
    harness = makeHarness({ ...EVENT, payload: { ...EVENT.payload, totalHtCents: -1 } });
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.status).toBe('blocked');
    expect(result.lastErrorCode).toBe('payload_invalide');
    expect(harness.projection.createDraftEntry).not.toHaveBeenCalled();
  });

  test('successful retry clears the previous blocking message', async () => {
    harness = makeHarness({
      ...EVENT,
      status: 'blocked',
      attempts: 1,
      lastErrorCode: 'exercice_cloture',
      lastErrorMessage: 'Exercice fermé',
    });
    const result = await harness.service.projectEvent('event-1', 'comptable-1');
    expect(result.status).toBe('projected');
    expect(result.lastErrorCode).toBeUndefined();
    expect(result.lastErrorMessage).toBeUndefined();
  });
});
