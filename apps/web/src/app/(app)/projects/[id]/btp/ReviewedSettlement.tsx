'use client';
import { useState } from 'react';
import type { TerrainJourneePayload } from '@atlas/contracts';
import type { TerrainCrewMember } from '@/lib/btp-shared';
import type { DailySettlement } from './daily-actions';
const input =
  'mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

export function ReviewedSettlement({
  payload,
  crew,
  bpu,
  disabled,
  onSubmit,
}: {
  payload: TerrainJourneePayload;
  crew: TerrainCrewMember[];
  bpu: { id: string; label: string; unite: string }[];
  disabled: boolean;
  onSubmit: (mapping: DailySettlement) => void;
}) {
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [production, setProduction] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const attendanceRows = payload.attendance.filter((a) => !a.assignmentId);
  const productionRows = payload.production.filter((p) => !p.bpuLigneId);
  if (!attendanceRows.length && !productionRows.length) return null;
  const mapping: DailySettlement = {
    attendanceMapping: Object.entries(attendance)
      .filter(([, id]) => id)
      .map(([lineId, assignmentId]) => ({ lineId, assignmentId })),
    productionMapping: Object.entries(production)
      .filter(([, id]) => id)
      .map(([lineId, bpuLigneId]) => ({ lineId, bpuLigneId })),
    reason,
  };
  return (
    <section className="rounded-xl border border-cyan bg-paper-2 p-5">
      <h3 className="text-lg font-bold">Rattachements à compléter · bureau</h3>
      <p className="mt-2 text-sm text-muted">
        Associez les personnes temporaires et les travaux hors BPU aux
        références du chantier. Les quantités restent identiques ; seuls les
        journaux manquants sont créés. La décision est tracée.
      </p>
      <fieldset disabled={disabled} className="mt-4 space-y-4">
        {attendanceRows.map((a) => (
          <label key={a.id} className="block text-sm font-semibold">
            {a.temporaryName} · {a.daysWorked} journée(s)
            <select
              className={input}
              value={attendance[a.id] ?? ''}
              onChange={(e) =>
                setAttendance({ ...attendance, [a.id]: e.target.value })
              }
            >
              <option value="">Laisser à rattacher</option>
              {crew.map((c) => (
                <option key={c.assignmentId} value={c.assignmentId}>
                  {c.fullName} · {c.metier}
                </option>
              ))}
            </select>
          </label>
        ))}
        {productionRows.map((p) => (
          <label key={p.id} className="block text-sm font-semibold">
            {p.designation} · {p.quantite} {p.unite}
            <select
              className={input}
              value={production[p.id] ?? ''}
              onChange={(e) =>
                setProduction({ ...production, [p.id]: e.target.value })
              }
            >
              <option value="">Laisser hors BPU</option>
              {bpu
                .filter(
                  (b) =>
                    b.unite.trim().toLowerCase() ===
                    p.unite.trim().toLowerCase(),
                )
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} ({b.unite})
                  </option>
                ))}
            </select>
          </label>
        ))}
        <label className="block text-sm font-semibold">
          Motif du rattachement *
          <input
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={
            disabled ||
            !reason.trim() ||
            !(
              mapping.attendanceMapping.length ||
              mapping.productionMapping.length
            )
          }
          className="min-h-11 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50"
          onClick={() => onSubmit(mapping)}
        >
          Confirmer les rattachements sélectionnés
        </button>
      </fieldset>
    </section>
  );
}
