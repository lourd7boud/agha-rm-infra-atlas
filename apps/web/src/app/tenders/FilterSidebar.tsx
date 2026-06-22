'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PIPELINE_LABELS } from '@/lib/labels';
import type { PipelineState } from '@atlas/contracts';
import type { TenderFacet, TenderFacets } from '@/lib/tenders';

export type Statut = 'en_cours' | 'echus' | 'tous';
export type MultiKey =
  | 'procedures'
  | 'categories'
  | 'secteurs'
  | 'regions'
  | 'buyers'
  | 'states';

export interface FilterState {
  statut: Statut;
  search: string;
  procedures: string[];
  categories: string[];
  secteurs: string[];
  regions: string[];
  buyers: string[];
  states: string[];
  budgetOnly: boolean;
  cautionOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  statut: 'en_cours',
  search: '',
  procedures: [],
  categories: [],
  secteurs: [],
  regions: [],
  buyers: [],
  states: [],
  budgetOnly: false,
  cautionOnly: false,
};

const STATUTS: ReadonlyArray<{ key: Statut; label: string }> = [
  { key: 'en_cours', label: 'En cours' },
  { key: 'echus', label: 'Échus' },
  { key: 'tous', label: 'Tous' },
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function CollapsibleGroup({
  title,
  icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: IconName;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-line bg-paper-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-ink"
      >
        <Icon name={icon} size={15} className="text-faint" />
        <span className="flex-1 text-left">{title}</span>
        {count ? (
          <span className="rounded-full bg-cyan-soft px-1.5 text-[10px] font-bold text-cyan">
            {count}
          </span>
        ) : null}
        <Icon
          name="chevronRight"
          size={14}
          className={`text-faint transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && <div className="border-t border-line px-3 py-2">{children}</div>}
    </div>
  );
}

function FacetChecks({
  facets,
  selected,
  onToggle,
  searchable,
}: {
  facets: TenderFacet[];
  selected: string[];
  onToggle: (key: string) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState('');
  const list =
    searchable && q.trim()
      ? facets.filter((f) => f.label.toLowerCase().includes(q.toLowerCase()))
      : facets;
  return (
    <div>
      {searchable && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrer…"
          className="mb-2 w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
        />
      )}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
        {list.map((facet) => {
          const on = selected.includes(facet.key);
          return (
            <li key={facet.key}>
              <button
                type="button"
                onClick={() => onToggle(facet.key)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                  on ? 'bg-cyan-soft/60 text-ink' : 'text-muted hover:bg-sand'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? 'border-cyan bg-cyan text-paper' : 'border-line-2'
                  }`}
                >
                  {on && <Icon name="check" size={11} />}
                </span>
                <span className="flex-1 truncate" title={facet.label}>
                  {facet.label}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-faint">
                  {facet.count}
                </span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-faint">Aucune option</li>
        )}
      </ul>
    </div>
  );
}

function Toggle({
  label,
  icon,
  on,
  onClick,
}: {
  label: string;
  icon: IconName;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper-2 px-3 py-2.5 text-sm font-semibold text-ink"
    >
      <Icon name={icon} size={15} className="text-faint" />
      <span className="flex-1 text-left">{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition ${
          on ? 'bg-cyan' : 'bg-sand'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-all ${
            on ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

interface FilterSidebarProps {
  facets: TenderFacets;
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}

export function FilterSidebar({
  facets,
  value,
  onChange,
  onReset,
}: FilterSidebarProps) {
  const stateFacets = facets.states.map((f) => ({
    ...f,
    label: PIPELINE_LABELS[f.key as PipelineState]?.label ?? f.key,
  }));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-paper-2 p-1">
        {STATUTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange({ statut: s.key })}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              value.statut === s.key
                ? 'bg-cyan-soft text-ink'
                : 'text-muted hover:bg-sand'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Icon
          name="search"
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Rechercher (objet, acheteur…)"
          className="w-full rounded-lg border border-line bg-paper-2 py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/15"
        />
      </div>

      <CollapsibleGroup
        title="Catégories"
        icon="boxes"
        count={value.categories.length}
        defaultOpen
      >
        <FacetChecks
          facets={facets.categories}
          selected={value.categories}
          onToggle={(k) => onChange({ categories: toggle(value.categories, k) })}
        />
      </CollapsibleGroup>

      <CollapsibleGroup
        title="Mode de procédure"
        icon="tenders"
        count={value.procedures.length}
      >
        <FacetChecks
          facets={facets.procedures}
          selected={value.procedures}
          onToggle={(k) => onChange({ procedures: toggle(value.procedures, k) })}
        />
      </CollapsibleGroup>

      <CollapsibleGroup title="Secteurs" icon="activity" count={value.secteurs.length}>
        <FacetChecks
          facets={facets.secteurs}
          selected={value.secteurs}
          onToggle={(k) => onChange({ secteurs: toggle(value.secteurs, k) })}
          searchable
        />
      </CollapsibleGroup>

      <CollapsibleGroup title="Régions" icon="pin" count={value.regions.length}>
        <FacetChecks
          facets={facets.regions}
          selected={value.regions}
          onToggle={(k) => onChange({ regions: toggle(value.regions, k) })}
          searchable
        />
      </CollapsibleGroup>

      <CollapsibleGroup title="Acheteurs" icon="analytics" count={value.buyers.length}>
        <FacetChecks
          facets={facets.buyers}
          selected={value.buyers}
          onToggle={(k) => onChange({ buyers: toggle(value.buyers, k) })}
          searchable
        />
      </CollapsibleGroup>

      <CollapsibleGroup title="État du dossier" icon="check" count={value.states.length}>
        <FacetChecks
          facets={stateFacets}
          selected={value.states}
          onToggle={(k) => onChange({ states: toggle(value.states, k) })}
        />
      </CollapsibleGroup>

      <Toggle
        label="Budget estimé"
        icon="tresorerie"
        on={value.budgetOnly}
        onClick={() => onChange({ budgetOnly: !value.budgetOnly })}
      />
      <Toggle
        label="Caution requise"
        icon="vault"
        on={value.cautionOnly}
        onClick={() => onChange({ cautionOnly: !value.cautionOnly })}
      />

      <button
        type="button"
        onClick={onReset}
        className="mt-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink"
      >
        Réinitialiser les filtres
      </button>
    </div>
  );
}
