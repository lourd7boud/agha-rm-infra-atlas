'use client';

import { useEffect, useRef, useState } from 'react';
import { ArmiLogo } from '@/components/brand/ArmiLogo';
import { ArmiMark } from '@/components/brand/ArmiMark';
import { RailNav } from '@/components/nav/RailNav';
import { Icon } from '@/components/ui/Icon';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { UserMenu } from './UserMenu';

const COMPLIANCE = [
  { icon: 'vault', label: 'Sécurité & Conformité', sub: 'CNDP · Loi 09-08' },
  { icon: 'activity', label: 'Haute disponibilité', sub: 'Système opérationnel' },
  { icon: 'check', label: 'Sauvegarde auto', sub: 'pg_dump quotidien' },
  { icon: 'documents', label: 'Audit trail', sub: 'Actions tracées' },
  { icon: 'tenders', label: 'Marchés publics', sub: 'Décret 2-22-431' },
] as const;

interface AppShellProps {
  children: React.ReactNode;
  name: string;
  role?: string;
  comptaVisible: boolean;
  salesVisible: boolean;
  logoutAction: () => Promise<void>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell({
  children,
  name,
  role,
  comptaVisible,
  salesVisible,
  logoutAction,
}: AppShellProps) {
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopSidebarRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const userInitials = initials(name) || 'AT';

  const clearExpandTimer = () => {
    if (!expandTimerRef.current) return;
    clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
  };

  const scheduleDesktopExpansion = () => {
    clearExpandTimer();
    expandTimerRef.current = setTimeout(() => {
      setDesktopExpanded(true);
      expandTimerRef.current = null;
    }, 260);
  };

  const collapseDesktopSidebar = () => {
    clearExpandTimer();
    if (!desktopSidebarRef.current?.contains(document.activeElement)) {
      setDesktopExpanded(false);
    }
  };

  const closeMobileDrawer = () => {
    setMobileOpen(false);
    window.requestAnimationFrame(() => mobileTriggerRef.current?.focus());
  };

  useEffect(() => () => clearExpandTimer(), []);

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const closeAtDesktop = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setMobileOpen(false);
    };
    closeAtDesktop(desktopQuery);
    desktopQuery.addEventListener('change', closeAtDesktop);
    return () => desktopQuery.removeEventListener('change', closeAtDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="relative hidden w-[72px] shrink-0 lg:block" aria-hidden="true" />
      <aside
        ref={desktopSidebarRef}
        data-testid="desktop-sidebar"
        data-expanded={desktopExpanded}
        onMouseEnter={scheduleDesktopExpansion}
        onMouseLeave={collapseDesktopSidebar}
        onFocusCapture={() => {
          clearExpandTimer();
          setDesktopExpanded(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDesktopExpanded(false);
          }
        }}
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-rail transition-[width,box-shadow] duration-[250ms] ease-in-out lg:flex ${
          desktopExpanded ? 'w-[264px] shadow-raised' : 'w-[72px] shadow-rail'
        }`}
      >
        <div className="brand-seam h-0.5 w-full shrink-0" />
        <div
          className={`flex h-[94px] shrink-0 items-center overflow-hidden transition-[padding] duration-[250ms] ${
            desktopExpanded ? 'px-5' : 'justify-center px-2'
          }`}
        >
          {desktopExpanded ? (
            <div>
              <ArmiLogo variant="rail" />
              <p className="mt-2 pl-px whitespace-nowrap text-[10px] uppercase tracking-[0.2em] text-faint/70">
                Enterprise Operating System
              </p>
            </div>
          ) : (
            <ArmiMark size={36} />
          )}
        </div>
        <div
          className={`flex-1 px-3 pb-4 ${
            desktopExpanded ? 'overflow-y-auto overflow-x-hidden' : 'overflow-visible'
          }`}
        >
          <RailNav
            expanded={desktopExpanded}
            comptaVisible={comptaVisible}
            salesVisible={salesVisible}
          />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Fermer la navigation"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={closeMobileDrawer}
          />
          <aside
            ref={mobileDrawerRef}
            id="atlas-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation principale"
            className="relative flex h-full w-[min(88vw,320px)] flex-col border-r border-line bg-rail shadow-raised"
          >
            <div className="brand-seam h-0.5 w-full shrink-0" />
            <div className="flex items-center justify-between px-4 py-4">
              <ArmiLogo variant="rail" markSize={34} />
              <button
                ref={mobileCloseRef}
                type="button"
                aria-label="Fermer la navigation"
                onClick={closeMobileDrawer}
                className="rounded-lg p-2 text-muted transition hover:bg-rail-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-5">
              <RailNav
                expanded
                comptaVisible={comptaVisible}
                salesVisible={salesVisible}
                onNavigate={closeMobileDrawer}
              />
            </div>
          </aside>
        </div>
      )}

      <div
        data-testid="app-content"
        inert={mobileOpen}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="sticky top-0 z-30 border-b border-line bg-rail lg:hidden">
          <div className="brand-seam h-0.5 w-full" />
          <div className="flex items-center gap-3 px-3 py-2.5">
            <button
              ref={mobileTriggerRef}
              type="button"
              aria-label="Ouvrir la navigation"
              aria-expanded={mobileOpen}
              aria-controls="atlas-mobile-navigation"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-muted transition hover:bg-rail-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
            >
              <Icon name="menu" size={21} />
            </button>
            <ArmiLogo variant="rail" markSize={29} className="min-w-0 scale-[0.92] origin-left" />
            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <UserMenu
                name={name}
                role={role}
                initials={userInitials}
                logoutAction={logoutAction}
              />
            </div>
          </div>
        </header>

        <header className="sticky top-0 z-30 hidden items-center gap-4 border-b border-line bg-paper/80 px-8 py-3 backdrop-blur lg:flex">
          <form action="/tenders" method="get" role="search" className="relative w-full max-w-md">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              name="q"
              aria-label="Recherche globale"
              placeholder="Rechercher un marché, un chantier…"
              className="w-full rounded-md border border-line bg-paper-2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/20"
            />
          </form>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-soft/60 bg-emerald-soft/20 px-2.5 py-1 text-xs font-medium text-emerald xl:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Système opérationnel
            </span>
            <button
              type="button"
              className="relative rounded-md p-1 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
              aria-label="Notifications"
            >
              <Icon name="bell" size={20} />
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-cyan ring-2 ring-paper" />
            </button>
            <ThemeToggle />
            <div className="border-l border-line pl-3">
              <UserMenu
                name={name}
                role={role}
                initials={userInitials}
                logoutAction={logoutAction}
              />
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-7 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>

        <footer className="border-t border-line bg-rail/60 px-5 py-4 lg:px-8">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-3">
            {COMPLIANCE.map((item) => (
              <div key={item.label} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-cyan">
                  <Icon name={item.icon} size={14} />
                </span>
                <span className="leading-tight">
                  <span className="block text-[11px] font-semibold text-ink-2">
                    {item.label}
                  </span>
                  <span className="block text-[10px] text-faint">{item.sub}</span>
                </span>
              </div>
            ))}
            <span className="ml-auto text-xl" aria-label="Maroc" title="Maroc">
              🇲🇦
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
