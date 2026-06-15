'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../ui/Icon';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Command Center', icon: 'command' },
  { href: '/tenders', label: 'Marchés Publics', icon: 'tenders' },
  { href: '/projects', label: 'Projets & Chantiers', icon: 'chantiers' },
  { href: '/finance', label: 'Finance', icon: 'tresorerie' },
  { href: '/people', label: 'Personnel', icon: 'personnel' },
  { href: '/vault', label: 'Documents & GED', icon: 'documents' },
  { href: '/intel', label: 'Concurrence', icon: 'intel' },
  { href: '/agents', label: 'Salle des Agents', icon: 'agents' },
];

/** Planned modules — shown for breadth, not yet routed. */
const SOON: readonly { label: string; icon: IconName }[] = [
  { label: 'Opérations Terrain', icon: 'terrain' },
  { label: 'Approvisionnements', icon: 'supply' },
  { label: 'BI & Analytics', icon: 'analytics' },
  { label: 'Paramètres Système', icon: 'settings' },
];

function isActive(path: string, href: string): boolean {
  return href === '/' ? path === '/' : path.startsWith(href);
}

export function RailNav({
  orientation = 'vertical',
}: {
  orientation?: 'vertical' | 'horizontal';
}) {
  const path = usePathname();
  const horizontal = orientation === 'horizontal';

  return (
    <nav
      className={
        horizontal ? 'flex flex-row gap-1 overflow-x-auto pb-1' : 'flex flex-col gap-0.5'
      }
    >
      {ITEMS.map((item) => {
        const active = isActive(path, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-2.5 rounded-md text-sm transition ${
              horizontal ? 'shrink-0 px-3 py-1.5' : 'px-3 py-2'
            } ${
              active
                ? 'bg-cyan-soft/60 text-ink'
                : 'text-muted hover:bg-rail-2 hover:text-ink'
            }`}
          >
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
          </Link>
        );
      })}

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
