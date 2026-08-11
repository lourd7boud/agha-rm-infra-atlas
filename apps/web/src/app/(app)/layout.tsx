import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { logoutFromAtlas } from '@/app/actions/auth';
import { AppShell } from '@/components/layout/AppShell';
import { AuthSessionBoundary } from '@/components/layout/AuthSessionBoundary';
import { isUsableSession } from '@/lib/auth-session';

export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!isUsableSession(session)) redirect('/login');

  const roles = session.roles ?? [];
  const comptaVisible = roles.some((role) =>
    ['direction', 'finance', 'admin-si', 'comptable'].includes(role),
  );
  // Match the Sales controllers' role gate so navigation never advertises
  // routes that will return 403 for accounting-only users.
  const salesVisible = roles.some((role) =>
    ['direction', 'finance', 'marches', 'travaux', 'admin-si'].includes(role),
  );
  const name = session.user?.name ?? session.user?.email ?? 'Utilisateur';

  return (
    <AuthSessionBoundary>
      <AppShell
        name={name}
        role={roles.find((role) => role === 'marches') ?? roles[0]}
        comptaVisible={comptaVisible}
        salesVisible={salesVisible}
        logoutAction={logoutFromAtlas}
      >
        {children}
      </AppShell>
    </AuthSessionBoundary>
  );
}
