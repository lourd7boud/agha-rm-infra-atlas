import Link from 'next/link';
import {
  fmtDate,
  EQUIPMENT_STATUS_BADGES,
  type ProjectEquipmentRecord,
} from '@/lib/equipment';

/** Matériel affecté — machines currently posted to this chantier. */
export function EquipmentSection({
  projectEquipment,
}: {
  projectEquipment: ProjectEquipmentRecord[];
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Matériel affecté ({projectEquipment.length})
        </h2>
        <Link href="/equipment" className="text-xs text-muted hover:text-ink">
          Gérer le parc →
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Désignation</th>
            <th className="px-4 py-3">Catégorie</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3">Affecté le</th>
            <th className="px-4 py-3">Retour prévu</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {projectEquipment.map((item) => {
            const eBadge = EQUIPMENT_STATUS_BADGES[item.status];
            const open = item.openAssignment;
            return (
              <tr key={item.id}>
                <td className="px-4 py-3 font-mono text-xs">
                  {item.code ?? '—'}
                </td>
                <td className="px-4 py-3 font-semibold">{item.name}</td>
                <td className="px-4 py-3 text-muted">
                  {item.category ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${eBadge.classes}`}
                  >
                    {eBadge.label}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                  {fmtDate(open.assignedAt)}
                </td>
                <td
                  className={`px-4 py-3 font-mono text-xs tabular-nums ${
                    open.expectedReturnAt ? 'text-muted' : 'text-faint'
                  }`}
                >
                  {fmtDate(open.expectedReturnAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {projectEquipment.length === 0 && (
        <p className="p-8 text-center text-sm text-faint">
          Aucun matériel affecté — postez un engin depuis le parc.
        </p>
      )}
    </section>
  );
}
