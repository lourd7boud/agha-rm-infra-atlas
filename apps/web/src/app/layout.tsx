import type { Metadata } from 'next';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATLAS — AGHA RM INFRA',
  description: "Système d'exploitation d'entreprise — AGHA RM INFRA",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="fr">
      <body className="min-h-screen bg-stone-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-baseline gap-10">
              <Link href="/tenders" className="text-xl font-black tracking-tight">
                ATLAS<span className="text-amber-600">.</span>
                <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  AGHA RM INFRA
                </span>
              </Link>
              <nav className="flex gap-6 text-sm font-medium text-slate-600">
                <Link href="/tenders" className="hover:text-slate-900">
                  Mur des échéances
                </Link>
                <Link href="/projects" className="hover:text-slate-900">
                  Chantiers
                </Link>
                <Link href="/finance" className="hover:text-slate-900">
                  Trésorerie
                </Link>
                <Link href="/vault" className="hover:text-slate-900">
                  Coffre-fort
                </Link>
                <Link href="/intel" className="hover:text-slate-900">
                  Concurrence
                </Link>
              </nav>
            </div>
            {session?.user && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-500">
                  {session.user.name ?? session.user.email}
                </span>
                <form
                  action={async () => {
                    'use server';
                    await signOut();
                  }}
                >
                  <button className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 transition hover:bg-slate-100">
                    Déconnexion
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
