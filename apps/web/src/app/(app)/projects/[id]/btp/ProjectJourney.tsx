import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { BtpProjectDetail, Decompte, Periode, RevisionView } from '@/lib/btp-shared';

type NextAction = { step: number; label: string; detail: string; href: string };

export async function ProjectJourney({ project }: { project: BtpProjectDetail }) {
  const base = `/projects/${project.id}`;
  const tab = (name: string) => `${base}?section=admin&tab=${name}`;
  const hasStart = !!(project.executionStartDate || project.ordreServiceDate);
  const hasDelay = !!project.delaiMois;
  let periods: Periode[] = [];
  let decomptes: Decompte[] = [];
  let revision: RevisionView | null = null;

  // The journey is guidance: a failed summary read must not block the working tabs.
  try {
    [periods, decomptes] = await Promise.all([
      project.counts.periodes ? apiGet<Periode[]>(`/btp/projects/${project.id}/periodes`) : Promise.resolve([]),
      project.counts.decomptes ? apiGet<Decompte[]>(`/btp/projects/${project.id}/decomptes`) : Promise.resolve([]),
    ]);
    if (decomptes.some((row) => row.isDernier && !['validated', 'paid'].includes(row.statut))) {
      revision = await apiGet<RevisionView>(`/btp/projects/${project.id}/revision`);
    }
  } catch {
    return <aside className="mt-5 rounded-xl border border-line bg-paper-2 px-5 py-4 text-sm text-muted">
      Le parcours est momentanément indisponible. Les onglets du marché restent accessibles ci-dessous.
    </aside>;
  }

  periods.sort((a, b) => a.numero - b.numero);
  decomptes.sort((a, b) => a.numero - b.numero);
  const pending = decomptes.find((row) => !['validated', 'paid'].includes(row.statut))
    ?? decomptes.find((row) => row.statut === 'validated');
  const unfinished = periods.find((period) => {
    const document = decomptes.find((row) => row.periodeId === period.id);
    return !['validated', 'paid'].includes(document?.statut ?? '') &&
      (!period.dateFin || period.metresCount === 0 || !document);
  });
  const latest = decomptes.at(-1);
  const pendingRevision = pending && revision?.config?.isEnabled &&
    revision.table.find((row) => row.decompteId === pending.id)?.trace?.status === 'pending';
  let next: NextAction;

  if (!hasDelay) {
    next = { step: 0, label: !hasStart ? 'Renseigner l’OS et le délai' : 'Renseigner le délai contractuel',
      detail: 'Complétez la fiche marché : ces informations alimentent les dates des métrés et le suivi du délai.', href: tab('apercu') };
  } else if (!hasStart) {
    next = { step: 0, label: 'Vérifier l’ordre de démarrage',
      detail: 'La date d’effet de l’ordre notifié ouvre le calendrier des métrés et des décomptes.', href: tab('ods') };
  } else if (!project.counts.bordereauLignes) {
    next = { step: 1, label: 'Compléter le bordereau', detail: 'Les articles et prix saisis ici seront repris dans les métrés et décomptes.', href: tab('bordereau') };
  } else if (!periods.length) {
    next = { step: 2, label: 'Créer le premier métré', detail: 'Choisissez la date d’arrêté, puis saisissez les mesures. Le décompte sera généré automatiquement.', href: tab('metres') };
  } else if (unfinished && (!pending || unfinished.numero <= pending.numero)) {
    next = { step: 2, label: `Compléter le métré n°${unfinished.numero}`, detail: !unfinished.dateFin ? 'Renseignez la date d’arrêté dans les paramètres du métré.' : 'Enregistrez les mesures pour alimenter le décompte associé.', href: `${base}/metres/${unfinished.id}` };
  } else if (pending?.isDernier && pendingRevision && pending.dateDecompte) {
    next = { step: 3, label: 'Compléter la révision du dernier décompte', detail: 'Vérifiez les éléments en attente avant de valider le dernier décompte.', href: tab('revision') };
  } else if (pending) {
    next = { step: pending.statut === 'draft' ? 3 : 4,
      label: pending.statut === 'validated' ? `Enregistrer le paiement du décompte n°${pending.numero}`
        : pending.statut === 'submitted' ? `Vérifier et valider le décompte n°${pending.numero}`
          : `Vérifier et soumettre le décompte n°${pending.numero}`,
      detail: pending.statut === 'validated' ? 'Le métré est verrouillé. Marquez le décompte payé lorsque le règlement est confirmé.'
        : 'Vérifiez les montants repris du métré, puis poursuivez le circuit du décompte.',
      href: `${base}/decomptes/${pending.id}` };
  } else if (latest?.isDernier) {
    next = { step: 4, label: 'Exporter le dossier', detail: 'Le dernier décompte est payé. Les pièces reprennent les données enregistrées.', href: tab('export') };
  } else {
    next = { step: 2, label: 'Créer le prochain métré', detail: 'Les décomptes existants sont payés. Poursuivez avec la prochaine date d’arrêté des travaux.', href: tab('metres') };
  }

  const stages = [
    { label: 'Fiche & OS', state: hasStart && hasDelay ? 'Renseignés' : 'À compléter' },
    { label: 'Bordereau', state: `${project.counts.bordereauLignes} prix` },
    { label: 'Métré', state: `${periods.length} période(s)` },
    { label: 'Décompte & révision', state: `${decomptes.length} décompte(s)` },
    { label: 'Validation & paiement', state: `${decomptes.filter((row) => row.statut === 'paid').length} payé(s)` },
  ];

  return (
    <section aria-label="Parcours du marché" className="mt-5 rounded-xl border border-line bg-paper-2 p-4 sm:p-5">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stages.map((stage, index) => (
          <li key={stage.label} aria-current={index === next.step ? 'step' : undefined} className={`flex items-start gap-2 text-xs ${index === next.step ? 'text-cyan' : 'text-muted'}`}>
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full font-bold ${index === next.step ? 'bg-cyan text-paper' : 'bg-sand'}`}>{index + 1}</span>
            <span><strong className="block font-semibold">{stage.label}</strong><span className="mt-1 block text-[11px] text-muted">{stage.state}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="max-w-2xl"><p className="text-xs font-semibold text-ink-2">Prochaine action</p><p className="mt-1 text-xs leading-relaxed text-muted">{next.detail}</p></div>
        <Link href={next.href} className="rounded-lg bg-cyan px-4 py-2.5 text-xs font-bold text-paper transition hover:opacity-90">{next.label} →</Link>
      </div>
    </section>
  );
}
