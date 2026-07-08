'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtMad } from '@/lib/projects';
import { fmtDateTime, type TenderInventory, type TenderItem } from '@/lib/tenders';
import {
  bpuToCsv,
  buildExpertSearchQuery,
  METHODE_LABELS,
  STATUT_LABELS,
  STATUT_TONES,
  type AdminFinancialDossier,
  type BpuProposal,
  type ExpertAnalysis,
  type ExpertKnowledge,
} from '@/lib/expert';

type Tab = 'analyse' | 'bpu' | 'dossier';

const VERDICT_TONES: Record<string, string> = {
  go: 'bg-emerald-soft text-emerald',
  no_go: 'bg-clay-soft text-clay',
  a_verifier: 'bg-ochre-soft text-ochre-deep',
};

const VERDICT_LABELS: Record<string, string> = {
  go: 'GO — soumissionner',
  no_go: 'NO-GO — passer',
  a_verifier: 'À vérifier',
};

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[]; error?: string };
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    return message ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className="font-mono text-xl font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function BulletList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink-2">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ExpertPage() {
  const [knowledge, setKnowledge] = useState<ExpertKnowledge | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TenderItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TenderItem | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tab, setTab] = useState<Tab>('analyse');
  const [analysis, setAnalysis] = useState<ExpertAnalysis | null>(null);
  const [bpu, setBpu] = useState<BpuProposal | null>(null);
  const [dossier, setDossier] = useState<AdminFinancialDossier | null>(null);
  const [pending, setPending] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rabaisInput, setRabaisInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  // BPU line count from a just-run extraction — the inventory list only ships the
  // `hasBpu` flag (not the heavy array), so this fills the count once we have it.
  const [extractCount, setExtractCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tender/expert/knowledge')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as ExpertKnowledge;
      })
      .then((data) => {
        if (!cancelled) setKnowledge(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setKnowledgeError(err instanceof Error ? err.message : 'Erreur inconnue');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/tender/inventory?${buildExpertSearchQuery(q).toString()}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(await readError(res));
          return (await res.json()) as TenderInventory;
        })
        .then((data) => setResults(data.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  function pick(item: TenderItem): void {
    setSelected(item);
    setResults([]);
    setQuery('');
    setAnalysis(null);
    setBpu(null);
    setDossier(null);
    setError(null);
    setExtractCount(null);
    setTab('analyse');
    // Silently prefill from previously-persisted agent work (404 = none yet).
    fetch(`/api/tender/expert/${item.id}/analyze`)
      .then((res) => (res.ok ? (res.json() as Promise<ExpertAnalysis>) : null))
      .then((data) => {
        if (data) setAnalysis(data);
      })
      .catch(() => undefined);
    fetch(`/api/tender/expert/${item.id}/bpu`)
      .then((res) => (res.ok ? (res.json() as Promise<BpuProposal>) : null))
      .then((data) => {
        if (data) setBpu(data);
      })
      .catch(() => undefined);
  }

  /**
   * Reads the REAL DCE dossier for the selected consultation — downloads it from
   * the portal, extracts budget/caution/qualifications and the bordereau (BPU),
   * and persists it on the tender. This is the prerequisite the agent needs to
   * analyse precisely and to fill the BPU; before it runs, "Proposer les prix"
   * returns "Bordereau des prix non extrait".
   */
  async function runExtract(): Promise<void> {
    if (!selected || extracting || pending) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tender/tenders/${selected.id}/extract-dossier`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as {
        bpuCount: number;
        estimationMad: number | null;
      };
      setExtractCount(result.bpuCount);
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              hasBpu: result.bpuCount > 0,
              estimationMad: result.estimationMad ?? prev.estimationMad,
            }
          : prev,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setExtracting(false);
    }
  }

  async function runAnalysis(): Promise<void> {
    if (!selected || pending || extracting) return;
    setPending('analyse');
    setError(null);
    setTab('analyse');
    try {
      const res = await fetch(`/api/tender/expert/${selected.id}/analyze`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readError(res));
      setAnalysis((await res.json()) as ExpertAnalysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPending(null);
    }
  }

  async function runBpu(): Promise<void> {
    if (!selected || pending || extracting) return;
    setPending('bpu');
    setError(null);
    setTab('bpu');
    const rabais = Number(rabaisInput);
    const body =
      rabaisInput.trim() !== '' && Number.isFinite(rabais)
        ? JSON.stringify({ rabaisPct: rabais })
        : JSON.stringify({});
    try {
      const res = await fetch(`/api/tender/expert/${selected.id}/bpu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(await readError(res));
      setBpu((await res.json()) as BpuProposal);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPending(null);
    }
  }

  async function loadDossier(): Promise<void> {
    if (!selected || pending || extracting) return;
    setPending('dossier');
    setError(null);
    setTab('dossier');
    try {
      const res = await fetch(`/api/tender/expert/${selected.id}/dossier-admin`);
      if (!res.ok) throw new Error(await readError(res));
      setDossier((await res.json()) as AdminFinancialDossier);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPending(null);
    }
  }

  function exportBpu(): void {
    if (!bpu || !selected) return;
    const blob = new Blob([bpuToCsv(bpu)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BPU_${selected.reference.replace(/[^A-Za-z0-9]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const k = knowledge;
  // DCE state for the selected consultation. `hasBpu` is the flag the inventory
  // list ships (SQL-computed); `extractCount` is set once we run extraction this
  // session (even to 0 — a readable DCE with no parseable bordereau). So the DCE
  // is "read" when either is known, but the BPU is only "available" when > 0.
  const dceExtracted = !!selected && (selected.hasBpu || extractCount !== null);
  const bpuAvailable = !!selected && (selected.hasBpu || (extractCount ?? 0) > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan">
            <Icon name="agents" size={14} /> Agent expert de l’entreprise
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">AGHA-RM-INFRA</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            L’expert interne des marchés publics : formé sur tout le catalogue, les
            résultats publiés et les dossiers DCE. Il analyse une consultation,
            propose les prix du bordereau et prépare le dossier de soumission.
          </p>
        </div>
        {k ? (
          <p className="text-xs text-faint">
            Mémoire mise à jour : {fmtDateTime(k.generatedAt)}
          </p>
        ) : null}
      </header>

      {/* ── What the agent knows ─────────────────────────────────────────── */}
      <section aria-label="Connaissances de l’agent">
        {knowledgeError ? (
          <p className="rounded-lg border border-line bg-clay-soft px-4 py-3 text-sm text-clay">
            Connaissances indisponibles : {knowledgeError}
          </p>
        ) : k ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Consultations étudiées"
              value={String(k.marche.tendersTotal)}
              hint={`${k.marche.tendersActive} en cours · ${k.marche.buyersTotal} acheteurs`}
            />
            <StatCard
              label="Dossiers DCE lus"
              value={String(k.marche.withBpu)}
              hint={`${k.marche.withBudget} budgets · ${k.marche.withCaution} cautions`}
            />
            <StatCard
              label="Résultats analysés"
              value={String(k.concurrence.resultsObserved)}
              hint={
                k.concurrence.avgBiddersPerTender !== null
                  ? `≈ ${k.concurrence.avgBiddersPerTender} soumissionnaires / consultation`
                  : 'la collecte des PV démarre'
              }
            />
            <StatCard
              label="Rabais gagnants calibrés"
              value={String(k.rabais.sampled)}
              hint={
                k.rabais.overall
                  ? `médiane ${k.rabais.overall.medianPct}%`
                  : 'en attente d’estimations publiées'
              }
            />
          </div>
        ) : (
          <p className="text-sm text-faint">Chargement des connaissances…</p>
        )}
      </section>

      {/* ── Tender picker ────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-line bg-paper-2 p-4">
        <label htmlFor="expert-search" className="text-sm font-medium text-ink">
          Choisir une consultation à confier à l’agent
        </label>
        <div className="relative mt-2">
          <input
            id="expert-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Référence, acheteur ou objet… (ex. 07/2026, ORMVA, forage)"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
          />
          {results.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-line bg-paper shadow-raised">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-sand"
                  >
                    <span className="font-mono text-xs font-semibold text-cyan">
                      {item.reference}
                    </span>
                    <span className="text-xs text-muted">{item.buyerName}</span>
                    <span className="line-clamp-1 text-sm text-ink-2">{item.objet}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {searching ? <p className="mt-1 text-xs text-faint">Recherche…</p> : null}

        {selected ? (
          <div className="mt-4 rounded-md border border-line bg-paper px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm font-semibold text-cyan">
                  {selected.reference}
                </p>
                <p className="text-xs text-muted">{selected.buyerName}</p>
                <p className="mt-1 max-w-3xl text-sm text-ink-2">{selected.objet}</p>
              </div>
              <div className="text-right text-xs text-muted">
                {selected.estimationMad ? (
                  <p>
                    Budget :{' '}
                    <span className="font-mono text-ink">
                      {fmtMad(selected.estimationMad)}
                    </span>
                  </p>
                ) : (
                  <p>Budget non publié</p>
                )}
                <p>
                  DCE / BPU :{' '}
                  {bpuAvailable ? (
                    <span className="text-emerald">
                      extrait
                      {extractCount != null ? ` · ${extractCount} lignes` : ''}
                    </span>
                  ) : dceExtracted ? (
                    <span className="text-ochre-deep">DCE lu · aucun BPU détecté</span>
                  ) : (
                    <span className="text-ochre-deep">pas encore extrait</span>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={runExtract}
                disabled={extracting || pending !== null}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  dceExtracted
                    ? 'border border-line text-ink-2 hover:bg-sand'
                    : 'bg-cyan text-paper hover:opacity-90'
                }`}
              >
                {extracting
                  ? 'Lecture du DCE…'
                  : dceExtracted
                    ? 'Ré-extraire le DCE'
                    : 'Extraire le DCE'}
              </button>
              <button
                type="button"
                onClick={runAnalysis}
                disabled={pending !== null || extracting}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  dceExtracted
                    ? 'bg-cyan text-paper hover:opacity-90'
                    : 'border border-cyan text-cyan hover:bg-cyan-soft'
                }`}
              >
                {pending === 'analyse' ? 'Analyse en cours…' : 'Analyser la consultation'}
              </button>
              <button
                type="button"
                onClick={runBpu}
                disabled={pending !== null || extracting}
                className="rounded-md border border-cyan px-3 py-1.5 text-sm font-semibold text-cyan hover:bg-cyan-soft disabled:opacity-50"
              >
                {pending === 'bpu' ? 'Chiffrage en cours…' : 'Proposer les prix (BPU)'}
              </button>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={rabaisInput}
                onChange={(e) => setRabaisInput(e.target.value)}
                placeholder="Rabais % (auto)"
                aria-label="Rabais imposé en pourcentage (laisser vide pour la recommandation)"
                className="w-32 rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
              />
              <button
                type="button"
                onClick={loadDossier}
                disabled={pending !== null || extracting}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-sand disabled:opacity-50"
              >
                {pending === 'dossier' ? 'Préparation…' : 'Dossier de soumission'}
              </button>
            </div>
            {!dceExtracted && !extracting ? (
              <p className="mt-2 text-xs text-muted">
                Le dossier DCE n’est pas encore lu. Lancez « Extraire le DCE » pour
                que l’agent lise le budget, les qualifications et le bordereau des
                prix — condition d’une analyse précise et du chiffrage du BPU.
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 rounded-md bg-clay-soft px-3 py-2 text-sm text-clay">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {selected ? (
        <section className="rounded-lg border border-line bg-paper-2">
          <div className="flex gap-1 border-b border-line px-3 pt-2" role="tablist">
            {(
              [
                ['analyse', 'Analyse experte'],
                ['bpu', 'Bordereau des prix'],
                ['dossier', 'Dossier administratif & financier'],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                  tab === key
                    ? 'border border-b-0 border-line bg-paper text-cyan'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'analyse' &&
              (analysis ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {analysis.avisExpert ? (
                      <span
                        className={`rounded-full px-3 py-1 text-sm font-semibold ${VERDICT_TONES[analysis.avisExpert.goNoGo.verdict]}`}
                      >
                        {VERDICT_LABELS[analysis.avisExpert.goNoGo.verdict]} ·{' '}
                        {analysis.avisExpert.goNoGo.confiancePct}%
                      </span>
                    ) : null}
                    <span className="rounded-full bg-sand px-3 py-1 text-xs text-ink-2">
                      Segment : {analysis.segment}
                    </span>
                    <span className="text-xs text-faint">
                      Générée le {fmtDateTime(analysis.generatedAt)}
                    </span>
                  </div>

                  {analysis.avisExpert ? (
                    <p className="max-w-4xl text-sm leading-relaxed text-ink-2">
                      {analysis.avisExpert.synthese}
                    </p>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-3">
                    <StatCard
                      label="Concurrence attendue"
                      value={`≈ ${analysis.competition.concurrentsAttendus}`}
                      hint={analysis.competition.detail}
                    />
                    <StatCard
                      label="Rabais recommandé"
                      value={
                        analysis.rabais.recommandePct !== null
                          ? `${analysis.rabais.recommandePct}%`
                          : '—'
                      }
                      hint={
                        analysis.rabais.fourchette
                          ? `fourchette ${analysis.rabais.fourchette.minPct}% → ${analysis.rabais.fourchette.maxPct}% · ${analysis.rabais.source}`
                          : analysis.rabais.source
                      }
                    />
                    <StatCard
                      label="Estimation administrative"
                      value={analysis.estimationMad ? fmtMad(analysis.estimationMad) : '—'}
                      hint={analysis.estimationMad ? undefined : 'non publiée / non extraite'}
                    />
                  </div>

                  {analysis.scenarios ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                            <th className="py-2 pr-3">Scénario</th>
                            <th className="py-2 pr-3">Rabais</th>
                            <th className="py-2 pr-3">Prix (MAD)</th>
                            <th className="py-2 pr-3">Marge</th>
                            <th className="py-2 pr-3">P(gain)</th>
                            <th className="py-2">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.scenarios.scenarios.map((s) => (
                            <tr
                              key={s.nom}
                              className={`border-b border-line/50 ${
                                analysis.scenarios?.recommandation.nom === s.nom
                                  ? 'bg-cyan-soft/30'
                                  : ''
                              }`}
                            >
                              <td className="py-2 pr-3 font-medium capitalize text-ink">
                                {s.nom}
                                {analysis.scenarios?.recommandation.nom === s.nom ? ' ★' : ''}
                              </td>
                              <td className="py-2 pr-3 font-mono">{s.rabaisPct}%</td>
                              <td className="py-2 pr-3 font-mono">{fmtMad(s.prixMad)}</td>
                              <td className="py-2 pr-3 font-mono">{s.margePct}%</td>
                              <td className="py-2 pr-3 font-mono">
                                {Math.round(s.probabiliteGain * 100)}%
                              </td>
                              <td className="py-2 text-xs">
                                {s.statutReglementaire === 'conforme' ? (
                                  <span className="text-emerald">conforme</span>
                                ) : (
                                  <span className="text-ochre-deep">proche seuil bas</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-muted">
                        {analysis.scenarios.recommandation.raison}
                      </p>
                    </div>
                  ) : null}

                  {analysis.avisExpert ? (
                    <div className="grid gap-4 md:grid-cols-3">
                      <BulletList
                        title="Atouts"
                        items={analysis.avisExpert.atouts}
                        tone="text-emerald"
                      />
                      <BulletList
                        title="Risques"
                        items={analysis.avisExpert.risques}
                        tone="text-clay"
                      />
                      <BulletList
                        title="Points de vigilance"
                        items={analysis.avisExpert.pointsVigilance}
                        tone="text-ochre-deep"
                      />
                    </div>
                  ) : null}

                  {analysis.avertissements.length > 0 ? (
                    <ul className="space-y-1 rounded-md bg-ochre-soft/40 px-3 py-2">
                      {analysis.avertissements.map((w, i) => (
                        <li key={i} className="text-xs text-ochre-deep">
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-faint">
                  Lancez « Analyser la consultation » — l’agent croise le dossier avec
                  sa mémoire du marché (acheteur, concurrence, rabais gagnants).
                </p>
              ))}

            {tab === 'bpu' &&
              (bpu ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cyan-soft px-3 py-1 text-xs font-semibold text-cyan">
                      {METHODE_LABELS[bpu.methode]}
                    </span>
                    {bpu.rabaisPct !== null ? (
                      <span className="rounded-full bg-sand px-3 py-1 text-xs text-ink-2">
                        Rabais appliqué : {bpu.rabaisPct}%
                      </span>
                    ) : null}
                    <span className="text-xs text-faint">
                      Généré le {fmtDateTime(bpu.generatedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={exportBpu}
                      className="ml-auto rounded-md border border-cyan px-3 py-1 text-xs font-semibold text-cyan hover:bg-cyan-soft"
                    >
                      Exporter CSV
                    </button>
                  </div>

                  {bpu.pricingBasis ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-faint">Provenance des prix :</span>
                      {bpu.pricingBasis.dce > 0 ? (
                        <span className="rounded-full bg-emerald-soft px-2.5 py-0.5 font-semibold text-emerald">
                          Estimatif DCE · {bpu.pricingBasis.dce}
                        </span>
                      ) : null}
                      {bpu.pricingBasis.historique > 0 ? (
                        <span className="rounded-full bg-cyan-soft px-2.5 py-0.5 font-semibold text-cyan">
                          Historique marché · {bpu.pricingBasis.historique}
                        </span>
                      ) : null}
                      {bpu.pricingBasis.ia > 0 ? (
                        <span className="rounded-full bg-sand px-2.5 py-0.5 text-ink-2">
                          IA · {bpu.pricingBasis.ia}
                        </span>
                      ) : null}
                      {bpu.pricingBasis.aucune > 0 ? (
                        <span className="rounded-full bg-ochre-soft px-2.5 py-0.5 text-ochre-deep">
                          Réparti · {bpu.pricingBasis.aucune}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="max-h-96 overflow-auto rounded-md border border-line">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-paper-2">
                        <tr className="text-left text-xs uppercase tracking-wide text-faint">
                          <th className="px-3 py-2">Désignation</th>
                          <th className="px-3 py-2">Qté</th>
                          <th className="px-3 py-2">Unité</th>
                          <th className="px-3 py-2 text-right">PU (MAD)</th>
                          <th className="px-3 py-2 text-right">Montant (MAD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bpu.lines.map((line, i) => (
                          <tr key={i} className="border-t border-line/50">
                            <td className="px-3 py-1.5 text-ink-2">
                              {line.section ? (
                                <span className="mr-1 text-xs text-faint">
                                  [{line.section}]
                                </span>
                              ) : null}
                              {line.designation}
                            </td>
                            <td className="px-3 py-1.5 font-mono">{line.quantite}</td>
                            <td className="px-3 py-1.5 text-muted">{line.unite ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {line.prixUnitaireMad.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {line.montantMad.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-paper-2">
                        <tr className="border-t border-line font-semibold">
                          <td className="px-3 py-2" colSpan={4}>
                            TOTAL HT
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-cyan">
                            {fmtMad(bpu.totalMad)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-muted">
                    {bpu.estimationMad !== null ? (
                      <span>Estimation : {fmtMad(bpu.estimationMad)}</span>
                    ) : null}
                    {bpu.targetTotalMad !== null ? (
                      <span>Montant cible : {fmtMad(bpu.targetTotalMad)}</span>
                    ) : null}
                    {bpu.model ? <span>Pondération : {bpu.model}</span> : null}
                  </div>

                  {bpu.avertissements.length > 0 ? (
                    <ul className="space-y-1 rounded-md bg-ochre-soft/40 px-3 py-2">
                      {bpu.avertissements.map((w, i) => (
                        <li key={i} className="text-xs text-ochre-deep">
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-faint">
                  Lancez « Proposer les prix » — l’agent chiffre chaque ligne du BPU
                  extrait du DCE et cale le total sur l’estimation moins le rabais
                  recommandé. Renseignez un rabais % pour l’imposer.
                </p>
              ))}

            {tab === 'dossier' &&
              (dossier ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-semibold ${
                        dossier.ready
                          ? 'bg-emerald-soft text-emerald'
                          : 'bg-ochre-soft text-ochre-deep'
                      }`}
                    >
                      Préparation : {dossier.readinessScore}%
                    </span>
                    {dossier.cautionProvisoireMad !== null ? (
                      <span className="rounded-full bg-sand px-3 py-1 text-xs text-ink-2">
                        Caution provisoire : {fmtMad(dossier.cautionProvisoireMad)}
                      </span>
                    ) : null}
                    {dossier.delaiExecutionMois !== null ? (
                      <span className="rounded-full bg-sand px-3 py-1 text-xs text-ink-2">
                        Délai : {dossier.delaiExecutionMois} mois
                      </span>
                    ) : null}
                  </div>

                  {(['administratif', 'technique', 'financier'] as const).map((volet) => {
                    const pieces = dossier.pieces.filter((p) => p.volet === volet);
                    if (pieces.length === 0) return null;
                    return (
                      <div key={volet}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                          Dossier {volet}
                        </p>
                        <ul className="mt-1 divide-y divide-line/50 rounded-md border border-line">
                          {pieces.map((piece) => (
                            <li
                              key={piece.code}
                              className="flex items-start justify-between gap-3 px-3 py-2"
                            >
                              <div>
                                <p className="text-sm text-ink-2">{piece.label}</p>
                                {piece.note ? (
                                  <p className="text-xs text-muted">{piece.note}</p>
                                ) : null}
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUT_TONES[piece.statut]}`}
                              >
                                {STATUT_LABELS[piece.statut]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}

                  {dossier.qualificationsRequises.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                        Qualifications exigées (DCE)
                      </p>
                      <ul className="mt-1 space-y-1">
                        {dossier.qualificationsRequises.map((q, i) => (
                          <li key={i} className="text-sm text-ink-2">
                            • {[q.secteur, q.qualification, q.classe && `classe ${q.classe}`]
                              .filter(Boolean)
                              .join(' — ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {dossier.acteEngagement.montantMad !== null ? (
                    <div className="rounded-md border border-line bg-paper px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                        Acte d’engagement — montant proposé
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold text-cyan">
                        {fmtMad(dossier.acteEngagement.montantMad)}
                      </p>
                      <p className="mt-1 text-sm italic text-ink-2">
                        « {dossier.acteEngagement.montantEnLettres} »
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-faint">
                  Lancez « Dossier de soumission » — l’agent croise le coffre-fort de
                  l’entreprise avec les exigences de la consultation : pièces
                  disponibles, à fournir, à générer, montant de la caution et acte
                  d’engagement.
                </p>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
