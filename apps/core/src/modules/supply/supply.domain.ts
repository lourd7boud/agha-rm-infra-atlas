/**
 * Procurement division v1 (native Odoo replacement, slice 1) — pure
 * payables arithmetic: validated unpaid supplier invoices, mirrored on
 * the receivables side so the treasury sees cash-in AND cash-out with
 * the same aging vocabulary.
 */

const MS_PER_DAY = 86_400_000;

export type SupplierInvoiceStatus = 'recue' | 'validee' | 'payee';

/** A priced bon-de-commande line — the unit shared by createOrder's lines. */
export interface OrderLineTotal {
  quantity: number;
  unitPriceMad: number;
}

/** Round to 2 decimals (centimes), guarding against binary-float drift. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Line total = quantity × unit price, rounded to 2 decimals. Shared by the
 * InMemory and Drizzle order-create paths so both persist identical figures
 * (mirrors sales.domain.lineTotal — kept local to keep the supply module
 * self-contained).
 */
export function lineTotal(line: OrderLineTotal): number {
  return round2(line.quantity * line.unitPriceMad);
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface PayableInput {
  supplierName: string;
  reference: string;
  amountMad: number;
  dueDate: Date;
  status: SupplierInvoiceStatus | string;
}

export interface PayableItem extends PayableInput {
  daysOverdue: number;
  bucket: AgingBucket;
}

export interface SupplierDebt {
  supplierName: string;
  totalMad: number;
  factures: number;
}

export interface Payables {
  items: PayableItem[];
  totalMad: number;
  aging: Record<AgingBucket, number>;
  parFournisseur: SupplierDebt[];
}

function bucketFor(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function buildPayables(
  invoices: PayableInput[],
  today: Date,
): Payables {
  const items = invoices
    .filter((invoice) => invoice.status === 'validee')
    .map((invoice) => {
      const daysOverdue = Math.max(
        0,
        Math.floor((today.getTime() - invoice.dueDate.getTime()) / MS_PER_DAY),
      );
      return { ...invoice, daysOverdue, bucket: bucketFor(daysOverdue) };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const aging: Record<AgingBucket, number> = {
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  const bySupplier = new Map<string, SupplierDebt>();
  for (const item of items) {
    aging[item.bucket] += item.amountMad;
    const current = bySupplier.get(item.supplierName) ?? {
      supplierName: item.supplierName,
      totalMad: 0,
      factures: 0,
    };
    bySupplier.set(item.supplierName, {
      supplierName: item.supplierName,
      totalMad: current.totalMad + item.amountMad,
      factures: current.factures + 1,
    });
  }

  return {
    items,
    totalMad: items.reduce((sum, item) => sum + item.amountMad, 0),
    aging,
    parFournisseur: [...bySupplier.values()].sort(
      (a, b) => b.totalMad - a.totalMad,
    ),
  };
}
