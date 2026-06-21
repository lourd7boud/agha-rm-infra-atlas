import { fmtMad } from './projects';

/**
 * Finance ledger — frontend mirror of the @atlas/core finance ledger contract
 * (apps/core/src/modules/finance/ledger.*). Numerics arrive as numbers (the
 * repository surfaces the Postgres numeric strings as numbers); dates arrive as
 * ISO strings (JS Date serialized over JSON). MAD formatting reuses fmtMad.
 */

/** Encaissement payment method — mirrors paymentInputSchema.method enum. */
export type PaymentMethod =
  | 'virement'
  | 'cheque'
  | 'espece'
  | 'effet'
  | 'autre';

/** Closed expense-category list — mirrors EXPENSE_CATEGORIES in ledger.domain. */
export type ExpenseCategory =
  | 'location_materiel'
  | 'materiaux'
  | 'main_oeuvre'
  | 'carburant'
  | 'transport'
  | 'sous_traitance'
  | 'administratif'
  | 'taxes'
  | 'autre';

/** Recette — money IN (TGR, acompte, avance). */
export interface PaymentRecord {
  id: string;
  projectId?: string;
  label: string;
  payerName?: string;
  amountMad: number;
  method: PaymentMethod;
  transferReference?: string;
  bankName?: string;
  paidAt: string;
  notes?: string;
  createdAt: string;
}

/** Dépense — money OUT, classified by category. */
export interface ExpenseRecord {
  id: string;
  projectId?: string;
  category: ExpenseCategory;
  label: string;
  amountMad: number;
  method?: string;
  reference?: string;
  supplierId?: string;
  spentAt: string;
  notes?: string;
  createdAt: string;
}

export interface ExpenseCategoryTotal {
  category: ExpenseCategory;
  count: number;
  totalMad: number;
}

/** GET /finance/expenses/summary envelope. */
export interface ExpenseSummary {
  byCategory: ExpenseCategoryTotal[];
  totalMad: number;
}

/** GET /finance/cashflow envelope. */
export interface Cashflow {
  incomesMad: number;
  expensesMad: number;
  netMad: number;
}

/** Fournisseur — frontend mirror of @atlas/core supply SupplierRecord (subset). */
export interface SupplierRecord {
  id: string;
  name: string;
  status: 'actif' | 'inactif';
}

/** Payment method → French label. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  virement: 'Virement',
  cheque: 'Chèque',
  espece: 'Espèces',
  effet: 'Effet',
  autre: 'Autre',
};

/** Methods offered in the add-payment form, in display order. */
export const PAYMENT_METHOD_OPTIONS: readonly {
  value: PaymentMethod;
  label: string;
}[] = [
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'espece', label: 'Espèces' },
  { value: 'effet', label: 'Effet' },
  { value: 'autre', label: 'Autre' },
];

/** Expense category → French label + badge classes (mirrors *_BADGES). */
export const EXPENSE_CATEGORY_BADGES: Record<
  ExpenseCategory,
  { label: string; classes: string }
> = {
  location_materiel: {
    label: 'Location matériel',
    classes: 'bg-cyan-soft text-cyan',
  },
  materiaux: { label: 'Matériaux', classes: 'bg-emerald-soft text-emerald' },
  main_oeuvre: { label: "Main d'œuvre", classes: 'bg-ochre-soft text-ochre' },
  carburant: { label: 'Carburant', classes: 'bg-clay-soft text-clay' },
  transport: { label: 'Transport', classes: 'bg-cyan-soft text-cyan' },
  sous_traitance: {
    label: 'Sous-traitance',
    classes: 'bg-ochre-soft text-ochre-deep',
  },
  administratif: { label: 'Administratif', classes: 'bg-sand text-muted' },
  taxes: { label: 'Taxes', classes: 'bg-clay-soft text-clay' },
  autre: { label: 'Autre', classes: 'bg-sand text-faint' },
};

/** Categories offered in the add-expense form select, in display order. */
export const EXPENSE_CATEGORY_OPTIONS: readonly {
  value: ExpenseCategory;
  label: string;
}[] = [
  { value: 'location_materiel', label: 'Location matériel' },
  { value: 'materiaux', label: 'Matériaux' },
  { value: 'main_oeuvre', label: "Main d'œuvre" },
  { value: 'carburant', label: 'Carburant' },
  { value: 'transport', label: 'Transport' },
  { value: 'sous_traitance', label: 'Sous-traitance' },
  { value: 'administratif', label: 'Administratif' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'autre', label: 'Autre' },
];

export { fmtMad };
