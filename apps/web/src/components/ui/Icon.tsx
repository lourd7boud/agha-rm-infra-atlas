import type { ReactNode } from 'react';

export type IconName =
  | 'dashboard'
  | 'tenders'
  | 'chantiers'
  | 'personnel'
  | 'tresorerie'
  | 'vault'
  | 'intel'
  | 'search'
  | 'filter'
  | 'chevronRight'
  | 'logout'
  | 'alert'
  | 'check'
  | 'activity'
  | 'pin';

/** Hand-drawn ATLAS icon set — 24px grid, 1.6 stroke, rounded, currentColor. */
const PATHS: Record<IconName, ReactNode> = {
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
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="11" cy="12" r="3.4" />
      <path d="M11 12l2.4-2.4" />
      <path d="M18 8.5v7" />
    </>
  ),
  intel: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8.2V20l-4 1.5v-9.3z" />,
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
