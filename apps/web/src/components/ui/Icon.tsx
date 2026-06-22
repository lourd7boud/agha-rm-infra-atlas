import type { ReactNode } from 'react';

export type IconName =
  | 'command'
  | 'dashboard'
  | 'tenders'
  | 'chantiers'
  | 'boxes'
  | 'equipment'
  | 'terrain'
  | 'personnel'
  | 'tresorerie'
  | 'supply'
  | 'documents'
  | 'vault'
  | 'crm'
  | 'quote'
  | 'invoice'
  | 'delivery'
  | 'analytics'
  | 'agents'
  | 'intel'
  | 'settings'
  | 'search'
  | 'filter'
  | 'bell'
  | 'chevronRight'
  | 'logout'
  | 'alert'
  | 'check'
  | 'activity'
  | 'pin'
  | 'download'
  | 'external'
  | 'close';

/** Hand-drawn ATLAS icon set — 24px grid, 1.6 stroke, rounded, currentColor. */
const PATHS: Record<IconName, ReactNode> = {
  command: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M12 8l1.6 2.4L16 12l-2.4 1.6L12 16l-1.6-2.4L8 12l2.4-1.6z" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.4" />
      <rect x="14" y="3" width="7" height="5" rx="1.4" />
      <rect x="14" y="11" width="7" height="10" rx="1.4" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" />
    </>
  ),
  tenders: (
    <>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
      <path d="M8.5 14.5l2.2 2.2 4.3-4.3" />
    </>
  ),
  chantiers: (
    <>
      <path d="M3 21h18" />
      <path d="M6 21V9l6-4 6 4v12" />
      <path d="M10 21v-4.5h4V21" />
      <path d="M12 5V3" />
    </>
  ),
  boxes: (
    <>
      <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
      <path d="M7.75 5.25l8.5 4.5" />
    </>
  ),
  equipment: (
    <>
      <path d="M3 20h18" />
      <path d="M5 20v-5h5v5" />
      <path d="M10 15l2-7 7 2" />
      <path d="M12 8l1-2 6 1.5" />
      <path d="M19 10l1.5 4" />
    </>
  ),
  terrain: (
    <>
      <path d="M3 20h18" />
      <path d="M9 20l3-13 3 13" />
      <path d="M8.5 13.5h7M7.5 16.5h9" />
    </>
  ),
  personnel: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3.1 2.5-5.3 5.5-5.3s5.5 2.2 5.5 5.3" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17.2 15c2.1.5 3.6 2.4 3.6 5" />
    </>
  ),
  tresorerie: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 9.5h.01M18 14.5h.01" />
    </>
  ),
  supply: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.4 7.5L12 12.5l8.6-5M12 12.5V22" />
    </>
  ),
  documents: (
    <>
      <path d="M9 3h6l4 4v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v4h4" />
      <path d="M5 7v12a2 2 0 0 0 2 2h9" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="11" cy="12" r="3.4" />
      <path d="M11 12l2.4-2.4" />
      <path d="M18 8.5v7" />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10.5" r="2.4" />
      <path d="M3.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15 20c.2-2.1 1.5-3.6 4-3.6" />
    </>
  ),
  quote: (
    <>
      <path d="M8 3h8l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" />
    </>
  ),
  invoice: (
    <>
      <path d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
    </>
  ),
  delivery: (
    <>
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h4l3 3v2h-7z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17.5" cy="17.5" r="1.6" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l3.5-4 3 3L21 7" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="7" width="14" height="11" rx="2.5" />
      <path d="M9 7V4M15 7V4M5 12H3M5 15H3M21 12h-2M21 15h-2" />
      <circle cx="9.5" cy="12.5" r="1" />
      <circle cx="14.5" cy="12.5" r="1" />
    </>
  ),
  intel: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4 6.5l2 1.2M18 16.3l2 1.2M20 6.5l-2 1.2M6 16.3l-2 1.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8.2V20l-4 1.5v-9.3z" />,
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.8 5.6 2 6H4c.2-.4 2-1.5 2-6z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  chevronRight: <path d="M9 5.5l6.5 6.5L9 18.5" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.2l9.2 16.3H2.8z" />
      <path d="M12 9.5v4.2M12 17h.01" />
    </>
  ),
  check: <path d="M5 13l4 4 10-10" />,
  activity: <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />,
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
