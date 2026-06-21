import { fmtMad } from './projects';

/**
 * Stock & matériaux — frontend mirror of the @atlas/core stock module contract
 * (apps/core/src/modules/stock). Numerics arrive as numbers (the repository
 * surfaces the Postgres strings as numbers); MAD formatting reuses fmtMad.
 */

export type MovementKind =
  | 'initial'
  | 'purchase'
  | 'transfer'
  | 'consumption'
  | 'adjustment';

export interface MaterialRecord {
  id: string;
  code: string;
  designation: string;
  unit: string;
  category?: string;
  unitCostMad?: number;
  createdAt: string;
}

export interface DepotRecord {
  id: string;
  name: string;
  location?: string;
  createdAt: string;
}

export interface StockMovementRecord {
  id: string;
  kind: MovementKind;
  materialId: string;
  quantity: number;
  unitCostMad?: number;
  fromDepotId?: string;
  toDepotId?: string;
  projectId?: string;
  reference?: string;
  notes?: string;
  occurredAt: string;
  createdAt: string;
}

/** Signed quantity on hand for one (depot, material) pair. */
export interface DepotBalance {
  depotId: string;
  materialId: string;
  quantity: number;
}

export interface ConsumptionHistoryEntry {
  occurredAt: string;
  quantity: number;
  fromDepotId?: string;
  reference?: string;
}

export interface ProjectMaterialConsumption {
  materialId: string;
  designation: string;
  unit: string;
  totalQuantity: number;
  totalCostMad: number;
  history: ConsumptionHistoryEntry[];
}

/** Movement kind → French label + badge classes (mirrors PROJECT_STATUS_BADGES). */
export const MOVEMENT_KIND_BADGES: Record<
  MovementKind,
  { label: string; classes: string }
> = {
  initial: { label: 'Stock initial', classes: 'bg-sand text-muted' },
  purchase: { label: 'Achat', classes: 'bg-emerald-soft text-emerald' },
  transfer: { label: 'Transfert', classes: 'bg-cyan-soft text-cyan' },
  consumption: { label: 'Consommation', classes: 'bg-ochre-soft text-ochre' },
  adjustment: { label: 'Ajustement', classes: 'bg-sand text-faint' },
};

/** Kinds offered in the record-movement form, with their depot requirements. */
export const MOVEMENT_KIND_OPTIONS: readonly {
  value: MovementKind;
  label: string;
  needsFrom: boolean;
  needsTo: boolean;
}[] = [
  { value: 'initial', label: 'Stock initial', needsFrom: false, needsTo: true },
  { value: 'purchase', label: 'Achat (entrée)', needsFrom: false, needsTo: true },
  {
    value: 'transfer',
    label: 'Transfert entre dépôts',
    needsFrom: true,
    needsTo: true,
  },
  {
    value: 'consumption',
    label: 'Consommation chantier (sortie)',
    needsFrom: true,
    needsTo: false,
  },
  {
    value: 'adjustment',
    label: 'Ajustement (correction)',
    needsFrom: false,
    needsTo: true,
  },
];

/** Quantity formatted fr-MA with up to 2 decimals, suffixed by the unit. */
export function fmtQty(value: number, unit?: string): string {
  const formatted = value.toLocaleString('fr-MA', {
    maximumFractionDigits: 2,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

export { fmtMad };
