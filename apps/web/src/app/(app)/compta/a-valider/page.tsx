import { auth } from '@/auth';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { Ecriture, SalesAccountingEvent } from '@/lib/compta';
import { AnneePicker, ComptaHeader } from '../ui';
import { ValidationQueue } from './ValidationQueue';

export const metadata = { title: 'À valider — Comptabilité ATLAS' };

export default async function AValiderPage({ searchParams }: {
  searchParams: Promise<{ annee?: string; page?: string }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const page = Math.max(1, Number(params.page) || 1);
  const [session, drafts, events] = await Promise.all([
    auth(),
    apiGet<{ items: Ecriture[]; total: number }>(`/compta/ecritures?annee=${annee}&statut=brouillon&limit=100&page=${page}`),
    apiGet<SalesAccountingEvent[]>(`/compta/reconciliation/ventes?annee=${annee}`),
  ]);
  const canApprove = session?.roles?.some((role) => ['direction', 'comptable'].includes(role)) ?? false;
  return (
    <div>
      <ComptaHeader title="À valider" subtitle="Relisez les brouillons, choisissez les écritures puis confirmez la sélection."
        actions={<AnneePicker annee={annee} path="/compta/a-valider" />} />
      <ValidationQueue key={annee} entries={drafts.items} events={events} canApprove={canApprove} />
      <nav className="mt-5 flex gap-5 text-sm">
        {page > 1 && <Link href={`?annee=${annee}&page=${page - 1}`}>Page précédente</Link>}
        {page * 100 < drafts.total && <Link href={`?annee=${annee}&page=${page + 1}`}>Page suivante</Link>}
      </nav>
    </div>
  );
}
