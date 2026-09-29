'use client';

// Éditeur du bordereau des prix — grille vivante (montant = qté × PU recalculé
// à la frappe), renumérotation à la suppression, totaux HT/TVA/TTC en pied.
// L'enregistrement passe les lignes en JSON au server action; le moteur côté
// core renormalise, met à jour le montant du marché et reconstruit la chaîne.
import { useMemo, useState, useTransition } from 'react';
import { round2Client, UNITES_BORDEREAU, type BordereauLigne } from '@/lib/btp-shared';

interface EditableLigne {
  key: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
}

function toEditable(lignes: BordereauLigne[]): EditableLigne[] {
  return lignes.map((ligne, i) => ({
    key: ligne.id ?? `ligne-${i + 1}`,
    numero: ligne.numero,
    designation: ligne.designation,
    unite: ligne.unite,
    quantite: String(ligne.quantite ?? ''),
    prixUnitaire: String(ligne.prixUnitaire ?? ''),
  }));
}

function parseNum(value: string): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

const fmt = (value: number) =>
  value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BordereauEditor({
  projectId,
  initialLignes,
  action,
}: {
  projectId: string;
  initialLignes: BordereauLigne[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [lignes, setLignes] = useState<EditableLigne[]>(() =>
    initialLignes.length > 0
      ? toEditable(initialLignes)
      : [
          {
            key: 'ligne-1',
            numero: 1,
            designation: '',
            unite: 'M³',
            quantite: '',
            prixUnitaire: '',
          },
        ],
  );
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => {
    const ht = lignes.reduce(
      (sum, ligne) => sum + parseNum(ligne.quantite) * parseNum(ligne.prixUnitaire),
      0,
    );
    const tva = ht * 0.2;
    return { ht: round2Client(ht), tva: round2Client(tva), ttc: round2Client(ht + tva) };
  }, [lignes]);

  function update(key: string, patch: Partial<EditableLigne>) {
    setLignes((prev) => prev.map((ligne) => (ligne.key === key ? { ...ligne, ...patch } : ligne)));
  }

  function addLigne() {
    setLignes((prev) => [
      ...prev,
      {
        key: `ligne-${prev.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
        numero: prev.length + 1,
        designation: '',
        unite: 'M³',
        quantite: '',
        prixUnitaire: '',
      },
    ]);
  }

  function removeLigne(key: string) {
    setLignes((prev) =>
      prev.filter((ligne) => ligne.key !== key).map((ligne, i) => ({ ...ligne, numero: i + 1 })),
    );
  }

  function submit() {
    const payload = lignes
      .filter((ligne) => ligne.designation.trim().length > 0)
      .map((ligne) => ({
        id: ligne.key,
        numero: ligne.numero,
        designation: ligne.designation.trim(),
        unite: ligne.unite,
        quantite: parseNum(ligne.quantite),
        prixUnitaire: parseNum(ligne.prixUnitaire),
      }));
    const formData = new FormData();
    formData.set('projectId', projectId);
    formData.set('lignes', JSON.stringify(payload));
    startTransition(() => action(formData));
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="w-14 px-3 py-3">N°</th>
              <th className="px-3 py-3">Désignation des ouvrages</th>
              <th className="w-20 px-3 py-3">Unité</th>
              <th className="w-28 px-3 py-3 text-right">Quantité</th>
              <th className="w-32 px-3 py-3 text-right">P.U. (MAD HT)</th>
              <th className="w-36 px-3 py-3 text-right">Montant (MAD HT)</th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lignes.map((ligne) => {
              const montant = parseNum(ligne.quantite) * parseNum(ligne.prixUnitaire);
              return (
                <tr key={ligne.key} className="group">
                  <td className="px-3 py-1.5 font-mono text-xs font-bold text-cyan">
                    {ligne.numero}
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      value={ligne.designation}
                      onChange={(e) => update(ligne.key, { designation: e.target.value })}
                      placeholder="Désignation…"
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition placeholder:text-faint focus:border-cyan focus:bg-paper"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <select
                      value={ligne.unite}
                      onChange={(e) => update(ligne.key, { unite: e.target.value })}
                      className="w-full rounded-md border border-transparent bg-transparent px-1 py-1.5 text-xs font-semibold text-muted outline-none focus:border-cyan focus:bg-paper"
                    >
                      {UNITES_BORDEREAU.map((unite) => (
                        <option key={unite} value={unite}>
                          {unite}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      inputMode="decimal"
                      value={ligne.quantite}
                      onChange={(e) => update(ligne.key, { quantite: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right font-mono text-sm tabular-nums outline-none focus:border-cyan focus:bg-paper"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      inputMode="decimal"
                      value={ligne.prixUnitaire}
                      onChange={(e) => update(ligne.key, { prixUnitaire: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right font-mono text-sm tabular-nums outline-none focus:border-cyan focus:bg-paper"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-sm font-semibold tabular-nums text-ink-2">
                    {fmt(round2Client(montant))}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeLigne(ligne.key)}
                      className="text-faint opacity-0 transition hover:text-clay group-hover:opacity-100"
                      title="Supprimer la ligne"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line bg-sand/60 text-sm">
            <tr>
              <td
                colSpan={5}
                className="px-3 py-2 text-right text-xs font-bold uppercase tracking-widest text-faint"
              >
                Total HT
              </td>
              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                {fmt(totals.ht)}
              </td>
              <td />
            </tr>
            <tr>
              <td
                colSpan={5}
                className="px-3 py-2 text-right text-xs font-bold uppercase tracking-widest text-faint"
              >
                TVA 20%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                {fmt(totals.tva)}
              </td>
              <td />
            </tr>
            <tr>
              <td
                colSpan={5}
                className="px-3 py-2 text-right text-xs font-bold uppercase tracking-widest text-cyan"
              >
                Total TTC (montant du marché)
              </td>
              <td className="px-3 py-2 text-right font-mono text-base font-black tabular-nums text-cyan">
                {fmt(totals.ttc)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={addLigne}
          className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted transition hover:border-cyan hover:text-cyan"
        >
          + Ajouter une ligne
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-cyan px-5 py-2 text-xs font-bold text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer le bordereau'}
        </button>
      </div>
    </div>
  );
}
