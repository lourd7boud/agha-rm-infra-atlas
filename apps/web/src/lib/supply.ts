import { fmtMad } from './projects';

/**
 * Approvisionnements / Achats division — frontend mirror of the @atlas/core
 * supply module contract (apps/core/src/modules/supply). Money/quantities arrive
 * as numbers (the repository surfaces the Postgres numeric strings as numbers);
 * dates arrive as ISO strings. MAD formatting reuses fmtMad. Status unions mirror
 * the controller's transition map so the page filters and persisted values share
 * one vocabulary.
 */

// ── Suppliers / fournisseurs ──────────────────────────────────────────────────

export type SupplierStatus = 'actif' | 'inactif';

export interface SupplierRecord {
  id: string;
  name: string;
  ice?: string;
  phone?: string;
  email?: string;
  status: SupplierStatus;
  createdAt: string;
}

export const SUPPLIER_STATUS_BADGES: Record<
  SupplierStatus,
  { label: string; classes: string }
> = {
  actif: { label: 'Actif', classes: 'bg-emerald-soft text-emerald' },
  inactif: { label: 'Inactif', classes: 'bg-sand text-faint' },
};

// ── Order line (bon de commande) ──────────────────────────────────────────────

export interface OrderLineRecord {
  id: string;
  designation: string;
  quantity: number;
  unit?: string;
  unitPriceMad: number;
  lineTotalMad: number;
  orderIndex: number;
}

// ── Purchase orders / bons de commande ────────────────────────────────────────

export type PurchaseOrderStatus = 'brouillon' | 'envoye' | 'recu' | 'annule';

export interface PurchaseOrderRecord {
  id: string;
  supplierId: string;
  projectId?: string;
  reference: string;
  objet: string;
  amountMad: number;
  status: PurchaseOrderStatus;
  orderedAt: string;
  createdAt: string;
  /**
   * Number of line items. The list endpoint (GET /supply/orders) populates this
   * from a COUNT aggregate while sending an empty `lines`; the detail endpoint
   * (GET /supply/orders/:id) sends the full `lines` with a matching count.
   */
  lineCount: number;
  lines: OrderLineRecord[];
}

export const ORDER_STATUS_BADGES: Record<
  PurchaseOrderStatus,
  { label: string; classes: string }
> = {
  brouillon: { label: 'Brouillon', classes: 'bg-sand text-muted' },
  envoye: { label: 'Envoyé', classes: 'bg-cyan-soft text-cyan' },
  recu: { label: 'Reçu', classes: 'bg-emerald-soft text-emerald' },
  annule: { label: 'Annulé', classes: 'bg-clay-soft text-clay' },
};

/**
 * Allowed next states per order status — mirrors ORDER_TRANSITIONS in the
 * SupplyController so the detail page only offers legal transitions.
 */
export const ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly { value: PurchaseOrderStatus; label: string }[]
> = {
  brouillon: [
    { value: 'envoye', label: 'Envoyer' },
    { value: 'annule', label: 'Annuler' },
  ],
  envoye: [
    { value: 'recu', label: 'Marquer reçu' },
    { value: 'annule', label: 'Annuler' },
  ],
  recu: [],
  annule: [],
};

// ── Supplier invoices / factures fournisseurs ─────────────────────────────────

export type SupplierInvoiceStatus = 'recue' | 'validee' | 'payee';

export interface SupplierInvoiceRecord {
  id: string;
  supplierId: string;
  purchaseOrderId?: string;
  reference: string;
  amountMad: number;
  invoiceDate: string;
  dueDate: string;
  status: SupplierInvoiceStatus;
  paidAt?: string;
  createdAt: string;
}

export const SUPPLIER_INVOICE_STATUS_BADGES: Record<
  SupplierInvoiceStatus,
  { label: string; classes: string }
> = {
  recue: { label: 'Reçue', classes: 'bg-sand text-muted' },
  validee: { label: 'Validée', classes: 'bg-cyan-soft text-cyan' },
  payee: { label: 'Payée', classes: 'bg-emerald-soft text-emerald' },
};

// ── Payables / dettes fournisseurs (GET /supply/payables) ─────────────────────

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface PayableItem {
  supplierName: string;
  reference: string;
  amountMad: number;
  dueDate: string;
  status: SupplierInvoiceStatus | string;
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

export const BUCKET_TONES: Record<AgingBucket, string> = {
  '0-30': 'bg-emerald-soft text-emerald',
  '31-60': 'bg-ochre-soft text-ochre',
  '61-90': 'bg-ochre-soft text-ochre-deep',
  '90+': 'bg-clay-soft text-clay',
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Re-export so supply pages import one money formatter. */
export { fmtMad };

/** A quantity, trimmed of trailing zeros and suffixed with its unit. */
export function fmtQtyUnit(quantity: number, unit?: string): string {
  const qty = quantity.toLocaleString('fr-MA', { maximumFractionDigits: 3 });
  return unit ? `${qty} ${unit}` : qty;
}

/** Formats an ISO date string as a Moroccan short date, dash when absent. */
export function fmtDate(value: string | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-MA');
}
