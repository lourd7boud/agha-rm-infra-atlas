'use client';

import { useState } from 'react';
import {
  fmtMad,
  type Bordereau,
  type BordereauLigne,
  type Decompte,
  type Periode,
} from '@/lib/projects';

const CARD = 'mb-8 rounded-xl border border-line bg-paper-2 p-6 shadow-sm';
const SUMMARY =
  'cursor-pointer select-none text-xs font-semibold uppercase tracking-widest text-faint';
const INPUT =
  'w-full rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan';
const BTN =
  'rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan disabled:opacity-50';
const TH = 'py-2 pr-3 text-left text-xs uppercase tracking-wider text-faint';

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

// ── Bordereau (BPU) editor ────────────────────────────────────────────────────
export function BordereauEditor({
  bordereaux,
  saveBordereau,
}: {
  bordereaux: Bordereau[];
  saveBordereau: (lignes: BordereauLigne[]) => Promise<void>;
}) {
  const initial: BordereauLigne[] = (bordereaux[0]?.lignes ?? []).map((l) => ({
    prixNo: l.prixNo,
    designation: l.designation,
    unite: l.unite,
    quantite: l.quantite,
    prixUnitaire: l.prixUnitaire,
  }));
  const [rows, setRows] = useState<BordereauLigne[]>(initial);
  const [saving, setSaving] = useState(false);

  const set = (i: number, key: keyof BordereauLigne, val: string) =>
    setRows((rs) =>
      rs.map((r, idx) =>
        idx === i
          ? {
              ...r,
              [key]:
                key === 'quantite' || key === 'prixUnitaire' ? n(val) : val,
            }
          : r,
      ),
    );
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { prixNo: rs.length + 1, designation: '', unite: '', quantite: 0, prixUnitaire: 0 },
    ]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const total = rows.reduce((s, r) => s + n(r.quantite) * n(r.prixUnitaire), 0);

  const onSave = async () => {
    setSaving(true);
    try {
      const clean = rows.map((r) => ({
        ...r,
        montant: n(r.quantite) * n(r.prixUnitaire),
      }));
      await saveBordereau(clean);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className={CARD}>
      <summary className={SUMMARY}>Éditer le bordereau des prix (BPU)</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={`${TH} w-16`}>N°</th>
              <th className={TH}>Désignation</th>
              <th className={`${TH} w-20`}>Unité</th>
              <th className={`${TH} w-28`}>Quantité</th>
              <th className={`${TH} w-32`}>P.U. HT</th>
              <th className={`${TH} w-32 text-right`}>Montant</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/50">
                <td className="py-1 pr-2">
                  <input
                    className={INPUT}
                    value={String(r.prixNo ?? i + 1)}
                    onChange={(e) => set(i, 'prixNo', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className={INPUT}
                    value={r.designation ?? ''}
                    onChange={(e) => set(i, 'designation', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className={INPUT}
                    value={r.unite ?? ''}
                    onChange={(e) => set(i, 'unite', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step="any"
                    className={`${INPUT} text-right`}
                    value={r.quantite ?? 0}
                    onChange={(e) => set(i, 'quantite', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step="any"
                    className={`${INPUT} text-right`}
                    value={r.prixUnitaire ?? 0}
                    onChange={(e) => set(i, 'prixUnitaire', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink-2">
                  {fmtMad(n(r.quantite) * n(r.prixUnitaire))}
                </td>
                <td className="py-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-clay hover:text-clay/70"
                    aria-label="Supprimer la ligne"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={addRow} className="text-sm text-cyan hover:underline">
          + Ajouter une ligne
        </button>
        <span className="font-mono text-sm tabular-nums text-ink-2">
          Total HT : {fmtMad(total)}
        </span>
      </div>
      <div className="mt-4">
        <button type="button" onClick={onSave} disabled={saving} className={BTN}>
          {saving ? 'Enregistrement…' : 'Enregistrer le bordereau'}
        </button>
      </div>
    </details>
  );
}

// ── Période creator ───────────────────────────────────────────────────────────
export interface PeriodeInput {
  numero: number;
  libelle?: string;
  dateDebut?: string;
  dateFin?: string;
  tauxTva: number;
  tauxRetenue: number;
  decomptesPrecedents: number;
  depensesExercicesAnterieurs: number;
  isDecompteDernier: boolean;
}

export function PeriodeCreator({
  nextNumero,
  createPeriode,
}: {
  nextNumero: number;
  createPeriode: (input: PeriodeInput) => Promise<void>;
}) {
  const [f, setF] = useState<PeriodeInput>({
    numero: nextNumero,
    libelle: '',
    dateDebut: '',
    dateFin: '',
    tauxTva: 20,
    tauxRetenue: 10,
    decomptesPrecedents: 0,
    depensesExercicesAnterieurs: 0,
    isDecompteDernier: false,
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createPeriode({
        ...f,
        libelle: f.libelle || undefined,
        dateDebut: f.dateDebut || undefined,
        dateFin: f.dateFin || undefined,
      });
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="text-xs text-faint">{label}</span>
      <div className="mt-1">{node}</div>
    </label>
  );
  return (
    <details className={CARD}>
      <summary className={SUMMARY}>Ajouter une période</summary>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field(
          'N°',
          <input
            type="number"
            className={INPUT}
            value={f.numero}
            onChange={(e) => setF({ ...f, numero: n(e.target.value) })}
          />,
        )}
        {field(
          'Libellé',
          <input
            className={INPUT}
            value={f.libelle}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
          />,
        )}
        {field(
          'Début',
          <input
            type="date"
            className={INPUT}
            value={f.dateDebut}
            onChange={(e) => setF({ ...f, dateDebut: e.target.value })}
          />,
        )}
        {field(
          'Fin',
          <input
            type="date"
            className={INPUT}
            value={f.dateFin}
            onChange={(e) => setF({ ...f, dateFin: e.target.value })}
          />,
        )}
        {field(
          'TVA %',
          <input
            type="number"
            step="any"
            className={INPUT}
            value={f.tauxTva}
            onChange={(e) => setF({ ...f, tauxTva: n(e.target.value) })}
          />,
        )}
        {field(
          'Retenue %',
          <input
            type="number"
            step="any"
            className={INPUT}
            value={f.tauxRetenue}
            onChange={(e) => setF({ ...f, tauxRetenue: n(e.target.value) })}
          />,
        )}
        {field(
          'Décomptes précédents',
          <input
            type="number"
            step="any"
            className={INPUT}
            value={f.decomptesPrecedents}
            onChange={(e) => setF({ ...f, decomptesPrecedents: n(e.target.value) })}
          />,
        )}
        {field(
          'Dépenses exercices antérieurs',
          <input
            type="number"
            step="any"
            className={INPUT}
            value={f.depensesExercicesAnterieurs}
            onChange={(e) =>
              setF({ ...f, depensesExercicesAnterieurs: n(e.target.value) })
            }
          />,
        )}
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={f.isDecompteDernier}
            onChange={(e) => setF({ ...f, isDecompteDernier: e.target.checked })}
          />
          Décompte dernier
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <button type="submit" disabled={saving} className={BTN}>
            {saving ? 'Enregistrement…' : 'Créer la période'}
          </button>
        </div>
      </form>
    </details>
  );
}

// ── Décompte creator (server computes HT/TVA/TTC + récap) ──────────────────────
export interface DecompteInput {
  periodeId?: string;
  isDernier: boolean;
  lignes: {
    prixNo?: string | number;
    designation?: string;
    unite?: string;
    quantiteBordereau?: number;
    quantiteRealisee: number;
    prixUnitaireHT: number;
  }[];
}

export function DecompteCreator({
  periodes,
  bordereaux,
  decomptes,
  createDecompte,
}: {
  periodes: Periode[];
  bordereaux: Bordereau[];
  decomptes: Decompte[];
  createDecompte: (input: DecompteInput) => Promise<void>;
}) {
  const bpu: BordereauLigne[] = bordereaux[0]?.lignes ?? [];
  const used = new Set(decomptes.map((d) => d.periodeId).filter(Boolean));
  const available = periodes.filter((p) => !used.has(p.id));
  const [periodeId, setPeriodeId] = useState<string>(available[0]?.id ?? '');
  const [qtes, setQtes] = useState<Record<number, number>>(() =>
    Object.fromEntries(bpu.map((l, i) => [i, n(l.quantite)])),
  );
  const [saving, setSaving] = useState(false);

  if (bpu.length === 0) {
    return (
      <div className={CARD}>
        <p className={SUMMARY}>Créer un décompte</p>
        <p className="mt-3 text-sm text-faint">
          Ajoutez d’abord un bordereau des prix pour pouvoir créer un décompte.
        </p>
      </div>
    );
  }

  const totalHt = bpu.reduce((s, l, i) => s + n(qtes[i]) * n(l.prixUnitaire), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const lignes = bpu.map((l, i) => ({
        prixNo: l.prixNo,
        designation: l.designation,
        unite: l.unite,
        quantiteBordereau: n(l.quantite),
        quantiteRealisee: n(qtes[i]),
        prixUnitaireHT: n(l.prixUnitaire),
      }));
      await createDecompte({ periodeId: periodeId || undefined, isDernier: false, lignes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className={CARD}>
      <summary className={SUMMARY}>Créer un décompte</summary>
      <form onSubmit={submit} className="mt-4">
        <label className="mb-4 block max-w-xs">
          <span className="text-xs text-faint">Période</span>
          <select
            className={`${INPUT} mt-1`}
            value={periodeId}
            onChange={(e) => setPeriodeId(e.target.value)}
          >
            <option value="">— Sans période —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                N°{p.numero} {p.libelle ?? ''}
              </option>
            ))}
          </select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Désignation</th>
                <th className={`${TH} w-20`}>Unité</th>
                <th className={`${TH} w-28 text-right`}>Qté bordereau</th>
                <th className={`${TH} w-32`}>Qté réalisée</th>
                <th className={`${TH} w-32 text-right`}>P.U. HT</th>
                <th className={`${TH} w-32 text-right`}>Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {bpu.map((l, i) => (
                <tr key={i} className="border-b border-line/50">
                  <td className="py-1 pr-2 text-ink-2">{l.designation ?? '—'}</td>
                  <td className="py-1 pr-2 text-muted">{l.unite ?? '—'}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums text-faint">
                    {n(l.quantite).toLocaleString('fr-MA')}
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="any"
                      className={`${INPUT} text-right`}
                      value={qtes[i] ?? 0}
                      onChange={(e) =>
                        setQtes((q) => ({ ...q, [i]: n(e.target.value) }))
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums">
                    {fmtMad(n(l.prixUnitaire))}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink-2">
                    {fmtMad(n(qtes[i]) * n(l.prixUnitaire))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-faint">
            HT/TVA/TTC et retenue calculés à l’enregistrement (moteur Excel).
          </span>
          <span className="font-mono text-sm tabular-nums text-ink-2">
            Total HT : {fmtMad(totalHt)}
          </span>
        </div>
        <div className="mt-4">
          <button type="submit" disabled={saving} className={BTN}>
            {saving ? 'Enregistrement…' : 'Enregistrer le décompte'}
          </button>
        </div>
      </form>
    </details>
  );
}
