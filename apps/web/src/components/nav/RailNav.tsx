'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  external?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Command Center', icon: 'command' },
  { href: '/projects', label: 'Projets & Chantiers', icon: 'chantiers' },
  { href: '/stock', label: 'Stock & Matériaux', icon: 'boxes' },
  { href: '/equipment', label: 'Matériel & Équipements', icon: 'equipment' },
  { href: '/supply', label: 'Approvisionnements', icon: 'supply' },
  { href: '/finance', label: 'Finance', icon: 'tresorerie' },
  { href: '/people', label: 'Personnel', icon: 'personnel' },
  { href: '/agents', label: 'Salle des Agents', icon: 'agents' },
];

const MARCHES: readonly NavItem[] = [
  { href: '/tenders', label: 'Inventaire des marchés', icon: 'tenders' },
  { href: '/tenders/radar', label: 'Radar proactif', icon: 'activity' },
  { href: '/tenders/bc', label: 'Bons de commande', icon: 'quote' },
  { href: '/tenders/lists', label: 'Listes', icon: 'boxes' },
  { href: '/tenders/searches', label: 'Recherches sauvegardées', icon: 'search' },
  { href: '/tenders/ai', label: 'Assistant IA', icon: 'agents' },
  { href: '/expert', label: 'Agent AGHA', icon: 'intel' },
  { href: '/intel', label: 'Concurrence', icon: 'intel' },
  { href: '/buyers', label: 'Acheteurs', icon: 'analytics' },
];

const SALES: readonly NavItem[] = [
  { href: '/sales/clients', label: 'Clients', icon: 'crm' },
  { href: '/sales/quotes', label: 'Devis', icon: 'quote' },
  { href: '/sales/delivery-notes', label: 'Bons de livraison', icon: 'delivery' },
  { href: '/sales/invoices', label: 'Factures', icon: 'invoice' },
];

const COMPTA: readonly NavItem[] = [
  { href: '/compta', label: 'Tableau de bord', icon: 'command' },
  { href: '/compta/a-valider', label: 'À valider', icon: 'activity' },
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

const SOON: readonly { label: string; icon: IconName }[] = [
  { label: 'Opérations Terrain', icon: 'terrain' },
  { label: 'BI & Analytics', icon: 'analytics' },
  { label: 'Paramètres Système', icon: 'settings' },
];

function isActive(path: string, href: string, allHrefs: readonly string[]): boolean {
  if (href === '/') return path === '/';
  if (!(path === href || path.startsWith(`${href}/`))) return false;
  return !allHrefs.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (path === other || path.startsWith(`${other}/`)),
  );
}

function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      aria-label={label}
      className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[80] -translate-y-1/2 rounded-md border border-line bg-rail-2 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-ink opacity-0 shadow-raised transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function ActiveIndicator({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-cyan transition-all ${
        active ? 'h-5 w-[3px]' : 'h-0 w-0'
      }`}
    />
  );
}

interface RailNavProps {
  expanded?: boolean;
  comptaVisible?: boolean;
  salesVisible?: boolean;
  onNavigate?: () => void;
}

export function RailNav({
  expanded = true,
  comptaVisible = false,
  salesVisible = false,
  onNavigate,
}: RailNavProps) {
  const path = usePathname();
  const onCompta = path === '/compta' || path.startsWith('/compta/');
  const onSales = SALES.some((item) => path === item.href || path.startsWith(`${item.href}/`));
  const onComptaFacturation = onCompta || onSales;
  const onMarches = MARCHES.some(
    (item) => path === item.href || path.startsWith(`${item.href}/`),
  );
  const [comptaOpen, setComptaOpen] = useState(false);
  const [marchesOpen, setMarchesOpen] = useState(false);

  useEffect(() => {
    if (onComptaFacturation) {
      setComptaOpen(true);
      return;
    }
    setComptaOpen(window.localStorage.getItem('atlas.nav.compta') === '1');
  }, [onComptaFacturation]);

  useEffect(() => {
    if (onMarches) {
      setMarchesOpen(true);
      return;
    }
    setMarchesOpen(window.localStorage.getItem('atlas.nav.marches') !== '0');
  }, [onMarches]);

  const allHrefs = [
    ...ITEMS,
    ...MARCHES,
    ...(salesVisible ? SALES : []),
    ...(comptaVisible ? COMPTA : []),
  ].map((item) => item.href);

  const toggleMarches = () => {
    setMarchesOpen((current) => {
      const next = !current;
      window.localStorage.setItem('atlas.nav.marches', next ? '1' : '0');
      return next;
    });
  };

  const toggleCompta = () => {
    setComptaOpen((current) => {
      const next = !current;
      window.localStorage.setItem('atlas.nav.compta', next ? '1' : '0');
      return next;
    });
  };

  function renderItem(item: NavItem) {
    const active = isActive(path, item.href, allHrefs);
    const className = `group relative flex min-h-10 items-center rounded-md text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${
      expanded ? 'gap-2.5 px-3 py-2' : 'justify-center px-2 py-2.5'
    } ${
      active ? 'bg-cyan-soft/60 text-ink' : 'text-muted hover:bg-rail-2 hover:text-ink'
    }`;
    const content = (
      <>
        <ActiveIndicator active={active} />
        <Icon
          name={item.icon}
          size={18}
          className={`shrink-0 ${active ? 'text-cyan' : 'text-faint group-hover:text-muted'}`}
        />
        <span className={expanded ? 'whitespace-nowrap font-medium' : 'sr-only'}>
          {item.label}
        </span>
        {!expanded && <Tooltip label={item.label} />}
      </>
    );

    if (item.external) {
      return (
        <a
          key={item.href}
          href={item.href}
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
          data-active={active ? 'true' : 'false'}
          className={className}
          onClick={onNavigate}
        >
          {content}
        </a>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        data-active={active ? 'true' : 'false'}
        className={className}
        onClick={onNavigate}
      >
        {content}
      </Link>
    );
  }

  const groupButtonClass = (active: boolean) =>
    `group relative flex min-h-10 w-full items-center rounded-md text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${
      expanded ? 'gap-2.5 px-3 py-2' : 'justify-center px-2 py-2.5'
    } ${
      active && !expanded
        ? 'bg-cyan-soft/60 text-ink'
        : 'text-muted hover:bg-rail-2 hover:text-ink'
    }`;

  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
      {ITEMS.map(renderItem)}

      <div className={expanded ? 'mt-5' : 'mt-2'}>
        <button
          type="button"
          aria-label="Marchés & Prospection"
          aria-expanded={expanded ? marchesOpen : false}
          data-active={onMarches ? 'true' : 'false'}
          onClick={toggleMarches}
          className={groupButtonClass(onMarches)}
        >
          <ActiveIndicator active={onMarches && !expanded} />
          <Icon
            name="tenders"
            size={18}
            className={`shrink-0 ${onMarches ? 'text-cyan' : 'text-faint group-hover:text-muted'}`}
          />
          <span
            className={
              expanded
                ? 'whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/80'
                : 'sr-only'
            }
          >
            Marchés & Prospection
          </span>
          {expanded && (
            <span
              className={`ml-auto text-faint transition-transform duration-200 ${
                marchesOpen ? 'rotate-90' : ''
              }`}
              aria-hidden="true"
            >
              ›
            </span>
          )}
          {!expanded && <Tooltip label="Marchés & Prospection" />}
        </button>
        {expanded && marchesOpen && (
          <div className="relative ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-line/70 pl-1.5">
            {MARCHES.map(renderItem)}
          </div>
        )}
      </div>

      {(comptaVisible || salesVisible) && (
        <div className={expanded ? 'mt-5' : 'mt-2'}>
          <button
            type="button"
            aria-label="Comptabilité & Facturation"
            aria-expanded={expanded ? comptaOpen : false}
            data-active={onComptaFacturation ? 'true' : 'false'}
            onClick={toggleCompta}
            className={groupButtonClass(onComptaFacturation)}
          >
            <ActiveIndicator active={onComptaFacturation && !expanded} />
            <Icon
              name="tresorerie"
              size={18}
              className={`shrink-0 ${
                onComptaFacturation ? 'text-cyan' : 'text-faint group-hover:text-muted'
              }`}
            />
            <span
              className={
                expanded
                  ? 'whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/80'
                  : 'sr-only'
              }
            >
              Comptabilité & Facturation
            </span>
            {expanded && (
              <span
                className={`ml-auto text-faint transition-transform duration-200 ${
                  comptaOpen ? 'rotate-90' : ''
                }`}
                aria-hidden="true"
              >
                ›
              </span>
            )}
            {!expanded && <Tooltip label="Comptabilité & Facturation" />}
          </button>
          {expanded && comptaOpen && (
            <div className="relative ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-line/70 pl-1.5">
              {salesVisible && (
                <>
                  <p className="mb-0.5 mt-1 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint/60">
                    Facturation
                  </p>
                  {SALES.map(renderItem)}
                </>
              )}
              {comptaVisible && (
                <>
                  <p className="mb-0.5 mt-2 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint/60">
                    Comptabilité
                  </p>
                  {COMPTA.map(renderItem)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className={expanded ? 'mt-5' : 'mt-2'}>
        {expanded && (
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint/70">
            Modules
          </p>
        )}
        {SOON.map((item) => (
          <div
            key={item.label}
            aria-label={`${item.label} — Module à venir`}
            className={`group relative flex min-h-10 items-center rounded-md text-sm text-faint/50 ${
              expanded ? 'gap-2.5 px-3 py-2' : 'justify-center px-2 py-2.5'
            }`}
          >
            <Icon name={item.icon} size={18} className="shrink-0 text-faint/40" />
            <span className={expanded ? 'whitespace-nowrap font-medium' : 'sr-only'}>
              {item.label}
            </span>
            {expanded && (
              <span className="ml-auto rounded-full bg-rail-2 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-faint/70">
                bientôt
              </span>
            )}
            {!expanded && <Tooltip label={item.label} />}
          </div>
        ))}
      </div>
    </nav>
  );
}
