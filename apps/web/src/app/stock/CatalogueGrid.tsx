'use client';

import { useMemo, useState } from 'react';
import {
  MATERIALS_CATALOG,
  MATERIAL_CATEGORIES,
  materialImageSrc,
  categoryEmblemSrc,
  type CatalogueMaterial,
  type MaterialCategoryKey,
} from '@/lib/materials-catalog';

/** Live stock state for a catalogue code, joined from the DB by the page. */
export interface CatalogueStockState {
  onHand: number;
  cost: number | null;
}

interface DepotOption {
  id: string;
  name: string;
}

interface CatalogueGridProps {
  /** code → current on-hand + last known unit cost (only activated codes). */
  stockByCode: Record<string, CatalogueStockState>;
  depots: DepotOption[];
  /** Server action: records a purchase movement for one catalogue material. */
  addStock: (formData: FormData) => Promise<void>;
}

/** Diacritic-insensitive, case-insensitive search key. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** MAD line total, or an em dash when there is nothing to price yet. */
function fmtTotal(value: number): string {
  if (!(value > 0)) return '—';
  return `${value.toLocaleString('fr-MA', { maximumFractionDigits: 2 })} MAD`;
}

const ALL = 'all' as const;
type Filter = MaterialCategoryKey | typeof ALL;

export function CatalogueGrid({ stockByCode, depots, addStock }: CatalogueGridProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(ALL);
  const needle = normalize(query.trim());

  const counts = useMemo(() => {
    const map = new Map<MaterialCategoryKey, number>();
    for (const material of MATERIALS_CATALOG) {
      map.set(material.category, (map.get(material.category) ?? 0) + 1);
    }
    return map;
  }, []);

  const visible = useMemo(
    () =>
      MATERIALS_CATALOG.filter((material) => {
        if (filter !== ALL && material.category !== filter) return false;
        if (!needle) return true;
        return (
          normalize(material.designation).includes(needle) ||
          normalize(material.code).includes(needle)
        );
      }),
    [filter, needle],
  );

  const groups = useMemo(
    () =>
      MATERIAL_CATEGORIES.map((category) => ({
        category,
        items: visible.filter((m) => m.category === category.key),
      })).filter((group) => group.items.length > 0),
    [visible],
  );

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Catalogue matériaux ({visible.length}/{MATERIALS_CATALOG.length})
          </h2>
          <p className="mt-0.5 text-xs text-faint">
            L’ouvrier saisit la <span className="text-muted">quantité</span> et le{' '}
            <span className="text-muted">montant</span> — le solde et la valeur du
            stock se mettent à jour.
          </p>
        </div>
        <label className="relative">
          <span className="sr-only">Rechercher un matériau</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un matériau…"
            className="w-60 rounded-md border border-line-2 bg-paper px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
        <FilterChip
          label="Tous"
          count={MATERIALS_CATALOG.length}
          active={filter === ALL}
          onClick={() => setFilter(ALL)}
        />
        {MATERIAL_CATEGORIES.map((category) => (
          <FilterChip
            key={category.key}
            label={category.label}
            count={counts.get(category.key) ?? 0}
            active={filter === category.key}
            onClick={() => setFilter(category.key)}
          />
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="p-10 text-center text-sm text-faint">
          Aucun matériau ne correspond à « {query} ».
        </p>
      ) : (
        <div className="space-y-8 px-5 py-6">
          {groups.map(({ category, items }) => (
            <div key={category.key}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${category.accentBg} ${category.accentText}`}
                >
                  {category.label}
                </span>
                <span className="text-xs text-faint">{items.length}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {items.map((material) => (
                  <MaterialCard
                    key={material.code}
                    material={material}
                    stock={stockByCode[material.code]}
                    depots={depots}
                    addStock={addStock}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, count, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-cyan bg-cyan-soft text-cyan'
          : 'border-line-2 text-muted hover:border-cyan hover:text-ink'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${active ? 'text-cyan/70' : 'text-faint'}`}>
        {count}
      </span>
    </button>
  );
}

interface MaterialCardProps {
  material: CatalogueMaterial;
  stock?: CatalogueStockState;
  depots: DepotOption[];
  addStock: (formData: FormData) => Promise<void>;
}

function MaterialCard({ material, stock, depots, addStock }: MaterialCardProps) {
  const [imgSrc, setImgSrc] = useState(materialImageSrc(material));
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

  const quantity = Number.parseFloat(qty);
  const unitPrice = Number.parseFloat(price);
  const lineTotal =
    (Number.isFinite(quantity) ? quantity : 0) *
    (Number.isFinite(unitPrice) ? unitPrice : 0);
  const canAdd = Number.isFinite(quantity) && quantity > 0;

  return (
    <div className="group flex flex-col rounded-xl border border-line bg-paper p-3 transition hover:-translate-y-0.5 hover:border-line-2 hover:shadow-lg">
      <div
        className="mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-lg p-3"
        style={{ background: 'linear-gradient(160deg, #fbfcfd, #e9edf1)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt={material.designation}
          draggable={false}
          loading="lazy"
          onError={() => setImgSrc(categoryEmblemSrc(material.category))}
          className="h-full w-full object-contain transition group-hover:scale-105"
        />
      </div>

      <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-ink">
        {material.designation}
      </h3>
      <div className="mt-0.5 flex items-center justify-between text-[11px] uppercase tracking-wide text-faint">
        <span className="font-mono">{material.code}</span>
        <span>{material.unit}</span>
      </div>

      {stock && stock.onHand !== 0 && (
        <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-soft px-2 py-0.5 text-[10px] font-semibold text-emerald">
          ● {stock.onHand.toLocaleString('fr-MA', { maximumFractionDigits: 2 })}{' '}
          {material.unit} en stock
        </span>
      )}

      <form action={addStock} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <input type="hidden" name="code" value={material.code} />
        <input type="hidden" name="designation" value={material.designation} />
        <input type="hidden" name="unit" value={material.unit} />
        <input type="hidden" name="category" value={material.category} />

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted">
            Quantité
            <input
              type="number"
              name="quantity"
              required
              min={0}
              step="0.01"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-md border border-line-2 bg-paper-2 px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-[11px] text-muted">
            Prix unit. (MAD)
            <input
              type="number"
              name="unitCostMad"
              min={0}
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-md border border-line-2 bg-paper-2 px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
            />
          </label>
        </div>

        {depots.length > 1 ? (
          <label className="text-[11px] text-muted">
            Dépôt
            <select
              name="depotId"
              defaultValue={depots[0]?.id}
              className="mt-1 w-full rounded-md border border-line-2 bg-paper-2 px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
            >
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          depots[0] && <input type="hidden" name="depotId" value={depots[0].id} />
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-faint">
            {fmtTotal(lineTotal)}
          </span>
          <button
            type="submit"
            disabled={!canAdd}
            className="rounded-md bg-cyan-deep px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}
