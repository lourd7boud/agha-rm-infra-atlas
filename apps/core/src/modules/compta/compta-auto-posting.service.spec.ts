import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ComptaAutoPostingService } from './compta-auto-posting.service';
import type { ComptaRepository } from './compta.repository';
import type { VentePostingResult } from './compta-ventes.domain';

// The service must be NON-THROWING but NEVER SILENT: it returns the structured
// posting outcome and logs — WARN for "should have posted but couldn't" reasons
// (closed exercice, incoherent totals, unexpected error), quiet for benign no-ops.

function makeService(impl: () => Promise<VentePostingResult>) {
  const genererEcritureVente = vi.fn(impl);
  const genererEcritureEncaissement = vi.fn(impl);
  const repo = {
    genererEcritureVente,
    genererEcritureEncaissement,
  } as unknown as ComptaRepository;
  return {
    service: new ComptaAutoPostingService(repo),
    genererEcritureVente,
    genererEcritureEncaissement,
  };
}

describe('ComptaAutoPostingService.onInvoiceConfirmed', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  test('returns the result and logs on a successful post', async () => {
    const { service, genererEcritureVente } = makeService(async () => ({
      created: true,
      validated: true,
      reason: 'posted',
    }));

    const result = await service.onInvoiceConfirmed('inv-1', 'compta-user');

    expect(genererEcritureVente).toHaveBeenCalledWith('inv-1', 'compta-user');
    expect(result).toEqual({ created: true, validated: true, reason: 'posted' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('WARNs (never silent) when a closed exercice blocks posting', async () => {
    const { service } = makeService(async () => ({
      created: false,
      reason: 'exercice_cloture',
    }));

    const result = await service.onInvoiceConfirmed('inv-2', 'u');

    expect(result.reason).toBe('exercice_cloture');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('WARNs when totals are incoherent (e.g. a zero-total invoice)', async () => {
    const { service } = makeService(async () => ({ created: false, reason: 'incoherent' }));

    await service.onInvoiceConfirmed('inv-3', 'u');

    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a benign already-posted no-op neither warns nor logs', async () => {
    const { service } = makeService(async () => ({ created: false, reason: 'already_posted' }));

    const result = await service.onInvoiceConfirmed('inv-4', 'u');

    expect(result.reason).toBe('already_posted');
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  test('an unexpected repo error is caught, logged ERROR, and surfaced as reason=error', async () => {
    const { service } = makeService(async () => {
      throw new Error('numéro collision');
    });

    const result = await service.onInvoiceConfirmed('inv-5', 'u');

    expect(result).toEqual({ created: false, reason: 'error' });
    expect(error).toHaveBeenCalledTimes(1);
  });

  test('onInvoicePaid routes to the encaissement poster with the chosen method', async () => {
    const { service, genererEcritureEncaissement } = makeService(async () => ({
      created: true,
      validated: true,
      reason: 'posted',
    }));

    const result = await service.onInvoicePaid('inv-6', 'u', 'espece');

    expect(genererEcritureEncaissement).toHaveBeenCalledWith('inv-6', 'u', {
      method: 'espece',
    });
    expect(result.reason).toBe('posted');
    expect(log).toHaveBeenCalledTimes(1);
  });

  test('onInvoicePaid WARNs (never silent) when the encaissement cannot post', async () => {
    const { service } = makeService(async () => ({ created: false, reason: 'incoherent' }));

    await service.onInvoicePaid('inv-7', 'u');

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
