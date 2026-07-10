'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Render as a plain full-page anchor instead of a Next client-side link.
   *  Used for surfaces served outside the Next app (e.g. /projects/ — the ported
   *  BTP construction-management SPA proxied by nginx, not a Next route). */
  external?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Command Center', icon: 'command' },
  { href: '/tenders', label: 'Marchés Publics', icon: 'tenders' },
  { href: '/tenders/lists', label: 'Listes', icon: 'boxes' },
  { href: '/tenders/searches', label: 'Recherches sauvegardées', icon: 'search' },
  { href: '/tenders/ai', label: 'Assistant IA', icon: 'agents' },
  { href: '/expert', label: 'Agent AGHA', icon: 'intel' },
  { href: '/projects', label: 'Projets & Chantiers', icon: 'chantiers' },
  { href: '/stock', label: 'Stock & Matériaux', icon: 'boxes' },
  { href: '/equipment', label: 'Matériel & Équipements', icon: 'equipment' },
  { href: '/supply', label: 'Approvisionnements', icon: 'supply' },
  { href: '/finance', label: 'Finance', icon: 'tresorerie' },
  { href: '/people', label: 'Personnel', icon: 'personnel' },
  { href: '/vault', label: 'Documents & GED', icon: 'documents' },
  { href: '/intel', label: 'Concurrence', icon: 'intel' },
  { href: '/buyers', label: 'Acheteurs', icon: 'analytics' },
  { href: '/agents', label: 'Salle des Agents', icon: 'agents' },
];

/** Commercial / Ventes — private-client devis, BL, factures (separate from the
 *  public-procurement Marchés flow). Grouped under its own heading. */
const SALES: readonly NavItem[] = [
  { href: '/sales/clients', label: 'Clients', icon: 'crm' },
  { href: '/sales/quotes', label: 'Devis', icon: 'quote' },
  { href: '/sales/delivery-notes', label: 'Bons de livraison', icon: 'delivery' },
  { href: '/sales/invoices', label: 'Factures', icon: 'invoice' },
];

/** Comptabilité — section repliable dédiée (accès direction/finance/admin-si
 *  et rôle `comptable` pour les cabinets externes). Un seul groupe pour une
 *  future gestion fine des permissions. */
const COMPTA: readonly NavItem[] = [
  { href: '/compta', label: 'Tableau de bord', icon: 'command' },
  { href: '/compta/ecritures', label: 'Écritures & journaux', icon: 'documents' },
  { href: '/compta/plan', label: 'Plan comptable', icon: 'boxes' },
  { href: '/compta/livres', label: 'Livres & états', icon: 'analytics' },
  { href: '/compta/tva', label: 'TVA', icon: 'invoice' },
  { href: '/compta/impots', label: 'Impôts & échéancier', icon: 'tenders' },
  { href: '/compta/social', label: 'CNSS & paie', icon: 'personnel' },
  { href: '/compta/immobilisations', label: 'Immobilisations', icon: 'equipment' },
  { href: '/compta/banques', label: 'Banques', icon: 'tresorerie' },
  { href: '/compta/legal', label: 'Statut légal & docs', icon: 'vault' },
  { href: '/compta/parametres', label: 'Paramètres fiscaux', icon: 'settings' },
];

/** Planned modules — shown for breadth, not yet routed. */
const SOON: readonly { label: string; icon: IconName }[] = [
  { label: 'Opérations Terrain', icon: 'terrain' },
  { label: 'BI & Analytics', icon: 'analytics' },
  { label: 'Paramètres Système', icon: 'settings' },
];

/** True when `href` is the LONGEST item prefix matching `path` — prevents
 *  /tenders/lists from activating /tenders as well. */
function isActive(
  path: string,
  href: string,
  allHrefs: readonly string[],
): boolean {
  if (href === '/') return path === '/';
  if (!(path === href || path.startsWith(`${href}/`))) return false;
  // Reject when a sibling item is a stricter (longer) prefix match for `path`.
  return !allHrefs.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (path === other || path.startsWith(`${other}/`)),
  );
}

export function RailNav({
  orientation = 'vertical',
  comptaVisible = false,
}: {
  orientation?: 'vertical' | 'horizontal';
  /** True pour les rôles direction / finance / admin-si / comptable. */
  comptaVisible?: boolean;
}) {
  const path = usePathname();
  const horizontal = orientation === 'horizontal';
  const onCompta = path === '/compta' || path.startsWith('/compta/');
  // Repli persistant du groupe Comptabilité (ouvert d'office sur ses pages) —
  // initialisé fermé côté serveur, hydraté depuis localStorage au montage.
  const [comptaOpen, setComptaOpen] = useState(false);
  useEffect(() => {
    if (onCompta) {
      setComptaOpen(true);
      return;
    }
    setComptaOpen(window.localStorage.getItem('atlas.nav.compta') === '1');
  }, [onCompta]);
  const toggleCompta = () => {
    setComptaOpen((open) => {
      const next = !open;
      window.localStorage.setItem('atlas.nav.compta', next ? '1' : '0');
      return next;
    });
  };
  // Combined href list (top items + groups) for the longest-prefix check.
  const allHrefs = [...ITEMS, ...SALES, ...(comptaVisible ? COMPTA : [])].map((i) => i.href);

  function renderItem(item: NavItem) {
    const active = isActive(path, item.href, allHrefs);
    const className = `group relative flex items-center gap-2.5 rounded-md text-sm transition ${
      horizontal ? 'shrink-0 px-3 py-1.5' : 'px-3 py-2'
    } ${
      active ? 'bg-cyan-soft/60 text-ink' : 'text-muted hover:bg-rail-2 hover:text-ink'
    }`;
    const inner = (
      <>
        {!horizontal && (
          <span
            className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-cyan transition-all ${
              active ? 'h-5 w-[3px]' : 'h-0 w-0'
            }`}
          />
        )}
        <Icon
          name={item.icon}
          size={18}
          className={active ? 'text-cyan' : 'text-faint group-hover:text-muted'}
        />
        <span className="whitespace-nowrap font-medium">{item.label}</span>
      </>
    );
    // External surfaces (e.g. the /projects BTP SPA served by nginx, not Next)
    // need a real document navigation, so Next's client router doesn't intercept
    // and render a (now non-existent) internal route.
    if (item.external) {
      return (
        <a key={item.href} href={item.href} className={className}>
          {inner}
        </a>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  return (
    <nav
      className={
        horizontal ? 'flex flex-row gap-1 overflow-x-auto pb-1' : 'flex flex-col gap-0.5'
      }
    >
      {ITEMS.map(renderItem)}

      {/* Comptabilité — groupe repliable, réservé aux rôles habilités. */}
      {comptaVisible && !horizontal && (
        <div className={`mt-5 ${onCompta ? '' : ''}`}>
          <button
            type="button"
            onClick={toggleCompta}
            aria-expanded={comptaOpen}
            className={`group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
              onCompta && !comptaOpen
                ? 'bg-cyan-soft/40 text-ink'
                : 'text-muted hover:bg-rail-2 hover:text-ink'
            }`}
          >
            <Icon
              name="tresorerie"
              size={18}
              className={onCompta ? 'text-cyan' : 'text-faint group-hover:text-muted'}
            />
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/80">
              Comptabilité
            </span>
            <span
              className={`ml-auto text-faint transition-transform duration-200 ${
                comptaOpen ? 'rotate-90' : ''
              }`}
              aria-hidden
            >
              ›
            </span>
          </button>
          {comptaOpen && (
            <div className="relative ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-line/70 pl-1.5">
              {COMPTA.map(renderItem)}
            </div>
          )}
        </div>
      )}
      {comptaVisible && horizontal && COMPTA.slice(0, 4).map(renderItem)}

      {!horizontal && (
        <p className="mt-5 mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/70">
          Commercial / Ventes
        </p>
      )}
      {SALES.map(renderItem)}

      {!horizontal && (
        <>
          <p className="mt-5 mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/70">
            Modules
          </p>
          {SOON.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-faint/50"
              title="Module à venir"
            >
              <Icon name={item.icon} size={18} className="text-faint/40" />
              <span className="whitespace-nowrap font-medium">{item.label}</span>
              <span className="ml-auto rounded-full bg-rail-2 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-faint/70">
                bientôt
              </span>
            </div>
          ))}
        </>
      )}
    </nav>
  );
}
