'use client';

import { useMemo, useState } from 'react';
import {
  MARKETPLACE_CATALOG,
  CATALOG_PRODUCT_COUNT,
  CATALOG_VARIANTE_COUNT,
  ACCENT_CLASSES,
  fmtCatalogPrice,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogVariante,
} from '@/lib/marketplace-catalog';

/** Live stock state for a catalogue code, joined from the DB by the page. */
export interface CatalogueStockState {
  onHand: number;
  cost: number | null;
}

interface DepotOption {
  id: string;
  name: string;
}

interface MarketplaceBrowseProps {
  /** code → current on-hand + last known unit cost (only activated codes). */
  stockByCode: Record<string, CatalogueStockState>;
  depots: DepotOption[];
  /** Server action: records a purchase movement for one catalogue variante. */
  addStock: (formData: FormData) => Promise<void>;
}

/** Diacritic- and case-insensitive search key. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Marketplace stock signal → French label + badge classes. */
function stockBadge(status: string | null): { label: string; classes: string } | null {
  if (status === 'EN_STOCK')
    return { label: 'En stock', classes: 'bg-emerald-soft text-emerald' };
  if (status === 'RUPTURE_DE_STOCK')
    return { label: 'Sur commande', classes: 'bg-sand text-faint' };
  return null;
}

// ── Image with graceful fallback chain (variante → product → category) ────────
function Img({
  candidates,
  alt,
  className,
}: {
  candidates: (string | null | undefined)[];
  alt: string;
  className?: string;
}) {
  const list = useMemo(
    () => candidates.filter((c): c is string => Boolean(c)),
    [candidates],
  );
  const [index, setIndex] = useState(0);
  const src = list[index];
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-sand text-2xl text-faint ${className ?? ''}`}
        aria-label={alt}
      >
        📦
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      loading="lazy"
      onError={() => setIndex((i) => Math.min(i + 1, list.length))}
      className={className}
    />
  );
}

type View =
  | { level: 'categories' }
  | { level: 'category'; categoryId: string }
  | { level: 'product'; categoryId: string; productId: string };

export function MarketplaceBrowse({
  stockByCode,
  depots,
  addStock,
}: MarketplaceBrowseProps) {
  const [view, setView] = useState<View>({ level: 'categories' });
  const [query, setQuery] = useState('');
  const needle = normalize(query.trim());

  const category =
    view.level !== 'categories'
      ? MARKETPLACE_CATALOG.find((c) => c.id === view.categoryId) ?? null
      : null;
  const product =
    view.level === 'product' && category
      ? category.products.find((p) => p.id === view.productId) ?? null
      : null;

  // Flat search across products + their variantes; results are product cards.
  const searchResults = useMemo(() => {
    if (!needle) return [];
    const out: { category: CatalogCategory; product: CatalogProduct }[] = [];
    for (const cat of MARKETPLACE_CATALOG) {
      for (const prod of cat.products) {
        const hay = normalize(
          `${prod.name} ${prod.description} ${prod.variantes
            .map((v) => `${v.name} ${v.code}`)
            .join(' ')}`,
        );
        if (hay.includes(needle)) out.push({ category: cat, product: prod });
      }
    }
    return out;
  }, [needle]);

  const openCategory = (categoryId: string) => {
    setQuery('');
    setView({ level: 'category', categoryId });
    scrollTop();
  };
  const openProduct = (categoryId: string, productId: string) => {
    setQuery('');
    setView({ level: 'product', categoryId, productId });
    scrollTop();
  };

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-card">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-line px-6 py-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ochre-soft/40 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ochre">
              Marketplace matériaux
            </p>
            <h2 className="mt-1 font-display text-2xl font-black tracking-tight text-ink">
              Catalogue fournisseurs
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Choisissez une <span className="text-ink">catégorie</span>, puis un{' '}
              <span className="text-ink">produit</span>, puis une{' '}
              <span className="text-ink">variante</span> — la quantité et le prix
              alimentent votre stock.
            </p>
            <div className="mt-3 flex items-center gap-6">
              <Stat value={MARKETPLACE_CATALOG.length} label="Catégories" />
              <Stat value={CATALOG_PRODUCT_COUNT} label="Produits" />
              <Stat value={CATALOG_VARIANTE_COUNT} label="Variantes" />
            </div>
          </div>
          <label className="relative">
            <span className="sr-only">Rechercher dans le catalogue</span>
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Recherche catalogue…"
              className="w-64 rounded-lg border border-line-2 bg-paper py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-ochre focus:outline-none focus:ring-1 focus:ring-ochre"
            />
          </label>
        </div>
      </div>

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      {(view.level !== 'categories' || needle) && (
        <nav className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-3 text-xs">
          <Crumb
            label="Catalogue"
            onClick={() => {
              setQuery('');
              setView({ level: 'categories' });
              scrollTop();
            }}
          />
          {needle ? (
            <>
              <Sep />
              <span className="font-semibold text-ink">Recherche « {query} »</span>
            </>
          ) : (
            category && (
              <>
                <Sep />
                <Crumb
                  label={category.name}
                  active={view.level === 'category'}
                  onClick={() => openCategory(category.id)}
                />
                {product && (
                  <>
                    <Sep />
                    <span className="font-semibold text-ink">{product.name}</span>
                  </>
                )}
              </>
            )
          )}
        </nav>
      )}

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {needle ? (
        <SearchResults
          results={searchResults}
          query={query}
          onOpen={openProduct}
        />
      ) : view.level === 'categories' ? (
        <CategoryGrid onOpen={openCategory} />
      ) : view.level === 'category' && category ? (
        <CategoryView category={category} onOpen={openProduct} />
      ) : product && category ? (
        <ProductView
          category={category}
          product={product}
          stockByCode={stockByCode}
          depots={depots}
          addStock={addStock}
        />
      ) : (
        <p className="p-10 text-center text-sm text-faint">Élément introuvable.</p>
      )}
    </section>
  );
}

function scrollTop() {
  if (typeof window !== 'undefined')
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-mono text-xl font-black leading-none tabular-nums text-ink">
        {value}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-faint">
        {label}
      </p>
    </div>
  );
}

function Crumb({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 font-semibold transition ${
        active ? 'text-ink' : 'text-muted hover:text-ochre'
      }`}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span className="text-faint">/</span>;
}

// ── Level 0 : categories ─────────────────────────────────────────────────────
function CategoryGrid({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MARKETPLACE_CATALOG.map((category) => (
        <CategoryCard key={category.id} category={category} onOpen={onOpen} />
      ))}
    </div>
  );
}

function CategoryCard({
  category,
  onOpen,
}: {
  category: CatalogCategory;
  onOpen: (id: string) => void;
}) {
  const accent = ACCENT_CLASSES[category.accent];
  return (
    <button
      type="button"
      onClick={() => onOpen(category.id)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-paper text-left transition hover:-translate-y-1 hover:border-line-2 hover:shadow-raised"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Img
          candidates={[category.image]}
          alt={category.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/40 to-transparent" />
        <span className="absolute right-3 top-3 rounded-full bg-paper/80 px-2 py-1 font-mono text-[11px] font-bold tabular-nums text-ink backdrop-blur">
          {String(category.position).padStart(2, '0')}
        </span>
        <span
          className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${accent.softBg} ${accent.text}`}
        >
          {category.productCount} produit{category.productCount > 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg font-bold text-ink">
          {category.name}
        </h3>
        <p className="mt-0.5 text-xs text-faint">
          {category.varianteCount} variante{category.varianteCount > 1 ? 's' : ''}
        </p>
        <span
          className={`mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${accent.text}`}
        >
          Explorer le catalogue
          <span className="transition group-hover:translate-x-1">→</span>
        </span>
      </div>
    </button>
  );
}

// ── Level 1 : products in a category ─────────────────────────────────────────
function CategoryView({
  category,
  onOpen,
}: {
  category: CatalogCategory;
  onOpen: (categoryId: string, productId: string) => void;
}) {
  const accent = ACCENT_CLASSES[category.accent];
  return (
    <div>
      <div className="relative h-40 overflow-hidden border-b border-line sm:h-48">
        <Img
          candidates={[category.image]}
          alt={category.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-paper-2 via-paper-2/50 to-transparent" />
        <div className="absolute bottom-4 left-6">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${accent.softBg} ${accent.text}`}
          >
            {category.productCount} produits · {category.varianteCount} variantes
          </span>
          <h3 className="mt-2 font-display text-2xl font-black text-ink">
            {category.name}
          </h3>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-4">
        {category.products.map((prod) => (
          <ProductCard
            key={prod.id}
            product={prod}
            categoryImage={category.image}
            onOpen={() => onOpen(category.id, prod.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  categoryImage,
  onOpen,
}: {
  product: CatalogProduct;
  categoryImage: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-paper text-left transition hover:-translate-y-1 hover:border-line-2 hover:shadow-raised"
    >
      <div className="aspect-square overflow-hidden bg-sand">
        <Img
          candidates={[product.image, categoryImage]}
          alt={product.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h4 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-ink">
          {product.name}
        </h4>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-faint">
              À partir de
            </p>
            <p className="font-mono text-sm font-bold tabular-nums text-ink">
              {fmtCatalogPrice(product.minPrice, product.currencyCode)}
            </p>
          </div>
          <span className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-semibold text-muted">
            {product.variantes.length} var.
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Level 2 : variantes of a product ─────────────────────────────────────────
function ProductView({
  category,
  product,
  stockByCode,
  depots,
  addStock,
}: {
  category: CatalogCategory;
  product: CatalogProduct;
  stockByCode: Record<string, CatalogueStockState>;
  depots: DepotOption[];
  addStock: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="h-40 w-full shrink-0 overflow-hidden rounded-xl border border-line bg-sand sm:h-44 sm:w-44">
          <Img
            candidates={[product.image, category.image]}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-black text-ink">
            {product.name}
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-faint">
            {product.variantes.length} variante
            {product.variantes.length > 1 ? 's' : ''} · à partir de{' '}
            {fmtCatalogPrice(product.minPrice, product.currencyCode)}
          </p>
          {product.description && (
            <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted">
              {product.description}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {product.variantes.map((variante) => (
          <VarianteRow
            key={variante.id}
            variante={variante}
            category={category}
            productImage={product.image}
            stock={stockByCode[variante.code]}
            depots={depots}
            addStock={addStock}
          />
        ))}
      </div>
    </div>
  );
}

function VarianteRow({
  variante,
  category,
  productImage,
  stock,
  depots,
  addStock,
}: {
  variante: CatalogVariante;
  category: CatalogCategory;
  productImage: string | null;
  stock?: CatalogueStockState;
  depots: DepotOption[];
  addStock: (formData: FormData) => Promise<void>;
}) {
  const badge = stockBadge(variante.stockStatus);
  return (
    <div className="rounded-xl border border-line bg-paper p-4 transition hover:border-line-2">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Identity */}
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-sand">
            <Img
              candidates={[variante.image, productImage, category.image]}
              alt={variante.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-ink">{variante.name}</h4>
              {badge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}
                >
                  {badge.label}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
              <span className="font-mono">{variante.code}</span>
              <span>·</span>
              <span>{variante.measureName ?? variante.unit}</span>
            </div>
            <p className="mt-1 font-mono text-base font-black tabular-nums text-ink">
              {fmtCatalogPrice(variante.price, variante.currencyCode)}
              <span className="ml-1 text-[11px] font-normal text-faint">
                / {variante.unit}
              </span>
            </p>
            {variante.offers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-faint">
                  {variante.offers.length} fournisseur
                  {variante.offers.length > 1 ? 's' : ''} :
                </span>
                {variante.offers.slice(0, 5).map((offer, i) => (
                  <span
                    key={i}
                    title={`${offer.supplierName} — ${fmtCatalogPrice(offer.price, offer.currencyCode)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-2 py-0.5 pl-0.5 pr-2 text-[10px] text-muted"
                  >
                    {offer.supplierLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={offer.supplierLogo}
                        alt={offer.supplierName}
                        className="h-4 w-4 rounded-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-sand text-[8px]">
                        {offer.supplierName.charAt(0)}
                      </span>
                    )}
                    <span className="max-w-[7rem] truncate">
                      {offer.supplierName}
                    </span>
                    <span className="font-mono font-semibold text-ink">
                      {offer.price?.toLocaleString('fr-MA') ?? '—'}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {stock && stock.onHand !== 0 && (
              <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-soft px-2 py-0.5 text-[10px] font-semibold text-emerald">
                ●{' '}
                {stock.onHand.toLocaleString('fr-MA', {
                  maximumFractionDigits: 2,
                })}{' '}
                {variante.unit} en stock
              </span>
            )}
          </div>
        </div>

        {/* Add-to-stock */}
        <AddToStockForm
          variante={variante}
          categoryName={category.name}
          depots={depots}
          addStock={addStock}
        />
      </div>
    </div>
  );
}

function AddToStockForm({
  variante,
  categoryName,
  depots,
  addStock,
}: {
  variante: CatalogVariante;
  categoryName: string;
  depots: DepotOption[];
  addStock: (formData: FormData) => Promise<void>;
}) {
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(
    variante.price != null && variante.price > 0 ? String(variante.price) : '',
  );

  const quantity = Number.parseFloat(qty);
  const unitPrice = Number.parseFloat(price);
  const lineTotal =
    (Number.isFinite(quantity) ? quantity : 0) *
    (Number.isFinite(unitPrice) ? unitPrice : 0);
  const canAdd = Number.isFinite(quantity) && quantity > 0;

  return (
    <form
      action={addStock}
      className="w-full shrink-0 rounded-lg border border-line bg-paper-2 p-3 lg:w-72"
    >
      <input type="hidden" name="code" value={variante.code} />
      <input type="hidden" name="designation" value={variante.name} />
      <input type="hidden" name="unit" value={variante.unit} />
      <input type="hidden" name="category" value={categoryName} />

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">
          Quantité ({variante.unit})
          <input
            type="number"
            name="quantity"
            required
            min={0}
            step="0.01"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
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
            className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
          />
        </label>
      </div>

      {depots.length > 1 ? (
        <label className="mt-2 block text-[11px] text-muted">
          Dépôt
          <select
            name="depotId"
            defaultValue={depots[0]?.id}
            className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
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

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-faint">
          {lineTotal > 0
            ? `${lineTotal.toLocaleString('fr-MA', { maximumFractionDigits: 2 })} MAD`
            : '—'}
        </span>
        <button
          type="submit"
          disabled={!canAdd}
          className="rounded-md bg-cyan-deep px-4 py-1.5 text-xs font-bold text-paper transition hover:bg-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ajouter au stock
        </button>
      </div>
    </form>
  );
}

// ── Search results (flat product cards across all categories) ────────────────
function SearchResults({
  results,
  query,
  onOpen,
}: {
  results: { category: CatalogCategory; product: CatalogProduct }[];
  query: string;
  onOpen: (categoryId: string, productId: string) => void;
}) {
  if (results.length === 0) {
    return (
      <p className="p-12 text-center text-sm text-faint">
        Aucun produit ne correspond à « {query} ».
      </p>
    );
  }
  return (
    <div>
      <p className="px-6 pt-5 text-xs font-semibold uppercase tracking-widest text-faint">
        {results.length} résultat{results.length > 1 ? 's' : ''}
      </p>
      <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {results.map(({ category, product }) => (
          <div key={`${category.id}:${product.id}`} className="flex flex-col">
            <ProductCard
              product={product}
              categoryImage={category.image}
              onOpen={() => onOpen(category.id, product.id)}
            />
            <span className="mt-1.5 pl-1 text-[10px] uppercase tracking-wide text-faint">
              {category.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
