import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SalesController } from './sales.module';
import { InMemorySalesRepository } from './sales.repository';
import type { ComptaAutoPostingService } from '../compta/compta-auto-posting.service';

// Directly instantiate the controller (no Nest container) with the in-memory
// repository and a mocked auto-posting bridge — this pins the Phase-3 TRIGGER
// contract: confirming an invoice fires onInvoiceConfirmed with the right actor,
// while cancel / draft / unknown never post an écriture.

const REQ = { user: { username: 'compta-user' } };

function makeController() {
  const repo = new InMemorySalesRepository();
  const onInvoiceConfirmed = vi
    .fn()
    .mockResolvedValue({ created: true, reason: 'posted' });
  const onInvoicePaid = vi
    .fn()
    .mockResolvedValue({ created: true, reason: 'posted' });
  const autoPosting = {
    onInvoiceConfirmed,
    onInvoicePaid,
  } as unknown as ComptaAutoPostingService;
  const controller = new SalesController(repo, autoPosting);
  return { repo, controller, onInvoiceConfirmed, onInvoicePaid };
}

function seedInvoice(repo: InMemorySalesRepository) {
  return repo.createInvoice({
    clientId: 'client-1',
    invoiceDate: new Date('2026-06-01T00:00:00Z'),
    tvaPct: 20,
    lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1000 }],
  });
}

describe('SalesController.setInvoiceStatus — auto-posting trigger', () => {
  let ctx: ReturnType<typeof makeController>;
  beforeEach(() => {
    ctx = makeController();
  });

  test('confirming (→envoyee) fires only the sale post, with the actor', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);

    // Act
    const updated = await ctx.controller.setInvoiceStatus(
      inv.id,
      { status: 'envoyee' },
      REQ,
    );

    // Assert — sale écriture only; no encaissement until paid.
    expect(updated?.status).toBe('envoyee');
    expect(ctx.onInvoiceConfirmed).toHaveBeenCalledTimes(1);
    expect(ctx.onInvoiceConfirmed).toHaveBeenCalledWith(inv.id, 'compta-user');
    expect(ctx.onInvoicePaid).not.toHaveBeenCalled();
  });

  test('→payee posts BOTH the sale entry and the encaissement', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);

    // Act
    await ctx.controller.setInvoiceStatus(
      inv.id,
      { status: 'payee', method: 'cheque' },
      REQ,
    );

    // Assert — sale + encaissement (with the chosen payment method).
    expect(ctx.onInvoiceConfirmed).toHaveBeenCalledWith(inv.id, 'compta-user');
    expect(ctx.onInvoicePaid).toHaveBeenCalledWith(inv.id, 'compta-user', 'cheque');
  });

  test('→payee without a method passes undefined (server defaults to bank)', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);

    // Act
    await ctx.controller.setInvoiceStatus(inv.id, { status: 'payee' }, REQ);

    // Assert
    expect(ctx.onInvoicePaid).toHaveBeenCalledWith(inv.id, 'compta-user', undefined);
  });

  test('→payee does NOT post the encaissement when the sale écriture was not created', async () => {
    // Arrange — the sale post fails (e.g. closed exercice): posting the cash leg
    // anyway would credit 3421 with no matching debit.
    const inv = await seedInvoice(ctx.repo);
    ctx.onInvoiceConfirmed.mockResolvedValueOnce({
      created: false,
      reason: 'exercice_cloture',
    });

    // Act
    await ctx.controller.setInvoiceStatus(inv.id, { status: 'payee' }, REQ);

    // Assert — sale attempted, encaissement gated off.
    expect(ctx.onInvoiceConfirmed).toHaveBeenCalledTimes(1);
    expect(ctx.onInvoicePaid).not.toHaveBeenCalled();
  });

  test('re-marking an already-paid invoice does not drift paidAt', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);
    const first = await ctx.controller.setInvoiceStatus(inv.id, { status: 'payee' }, REQ);

    // Act — mark payée a second time
    const second = await ctx.controller.setInvoiceStatus(inv.id, { status: 'payee' }, REQ);

    // Assert — the audit date is stable across re-marks.
    expect(first?.paidAt).toBeTruthy();
    expect(second?.paidAt).toEqual(first?.paidAt);
  });

  test('→annulee never posts any écriture', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);

    // Act
    await ctx.controller.setInvoiceStatus(inv.id, { status: 'annulee' }, REQ);

    // Assert
    expect(ctx.onInvoiceConfirmed).not.toHaveBeenCalled();
    expect(ctx.onInvoicePaid).not.toHaveBeenCalled();
  });

  test('actor falls back to the token sub when username is absent', async () => {
    // Arrange
    const inv = await seedInvoice(ctx.repo);

    // Act
    await ctx.controller.setInvoiceStatus(
      inv.id,
      { status: 'envoyee' },
      { user: { sub: 'kc-123' } },
    );

    // Assert
    expect(ctx.onInvoiceConfirmed).toHaveBeenCalledWith(inv.id, 'kc-123');
  });

  test('an unknown invoice throws and never posts', async () => {
    // Act / Assert
    await expect(
      ctx.controller.setInvoiceStatus('missing', { status: 'envoyee' }, REQ),
    ).rejects.toThrow();
    expect(ctx.onInvoiceConfirmed).not.toHaveBeenCalled();
  });
});
