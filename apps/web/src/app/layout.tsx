import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import { auth, signOut } from '@/auth';
import { AtlasLogo } from '@/components/brand/AtlasLogo';
import { RailNav } from '@/components/nav/RailNav';
import { Icon } from '@/components/ui/Icon';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ATLAS — AGHA RM INFRA',
  description: 'Enterprise Operating System — AGHA RM INFRA',
};

const COMPLIANCE = [
  { icon: 'vault', label: 'Sécurité & Conformité', sub: 'CNDP · Loi 09-08' },
  { icon: 'activity', label: 'Haute disponibilité', sub: 'Système opérationnel' },
  { icon: 'check', label: 'Sauvegarde auto', sub: 'pg_dump quotidien' },
  { icon: 'documents', label: 'Audit trail', sub: 'Actions tracées' },
  { icon: 'tenders', label: 'Marchés publics', sub: 'Décret 2-22-431' },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const fontVars = `${sans.variable} ${mono.variable}`;

  if (!session?.user) {
    return (
      <html lang="fr" className={fontVars}>
        <body className="min-h-screen antialiased">{children}</body>
      </html>
    );
  }

  const name = session.user.name ?? session.user.email ?? 'Utilisateur';
  const role = session.roles?.[0];
  // La section Comptabilité n'apparaît que pour les rôles habilités (données
  // sensibles) — mêmes rôles que la garde API COMPTA_ROLES côté core.
  const comptaVisible = (session.roles ?? []).some((r) =>
    ['direction', 'finance', 'admin-si', 'comptable'].includes(r),
  );

  const logoutButton = (extra: string) => (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/login' });
      }}
    >
      <button className={extra} aria-label="Déconnexion" title="Déconnexion">
        <Icon name="logout" size={16} />
        <span>Déconnexion</span>
      </button>
    </form>
  );

  return (
    <html lang="fr" className={fontVars}>
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col lg:flex-row">
          {/* Command rail */}
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-rail lg:flex">
            <div className="brand-seam h-0.5 w-full" />
            <div className="px-5 py-6">
              <AtlasLogo variant="rail" />
              <p className="mt-2 pl-px text-[10px] uppercase tracking-[0.2em] text-faint/70">
                Enterprise Operating System
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <RailNav comptaVisible={comptaVisible} />
            </div>
            <div className="mx-3 mb-3 rounded-lg border border-cyan-soft/60 bg-cyan-soft/20 p-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" />
                </span>
                <span className="text-xs font-semibold text-ink">ATLAS AI</span>
                <span className="ml-auto text-[10px] font-medium text-cyan">En ligne</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted">
                12 agents opérationnels · veille &amp; analyse en continu.
              </p>
            </div>
            <div className="border-t border-line px-3 pb-5 pt-4">
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-soft font-semibold text-cyan">
                  {initials(name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{name}</div>
                  {role && (
                    <div className="truncate text-xs capitalize text-faint">{role}</div>
                  )}
                </div>
              </div>
              {logoutButton(
                'mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-rail-2 hover:text-ink',
              )}
            </div>
          </aside>

          {/* Mobile brand bar */}
          <header className="border-b border-line bg-rail lg:hidden">
            <div className="brand-seam h-0.5 w-full" />
            <div className="flex items-center justify-between px-4 py-3">
              <AtlasLogo variant="rail" markSize={30} />
              {logoutButton(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-rail-2 hover:text-ink',
              )}
            </div>
            <div className="px-2 pb-2">
              <RailNav orientation="horizontal" comptaVisible={comptaVisible} />
            </div>
          </header>

          {/* Content column */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top command bar */}
            <header className="sticky top-0 z-20 hidden items-center gap-4 border-b border-line bg-paper/80 px-8 py-3 backdrop-blur lg:flex">
              <form
                action="/tenders"
                method="get"
                role="search"
                className="relative w-full max-w-md"
              >
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
                  className="relative text-muted transition hover:text-ink"
                  aria-label="Notifications"
                >
                  <Icon name="bell" size={20} />
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-cyan ring-2 ring-paper" />
                </button>
                <div className="flex items-center gap-2.5 border-l border-line pl-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-soft text-xs font-semibold text-cyan">
                    {initials(name)}
                  </div>
                  <div className="leading-tight">
                    <div className="text-sm font-medium text-ink">{name}</div>
                    {role && (
                      <div className="text-[11px] capitalize text-faint">{role}</div>
                    )}
                  </div>
                </div>
              </div>
            </header>

            <main className="flex-1 px-5 py-7 lg:px-8 lg:py-8">
              <div className="mx-auto w-full max-w-[1500px]">{children}</div>
            </main>

            {/* Compliance footer */}
            <footer className="border-t border-line bg-rail/60 px-8 py-4">
              <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-3">
                {COMPLIANCE.map((c) => (
                  <div key={c.label} className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-cyan">
                      <Icon name={c.icon} size={14} />
                    </span>
                    <div className="leading-tight">
                      <div className="text-[11px] font-semibold text-ink-2">
                        {c.label}
                      </div>
                      <div className="text-[10px] text-faint">{c.sub}</div>
                    </div>
                  </div>
                ))}
                <span className="ml-auto text-xl" aria-label="Maroc" title="Maroc">
                  🇲🇦
                </span>
              </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
