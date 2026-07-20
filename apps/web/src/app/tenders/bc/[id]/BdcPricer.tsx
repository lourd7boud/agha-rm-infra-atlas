'use client';

// L'atelier de chiffrage de l'agent chargé — table des articles avec prix
// éditables, marge globale, totaux vivants (miroir du moteur core) et export
// du bordereau XLSX. La sauvegarde repasse par le core qui recalcule (source
// de vérité).
import { useMemo, useState, useTransition } from 'react';
import type {
  BdcAvis,
  BdcLigne,
  BdcReponse,
  PricingRunView,
  PrixSource,
} from '@/lib/bdc';
import { SOURCE_LABELS } from '@/lib/bdc';
import { sauverReponse } from '../actions';
import { BdcPricingAgentPanel } from './BdcPricingAgentPanel';

const r2 = (n: number): number => Math.round(n * 100) / 100;

const fmt = (n: number): string =>
  n.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  avis: BdcAvis;
  reponse: BdcReponse;
  initialPricingRun?: PricingRunView | null;
}

export function BdcPricer({ avis, reponse, initialPricingRun = null }: Props) {
  const [lignes, setLignes] = useState<BdcLigne[]>(reponse.lignes);
  const [margePct, setMargePct] = useState(Math.max(15, reponse.margePct));
  const [notes, setNotes] = useState(reponse.notes ?? '');
  const [openSpecs, setOpenSpecs] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totaux = useMemo(() => {
    const facteur = 1 + margePct / 100;
    let ht = 0;
    let tva = 0;
    let vides = 0;
    const rows = lignes.map((l) => {
      const base = l.prixUnitaireHt > 0 ? l.prixUnitaireHt : 0;
      if (base <= 0) vides += 1;
      const pv = r2(l.margeAppliquee ? base * facteur : base);
      const mht = r2(pv * l.quantite);
      const mtva = r2(mht * (l.tvaPct / 100));
      ht = r2(ht + mht);
      tva = r2(tva + mtva);
      return { ...l, prixVenteHt: pv, montantHt: mht };
    });
    return { rows, ht, tva, ttc: r2(ht + tva), vides };
  }, [lignes, margePct]);

  const patch = (idx: number, changes: Partial<BdcLigne>) =>
    setLignes((prev) => prev.map((l, i) => (i === idx ? { ...l, ...changes } : l)));

  const save = () =>
    startTransition(async () => {
      try {
        const updated = await sauverReponse(avis.id, { margePct, lignes, notes });
        setLignes(updated.lignes);
        setSaved('Chiffrage enregistré ✓');
      } catch {
        setSaved('Échec de la sauvegarde — réessayez');
      }
      setTimeout(() => setSaved(null), 4000);
    });

  return (
    <div className="rounded-xl border border-line bg-paper-2 shadow-sm">
      {/* Barre de commande de l'agent */}
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-cyan">
          🤖 Atelier de chiffrage
        </h2>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          Marge globale
          <input
            type="range"
            min={15}
            max={60}
            step={1}
            value={margePct}
            onChange={(e) => setMargePct(Number(e.target.value))}
            className="w-36 accent-[var(--color-cyan)]"
          />
          <span className="w-12 rounded bg-sand px-1.5 py-0.5 text-center font-mono text-xs font-bold">
            {margePct}%
          </span>
        </label>
        <span className="text-[11px] text-faint">(appliquée aux lignes « coût + marge »)</span>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="max-w-xs text-xs font-semibold text-emerald">{saved}</span>}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-cyan px-5 py-2 text-sm font-bold text-paper transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <a
            href={`/api/bdc-devis/${avis.id}`}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            ⬇ Bordereau XLSX
          </a>
        </div>
      </div>

      <BdcPricingAgentPanel
        avisId={avis.id}
        requestedMarkupPct={margePct}
        initialRun={initialPricingRun}
        onBeforeStart={async () => {
          const updated = await sauverReponse(avis.id, { margePct, lignes, notes });
          setLignes(updated.lignes);
        }}
        onApplied={(updated) => {
          setLignes(updated.lignes);
          setSaved('Prix de l’agent appliqués au brouillon ✓');
          window.setTimeout(() => setSaved(null), 5_000);
        }}
      />

      {/* Table articles */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-faint">
              <th className="px-5 py-2.5">#</th>
              <th className="py-2.5 pr-3">Article</th>
              <th className="py-2.5 pr-3">Unité</th>
              <th className="py-2.5 pr-3 text-right">Qté</th>
              <th className="py-2.5 pr-3 text-right">P.U. HT (DH)</th>
              <th className="py-2.5 pr-3">Base</th>
              <th className="py-2.5 pr-3">Source</th>
              <th className="py-2.5 pr-5 text-right">Montant HT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {totaux.rows.map((l, i) => (
              <tr key={l.idx} className={l.prixUnitaireHt <= 0 ? 'bg-ochre-soft/10' : ''}>
                <td className="px-5 py-2 align-top font-mono text-xs text-faint">{l.idx + 1}</td>
                <td className="max-w-[340px] py-2 pr-3 align-top">
                  <button
                    type="button"
                    onClick={() => setOpenSpecs(openSpecs === i ? null : i)}
                    className="text-left font-medium leading-snug hover:text-cyan"
                    title="Voir les spécifications"
                  >
                    {l.designation}
                  </button>
                  {openSpecs === i && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-sand/60 p-3 font-sans text-xs leading-relaxed text-muted">
                      {avis.articles[l.idx]?.caracteristiques ?? '—'}
                    </pre>
                  )}
                </td>
                <td className="py-2 pr-3 align-top">{l.unite ?? '—'}</td>
                <td className="py-2 pr-3 text-right align-top font-mono tabular-nums">
                  {l.quantite}
                </td>
                <td className="py-2 pr-3 text-right align-top">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={l.prixUnitaireHt || ''}
                    placeholder="0.00"
                    onChange={(e) => patch(i, { prixUnitaireHt: Number(e.target.value) || 0 })}
                    className="w-28 rounded-lg border border-line bg-paper px-2 py-1.5 text-right font-mono text-sm outline-none focus:border-cyan"
                  />
                </td>
                <td className="py-2 pr-3 align-top">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={!!l.margeAppliquee}
                      onChange={(e) => patch(i, { margeAppliquee: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[var(--color-cyan)]"
                    />
                    coût + marge
                  </label>
                  {l.margeAppliquee && l.prixUnitaireHt > 0 && (
                    <div className="mt-0.5 font-mono text-[11px] text-cyan">
                      → {fmt(l.prixVenteHt ?? 0)}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 align-top">
                  <select
                    value={l.source}
                    onChange={(e) => patch(i, { source: e.target.value as PrixSource })}
                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-cyan"
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {l.sourceRef && (
                    <div
                      className="mt-1 max-w-[150px] truncate text-[10px] text-faint"
                      title={l.sourceRef}
                    >
                      {l.sourceRef}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-5 text-right align-top font-mono font-semibold tabular-nums">
                  {fmt(l.montantHt ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totaux */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-4">
        <div className="flex items-center gap-3">
          {totaux.vides > 0 ? (
            <span className="rounded-full bg-ochre-soft px-3 py-1 text-xs font-semibold text-ochre">
              {totaux.vides} article(s) à chiffrer
            </span>
          ) : (
            <span className="rounded-full bg-emerald-soft px-3 py-1 text-xs font-semibold text-emerald">
              Chiffrage complet ✓
            </span>
          )}
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes internes (livraison, remise, conditions…)"
            className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs outline-none placeholder:text-faint focus:border-cyan"
          />
        </div>
        <div className="flex items-center gap-6 font-mono tabular-nums">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-faint">Total HT</p>
            <p className="text-sm font-bold">{fmt(totaux.ht)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-faint">TVA</p>
            <p className="text-sm font-bold">{fmt(totaux.tva)}</p>
          </div>
          <div className="rounded-lg bg-cyan-soft/40 px-4 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-widest text-cyan">Total TTC</p>
            <p className="text-lg font-black text-cyan">{fmt(totaux.ttc)} DH</p>
          </div>
        </div>
      </div>
    </div>
  );
}
