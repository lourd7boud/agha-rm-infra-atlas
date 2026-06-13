import type { Metadata } from 'next';
import { Fraunces, Inter, IBM_Plex_Mono } from 'next/font/google';
import { auth, signOut } from '@/auth';
import { AtlasLogo } from '@/components/brand/AtlasLogo';
import { RailNav } from '@/components/nav/RailNav';
import { Icon } from '@/components/ui/Icon';
import { TopoBackground } from '@/components/ui/TopoBackground';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ATLAS — AGHA RM INFRA',
  description: "Système d'exploitation d'entreprise — AGHA RM INFRA",
};

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
  const fontVars = `${display.variable} ${sans.variable} ${mono.variable}`;

  // Unauthenticated (e.g. the sign-in screen): render full-bleed, no shell.
  if (!session?.user) {
    return (
      <html lang="fr" className={fontVars}>
        <body className="min-h-screen bg-paper text-ink antialiased">
          {children}
        </body>
      </html>
    );
  }

  const name = session.user.name ?? session.user.email ?? 'Utilisateur';
  const role = session.roles?.[0];

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
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="flex min-h-screen flex-col lg:flex-row">
          {/* Brand rail — vertical on desktop */}
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-rail text-paper shadow-rail lg:flex">
            <div className="brand-seam h-1 w-full" />
            <div className="px-5 py-6">
              <AtlasLogo variant="rail" />
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <RailNav />
            </div>
            <div className="border-t border-paper/10 px-3 pb-5 pt-4">
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ochre/20 font-display text-sm font-semibold text-ochre">
                  {initials(name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-paper">
                    {name}
                  </div>
                  {role && (
                    <div className="truncate text-xs capitalize text-paper/45">
                      {role}
                    </div>
                  )}
                </div>
              </div>
              {logoutButton(
                'mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-paper/55 transition hover:bg-rail-2 hover:text-paper',
              )}
            </div>
          </aside>

          {/* Brand bar — mobile */}
          <header className="bg-rail text-paper lg:hidden">
            <div className="brand-seam h-1 w-full" />
            <div className="flex items-center justify-between px-4 py-3">
              <AtlasLogo variant="rail" markSize={30} />
              {logoutButton(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-paper/60 transition hover:bg-rail-2 hover:text-paper',
              )}
            </div>
            <div className="px-2 pb-2">
              <RailNav orientation="horizontal" />
            </div>
          </header>

          {/* Content canvas */}
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative flex-1 px-5 py-8 lg:px-12 lg:py-12">
              <TopoBackground />
              <div className="relative mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
