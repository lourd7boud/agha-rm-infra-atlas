import { beforeEach, describe, expect, test } from 'vitest';
import { InMemorySupplyRepository } from './supply.repository';
import type { CreatePurchaseOrder } from './supply.repository';

const ORDERED_AT = new Date('2026-06-21T00:00:00Z');

function orderInput(partial: Partial<CreatePurchaseOrder> = {}): CreatePurchaseOrder {
  return {
    supplierId: partial.supplierId ?? 'supplier-1',
    reference: partial.reference ?? 'BC-2026-001',
    objet: partial.objet ?? 'Fournitures chantier',
    amountMad: partial.amountMad ?? 50_000,
    orderedAt: partial.orderedAt ?? ORDERED_AT,
    ...partial,
  };
}

describe('InMemorySupplyRepository — suppliers', () => {
  let repo: InMemorySupplyRepository;
  beforeEach(() => {
    repo = new InMemorySupplyRepository();
  });

  test('createSupplier inserts a new supplier as actif', async () => {
    // Arrange + Act
    const supplier = await repo.createSupplier({ name: 'SOMACEM' });

    // Assert
    expect(supplier.id).toBeTruthy();
    expect(supplier.name).toBe('SOMACEM');
    expect(supplier.status).toBe('actif');
  });

  test('findSupplierById returns null for an unknown id', async () => {
    // Arrange + Act
    const found = await repo.findSupplierById('missing');

    // Assert
    expect(found).toBeNull();
  });
});

describe('InMemorySupplyRepository — orders', () => {
  let repo: InMemorySupplyRepository;
  beforeEach(() => {
    repo = new InMemorySupplyRepository();
  });

  test('createOrder with lines sets amount to the sum of line totals', async () => {
    // Arrange
    const input = orderInput({
      amountMad: 1, // ignored when lines are present
      lines: [
        { designation: 'Ciment CPJ45', quantity: 100, unit: 'sac', unitPriceMad: 75 },
        { designation: 'Acier HA', quantity: 2, unitPriceMad: 9000 },
      ],
    });

    // Act
    const order = await repo.createOrder(input);

    // Assert
    expect(order.status).toBe('brouillon');
    expect(order.amountMad).toBe(25_500);
    expect(order.lines).toHaveLength(2);
    expect(order.lineCount).toBe(2);
    expect(order.lines[0]?.lineTotalMad).toBe(7500);
    expect(order.lines[0]?.orderIndex).toBe(0);
    expect(order.lines[1]?.lineTotalMad).toBe(18_000);
  });

  test('createOrder without lines keeps the input amount and stores no lines', async () => {
    // Arrange
    const input = orderInput({ amountMad: 42_000 });

    // Act
    const order = await repo.createOrder(input);

    // Assert
    expect(order.amountMad).toBe(42_000);
    expect(order.lines).toEqual([]);
    expect(order.lineCount).toBe(0);
  });

  test('listOrders reports each order line count without loading line bodies', async () => {
    // Arrange — one detailed order, one legacy line-less order
    await repo.createOrder(
      orderInput({
        reference: 'BC-2026-010',
        lines: [
          { designation: 'Ciment CPJ45', quantity: 100, unit: 'sac', unitPriceMad: 75 },
          { designation: 'Acier HA', quantity: 2, unitPriceMad: 9000 },
        ],
      }),
    );
    await repo.createOrder(orderInput({ reference: 'BC-2026-011' }));

    // Act
    const orders = await repo.listOrders();

    // Assert
    const detailed = orders.find((o) => o.reference === 'BC-2026-010');
    const legacy = orders.find((o) => o.reference === 'BC-2026-011');
    expect(detailed?.lineCount).toBe(2);
    expect(legacy?.lineCount).toBe(0);
  });

  test('getOrder returns the order with its lines', async () => {
    // Arrange
    const created = await repo.createOrder(
      orderInput({
        lines: [
          { designation: 'Gravier', quantity: 5, unit: 't', unitPriceMad: 200 },
        ],
      }),
    );

    // Act
    const found = await repo.getOrder(created.id);

    // Assert
    expect(found?.id).toBe(created.id);
    expect(found?.lines).toHaveLength(1);
    expect(found?.lineCount).toBe(1);
    expect(found?.lines[0]?.designation).toBe('Gravier');
    expect(found?.lines[0]?.lineTotalMad).toBe(1000);
  });

  test('getOrder returns null for an unknown id', async () => {
    // Arrange + Act
    const found = await repo.getOrder('missing');

    // Assert
    expect(found).toBeNull();
  });

  test('listOrderLines returns the lines of an order (empty for legacy orders)', async () => {
    // Arrange
    const withLines = await repo.createOrder(
      orderInput({
        reference: 'BC-2026-002',
        lines: [{ designation: 'Sable', quantity: 3, unitPriceMad: 150 }],
      }),
    );
    const legacy = await repo.createOrder(orderInput({ reference: 'BC-2026-003' }));

    // Act
    const lines = await repo.listOrderLines(withLines.id);
    const none = await repo.listOrderLines(legacy.id);

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineTotalMad).toBe(450);
    expect(none).toEqual([]);
  });

  test('setOrderStatus transitions a stored order, null for unknown id', async () => {
    // Arrange
    const created = await repo.createOrder(orderInput());

    // Act
    const updated = await repo.setOrderStatus(created.id, 'envoye');
    const missing = await repo.setOrderStatus('missing', 'envoye');

    // Assert
    expect(updated?.status).toBe('envoye');
    expect(missing).toBeNull();
  });
});

describe('InMemorySupplyRepository — invoices', () => {
  let repo: InMemorySupplyRepository;
  beforeEach(() => {
    repo = new InMemorySupplyRepository();
  });

  test('createInvoice stores a recue invoice', async () => {
    // Arrange + Act
    const invoice = await repo.createInvoice({
      supplierId: 'supplier-1',
      reference: 'F-2026-001',
      amountMad: 12_000,
      invoiceDate: ORDERED_AT,
      dueDate: ORDERED_AT,
    });

    // Assert
    expect(invoice.status).toBe('recue');
    expect(invoice.amountMad).toBe(12_000);
  });

  test('setInvoiceStatus to payee stamps paidAt', async () => {
    // Arrange
    const created = await repo.createInvoice({
      supplierId: 'supplier-1',
      reference: 'F-2026-002',
      amountMad: 5000,
      invoiceDate: ORDERED_AT,
      dueDate: ORDERED_AT,
    });
    const paidAt = new Date('2026-07-01T00:00:00Z');

    // Act
    const updated = await repo.setInvoiceStatus(created.id, 'payee', paidAt);

    // Assert
    expect(updated?.status).toBe('payee');
    expect(updated?.paidAt).toEqual(paidAt);
  });
});
