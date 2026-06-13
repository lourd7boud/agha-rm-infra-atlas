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
  { href: '/', label: 'Tableau de bord', icon: 'dashboard' },
  { href: '/tenders', label: 'Marchés', icon: 'tenders' },
  { href: '/projects', label: 'Chantiers', icon: 'chantiers' },
  { href: '/people', label: 'Personnel', icon: 'personnel' },
  { href: '/finance', label: 'Trésorerie', icon: 'tresorerie' },
  { href: '/vault', label: 'Coffre-fort', icon: 'vault' },
  { href: '/intel', label: 'Concurrence', icon: 'intel' },
];

function isActive(path: string, href: string): boolean {
  return href === '/' ? path === '/' : path.startsWith(href);
}

interface RailNavProps {
  orientation?: 'vertical' | 'horizontal';
}

export function RailNav({ orientation = 'vertical' }: RailNavProps) {
  const path = usePathname();
  const horizontal = orientation === 'horizontal';
  return (
    <nav
      className={
        horizontal
          ? 'flex flex-row gap-1 overflow-x-auto pb-1'
          : 'flex flex-col gap-0.5'
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
                ? 'bg-rail-2 text-paper'
                : 'text-paper/55 hover:bg-rail-2/60 hover:text-paper'
            }`}
          >
            {!horizontal && (
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-ochre transition-all ${
                  active ? 'h-5 w-[3px]' : 'h-0 w-0'
                }`}
              />
            )}
            <Icon
              name={item.icon}
              size={18}
              className={
                active ? 'text-ochre' : 'text-paper/45 group-hover:text-paper/75'
              }
            />
            <span className="whitespace-nowrap font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
