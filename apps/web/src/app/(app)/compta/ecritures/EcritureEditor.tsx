'use client';

// Éditeur d'écriture en partie double — lignes dynamiques avec équilibre
// débit/crédit vérifié en direct ; la validation finale reste serveur
// (validateEcriture). Les lignes partent en JSON dans le champ caché.
import { useMemo, useState, useTransition } from 'react';
import type { Compte, Journal } from '@/lib/compta';

interface LigneDraft {
  compteCode: string;
  libelle: string;
  debit: string;
  credit: string;
}

const VIDE: LigneDraft = { compteCode: '', libelle: '', debit: '', credit: '' };

function parseMontant(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function EcritureEditor({
  journaux,
  comptes,
  action,
  initial,
}: {
  journaux: Journal[];
  comptes: Compte[];
  action: (formData: FormData) => Promise<void>;
  initial?: {
    id: string;
    journalCode: string;
    dateEcriture: string;
    pieceRef: string;
    libelle: string;
    lignes: LigneDraft[];
  };
}) {
  const [lignes, setLignes] = useState<LigneDraft[]>(
    initial?.lignes?.length ? initial.lignes : [{ ...VIDE }, { ...VIDE }],
  );
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const ligne of lignes) {
      debit += parseMontant(ligne.debit);
      credit += parseMontant(ligne.credit);
    }
    return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
  }, [lignes]);
  const equilibre = totals.debit === totals.credit && totals.debit > 0;

  const setLigne = (index: number, patch: Partial<LigneDraft>) => {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const detail = comptes.filter((c) => c.code.length >= 4 && c.actif);

  return (
    <form
      action={(formData) => {
        formData.set(
          'lignes',
          JSON.stringify(
            lignes
              .filter((l) => l.compteCode)
              .map((l) => ({
                compteCode: l.compteCode,
                libelle: l.libelle || undefined,
                debit: parseMontant(l.debit),
                credit: parseMontant(l.credit),
              })),
          ),
        );
        startTransition(() => action(formData));
      }}
      className="space-y-4"
    >
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Journal
          <select
            name="journalCode"
            defaultValue={initial?.journalCode ?? 'OD'}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-cyan"
          >
            {journaux.map((j) => (
              <option key={j.code} value={j.code}>
                {j.code} — {j.intitule}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Date
          <input
            type="date"
            name="dateEcriture"
            required
            defaultValue={initial?.dateEcriture}
            className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm outline-none focus:border-cyan"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Pièce (n° facture…)
          <input
            name="pieceRef"
            defaultValue={initial?.pieceRef}
            placeholder="FAC-2026-001"
            className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm outline-none focus:border-cyan"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Libellé
          <input
            name="libelle"
            required
            defaultValue={initial?.libelle}
            placeholder="Achat gasoil chantier…"
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-cyan"
          />
        </label>
      </div>

      <datalist id="comptes-detail">
        {detail.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.intitule}
          </option>
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sand text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Compte</th>
              <th className="px-3 py-2 text-left">Libellé ligne</th>
              <th className="w-36 px-3 py-2 text-right">Débit</th>
              <th className="w-36 px-3 py-2 text-right">Crédit</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lignes.map((ligne, index) => (
              <tr key={index} className="bg-paper">
                <td className="px-3 py-1.5">
                  <input
                    list="comptes-detail"
                    value={ligne.compteCode}
                    onChange={(e) => setLigne(index, { compteCode: e.target.value.trim() })}
                    placeholder="6121"
                    className="w-40 rounded border border-line bg-paper-2 px-2 py-1.5 font-mono text-sm outline-none focus:border-cyan"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={ligne.libelle}
                    onChange={(e) => setLigne(index, { libelle: e.target.value })}
                    className="w-full rounded border border-line bg-paper-2 px-2 py-1.5 text-sm outline-none focus:border-cyan"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    inputMode="decimal"
                    value={ligne.debit}
                    onChange={(e) => setLigne(index, { debit: e.target.value, credit: '' })}
                    className="w-full rounded border border-line bg-paper-2 px-2 py-1.5 text-right font-mono text-sm tabular-nums outline-none focus:border-cyan"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    inputMode="decimal"
                    value={ligne.credit}
                    onChange={(e) => setLigne(index, { credit: e.target.value, debit: '' })}
                    className="w-full rounded border border-line bg-paper-2 px-2 py-1.5 text-right font-mono text-sm tabular-nums outline-none focus:border-cyan"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setLignes((prev) => prev.filter((_, i) => i !== index))}
                    disabled={lignes.length <= 2}
                    className="text-faint transition hover:text-clay disabled:opacity-30"
                    aria-label="Supprimer la ligne"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-sand/60">
            <tr>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setLignes((prev) => [...prev, { ...VIDE }])}
                  className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-muted transition hover:text-ink"
                >
                  + Ligne
                </button>
              </td>
              <td className="px-3 py-2 text-right text-xs font-semibold text-muted">Totaux</td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold tabular-nums">
                {totals.debit.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-sm font-bold tabular-nums">
                {totals.credit.toFixed(2)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            equilibre ? 'bg-emerald-soft/50 text-emerald' : 'bg-clay-soft/40 text-clay'
          }`}
        >
          {equilibre
            ? '✓ Équilibrée'
            : `Δ ${(totals.debit - totals.credit).toFixed(2)} — débits ≠ crédits`}
        </span>
        <button
          disabled={!equilibre || pending}
          className="rounded-lg bg-cyan px-5 py-2.5 text-sm font-bold text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Enregistrement…' : initial ? 'Mettre à jour' : 'Enregistrer l’écriture'}
        </button>
      </div>
    </form>
  );
}
