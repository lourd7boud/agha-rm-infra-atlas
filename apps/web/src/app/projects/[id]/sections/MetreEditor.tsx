'use client';

// The MÉTRÉ page — the ONLY place quantities are entered. Per bordereau line,
// per période, the user types measurement lignes; each partiel is derived by a
// unit-aware geometry formula (live preview here, authoritative on the server).
// On save the core AUTO-REBUILDS the décompte: quantité réalisée = cumulative Σ
// of these partiels over every période ≤ the current one. Nothing is typed on
// the décompte — this is the faithful BTP dynamic.
import { useMemo, useState } from 'react';
import {
  fmtMad,
  type Bordereau,
  type BordereauLigne,
  type Metre,
  type Periode,
} from '@/lib/projects';
import {
  CALCULATION_TYPES_CONFIG,
  DIAMETRES_DISPONIBLES,
  calculatePartiel,
  normalizeUnite,
  round2,
  type Unite,
} from '@/lib/metre-calc';

const CARD = 'mb-8 rounded-xl border border-line bg-paper-2 p-6 shadow-sm';
const LABEL = 'text-xs font-semibold uppercase tracking-widest text-faint';
const INPUT =
  'w-full rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan';
const BTN =
  'rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan disabled:opacity-50';
const TH = 'py-1.5 pr-2 text-left text-[11px] uppercase tracking-wider text-faint';

const CHAMP_LABEL: Record<string, string> = {
  longueur: 'Longueur',
  largeur: 'Largeur',
  profondeur: 'Profondeur',
  nombre: 'Nombre',
  diametre: 'Ø (mm)',
};

/** One measurement line's dimensions (all optional; unité decides which apply). */
export interface MetreRow {
  designation?: string;
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  nombreSemblables?: number;
}

/** Payload for one bordereau line's métré in a période (matches the core API). */
export interface MetreLinePayload {
  bordereauLigneId: string;
  designation?: string;
  unite: string;
  lignes: MetreRow[];
}

function num(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}

/** Read a persisted métré's stored measurement lignes (data.lignes). */
function readStoredRows(data: unknown): MetreRow[] {
  const lignes = (data as { lignes?: unknown })?.lignes;
  if (!Array.isArray(lignes)) return [];
  return lignes.map((r) => {
    const o = r as Record<string, unknown>;
    const pick = (k: string): number | undefined =>
      typeof o[k] === 'number' ? (o[k] as number) : undefined;
    return {
      designation: typeof o.designation === 'string' ? o.designation : undefined,
      longueur: pick('longueur'),
      largeur: pick('largeur'),
      profondeur: pick('profondeur'),
      nombre: pick('nombre'),
      diametre: pick('diametre'),
      nombreSemblables: pick('nombreSemblables'),
    };
  });
}

const emptyRow = (): MetreRow => ({ nombreSemblables: 1 });

// ── One bordereau line's measurement block ────────────────────────────────────
function LineBlock({
  bpuLine,
  unite,
  rows,
  cumulPrecedent,
  onChange,
}: {
  bpuLine: BordereauLigne;
  unite: Unite;
  rows: MetreRow[];
  cumulPrecedent: number;
  onChange: (rows: MetreRow[]) => void;
}) {
  const cfg = CALCULATION_TYPES_CONFIG[unite];
  const qteBordereau = Number(bpuLine.quantite) || 0;

  const partiels = rows.map((r) => calculatePartiel(unite, r));
  const totalPartiel = round2(partiels.reduce((s, p) => s + p, 0));
  const totalCumule = round2(cumulPrecedent + totalPartiel);
  const pct =
    qteBordereau > 0
      ? Math.max(-999.99, Math.min(999.99, (totalCumule / qteBordereau) * 100))
      : 0;

  const setRow = (i: number, patch: Partial<MetreRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, emptyRow()]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="mb-5 rounded-lg border border-line bg-paper p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-faint">
            N°{String(bpuLine.prixNo ?? '?')}
          </span>
          <span className="text-sm font-semibold text-ink-2">
            {bpuLine.designation ?? '—'}
          </span>
          <span className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {unite}
          </span>
        </div>
        <span className="text-[11px] text-faint">{cfg.formule}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Désignation</th>
              {cfg.champs.map((c) => (
                <th key={c} className={`${TH} w-24 text-right`}>
                  {CHAMP_LABEL[c]}
                </th>
              ))}
              <th className={`${TH} w-16 text-right`}>Nbre</th>
              <th className={`${TH} w-24 text-right`}>Partiel</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/50">
                <td className="py-1 pr-2">
                  <input
                    className={INPUT}
                    value={r.designation ?? ''}
                    placeholder="ex. Semelle S1"
                    onChange={(e) => setRow(i, { designation: e.target.value })}
                  />
                </td>
                {cfg.champs.map((c) =>
                  c === 'diametre' ? (
                    <td key={c} className="py-1 pr-2">
                      <select
                        className={`${INPUT} text-right`}
                        value={r.diametre ?? ''}
                        onChange={(e) =>
                          setRow(i, { diametre: num(e.target.value) })
                        }
                      >
                        <option value="">—</option>
                        {DIAMETRES_DISPONIBLES.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : (
                    <td key={c} className="py-1 pr-2">
                      <input
                        type="number"
                        step="any"
                        className={`${INPUT} text-right`}
                        value={r[c] ?? ''}
                        onChange={(e) => setRow(i, { [c]: num(e.target.value) })}
                      />
                    </td>
                  ),
                )}
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step="any"
                    className={`${INPUT} text-right`}
                    value={r.nombreSemblables ?? ''}
                    placeholder="1"
                    onChange={(e) =>
                      setRow(i, { nombreSemblables: num(e.target.value) })
                    }
                  />
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink-2">
                  {partiels[i]!.toLocaleString('fr-MA', {
                    maximumFractionDigits: 3,
                  })}
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          className="text-sm text-cyan hover:underline"
        >
          + Ligne de métré
        </button>
        <div className="flex flex-wrap gap-4 font-mono text-xs tabular-nums text-muted">
          <span>
            Partiel période :{' '}
            <b className="text-ink-2">{totalPartiel.toLocaleString('fr-MA')}</b>
          </span>
          <span>Cumul antérieur : {cumulPrecedent.toLocaleString('fr-MA')}</span>
          <span>
            Cumulé :{' '}
            <b className="text-ink-2">{totalCumule.toLocaleString('fr-MA')}</b>
          </span>
          {qteBordereau > 0 && (
            <span className={pct > 100 ? 'text-clay' : 'text-emerald'}>
              {pct.toFixed(1)}% du marché
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Per-période grid (re-initialised via key on période change) ───────────────
function PeriodeGrid({
  periode,
  bpu,
  existing,
  cumulByLine,
  saveMetres,
}: {
  periode: Periode;
  bpu: BordereauLigne[];
  existing: Metre[];
  cumulByLine: Map<string, number>;
  saveMetres: (periodeId: string, metres: MetreLinePayload[]) => Promise<void>;
}) {
  const keyed = bpu.map((l, i) => ({
    line: l,
    key: String(l.prixNo ?? i + 1),
    unite: normalizeUnite(l.unite),
  }));

  const [rowsByLine, setRowsByLine] = useState<Record<string, MetreRow[]>>(() => {
    const init: Record<string, MetreRow[]> = {};
    for (const { key } of keyed) {
      const stored = existing.find((m) => m.bordereauLigneId === key);
      const rows = stored ? readStoredRows(stored.data) : [];
      init[key] = rows.length > 0 ? rows : [emptyRow()];
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const grandTotalHt = keyed.reduce((sum, { line, key, unite }) => {
    const partiel = round2(
      (rowsByLine[key] ?? []).reduce(
        (s, r) => s + calculatePartiel(unite, r),
        0,
      ),
    );
    const cumule = round2((cumulByLine.get(key) ?? 0) + partiel);
    return sum + cumule * (Number(line.prixUnitaire) || 0);
  }, 0);

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: MetreLinePayload[] = keyed
        .map(({ line, key, unite }) => ({
          bordereauLigneId: key,
          designation: line.designation,
          unite,
          lignes: (rowsByLine[key] ?? []).filter(
            (r) => calculatePartiel(unite, r) !== 0,
          ),
        }))
        .filter((m) => m.lignes.length > 0);
      await saveMetres(periode.id, payload);
      setSavedAt(new Date().toLocaleTimeString('fr-MA'));
    } finally {
      setSaving(false);
    }
  };

  if (bpu.length === 0) {
    return (
      <p className="mt-3 text-sm text-faint">
        Ajoutez d’abord un bordereau des prix (BPU) pour saisir le métré.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {keyed.map(({ line, key, unite }) => (
        <LineBlock
          key={key}
          bpuLine={line}
          unite={unite}
          rows={rowsByLine[key] ?? []}
          cumulPrecedent={cumulByLine.get(key) ?? 0}
          onChange={(rows) =>
            setRowsByLine((prev) => ({ ...prev, [key]: rows }))
          }
        />
      ))}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-faint">
          À l’enregistrement, le décompte N°{periode.numero} est recalculé
          automatiquement (quantités = cumul des métrés, TVA {periode.tauxTva}%,
          retenue, net à payer).
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm tabular-nums text-ink-2">
            Total HT cumulé : {fmtMad(grandTotalHt)}
          </span>
          <button type="button" onClick={onSave} disabled={saving} className={BTN}>
            {saving ? 'Calcul…' : 'Enregistrer le métré'}
          </button>
        </div>
      </div>
      {savedAt && (
        <p className="mt-2 text-right text-xs text-emerald">
          Métré enregistré à {savedAt} — décompte recalculé.
        </p>
      )}
    </div>
  );
}

// ── Top-level editor: période picker + grid ───────────────────────────────────
export function MetreEditor({
  bordereaux,
  periodes,
  metres,
  saveMetres,
}: {
  bordereaux: Bordereau[];
  periodes: Periode[];
  metres: Metre[];
  saveMetres: (periodeId: string, metres: MetreLinePayload[]) => Promise<void>;
}) {
  const bpu: BordereauLigne[] = bordereaux[0]?.lignes ?? [];
  const ordered = useMemo(
    () => [...periodes].sort((a, b) => a.numero - b.numero),
    [periodes],
  );
  const [periodeId, setPeriodeId] = useState<string>(
    ordered[ordered.length - 1]?.id ?? '',
  );
  const current = ordered.find((p) => p.id === periodeId) ?? null;

  // Cumul antérieur per bordereau line = Σ totalQuantite of earlier périodes.
  const cumulByLine = useMemo(() => {
    const numById = new Map(ordered.map((p) => [p.id, p.numero]));
    const acc = new Map<string, number>();
    if (!current) return acc;
    for (const m of metres) {
      if (!m.bordereauLigneId || !m.periodeId) continue;
      const numero = numById.get(m.periodeId) ?? 0;
      if (numero < current.numero) {
        acc.set(
          m.bordereauLigneId,
          (acc.get(m.bordereauLigneId) ?? 0) + m.totalQuantite,
        );
      }
    }
    return acc;
  }, [metres, ordered, current]);

  const existing = useMemo(
    () => (current ? metres.filter((m) => m.periodeId === current.id) : []),
    [metres, current],
  );

  return (
    <section className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={LABEL}>Métré → décompte automatique</p>
          <p className="mt-1 text-xs text-faint">
            Saisissez les mesures. Les quantités du décompte et de l’attachement
            se calculent seules à partir du cumul des métrés.
          </p>
        </div>
        <label className="text-sm">
          <span className="mr-2 text-xs text-faint">Période</span>
          <select
            className={`${INPUT} inline-block w-auto`}
            value={periodeId}
            onChange={(e) => setPeriodeId(e.target.value)}
          >
            {ordered.length === 0 && <option value="">Aucune période</option>}
            {ordered.map((p) => (
              <option key={p.id} value={p.id}>
                N°{p.numero} {p.libelle ?? ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-faint">
          Créez d’abord une période pour saisir le métré.
        </p>
      ) : current ? (
        <PeriodeGrid
          key={current.id}
          periode={current}
          bpu={bpu}
          existing={existing}
          cumulByLine={cumulByLine}
          saveMetres={saveMetres}
        />
      ) : null}
    </section>
  );
}
