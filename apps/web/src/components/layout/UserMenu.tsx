'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

interface UserMenuProps {
  name: string;
  role?: string;
  initials: string;
  logoutAction: () => Promise<void>;
}

export function UserMenu({ name, role, initials, logoutAction }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => logoutRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Menu utilisateur — ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-rail-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-soft text-xs font-semibold text-cyan">
          {initials}
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="block max-w-44 truncate text-sm font-medium text-ink">{name}</span>
          {role && (
            <span className="block max-w-44 truncate text-[11px] capitalize text-faint">
              {role}
            </span>
          )}
        </span>
        <Icon
          name="chevronDown"
          size={13}
          className={`hidden text-faint transition-transform duration-200 sm:block ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Menu utilisateur"
          className="absolute right-0 top-[calc(100%+0.55rem)] z-[70] w-64 overflow-hidden rounded-xl border border-line bg-rail shadow-raised"
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-soft text-sm font-semibold text-cyan">
              {initials}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-ink">{name}</span>
              <span className="mt-0.5 block truncate text-xs capitalize text-faint">
                {role ?? 'Profil utilisateur'}
              </span>
            </span>
          </div>
          <div className="border-t border-line p-1.5">
            <form action={logoutAction}>
              <button
                ref={logoutRef}
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted transition hover:bg-rail-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
              >
                <Icon name="logout" size={16} />
                <span>Déconnexion</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
