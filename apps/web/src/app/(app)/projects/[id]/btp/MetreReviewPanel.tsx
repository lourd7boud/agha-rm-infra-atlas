'use client';

import { useState } from 'react';
import type { MetreReviewIssue, ReviewKind } from '@/lib/metre-review';

export function MetreReviewPanel({ issues, articleLabels, onNavigate }: {
  issues: MetreReviewIssue[]; articleLabels: Record<string, string>;
  onNavigate: (articleKey: string, lineId?: string) => void;
}) {
  const [filter, setFilter] = useState<ReviewKind | 'all'>('all');
  const [limit, setLimit] = useState(20);
  const filtered = issues.filter((issue) => filter === 'all' || issue.kind === filter);
  return <details className="group overflow-hidden rounded-xl border border-line bg-paper-2">
    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5">
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${issues.length ? 'bg-ochre-soft text-ochre' : 'bg-emerald-soft text-emerald'}`}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.8" /></svg></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Assistant de contrôle</span><span className="mt-0.5 block text-[11px] text-muted">Dimensions, doublons, répétitions et quantités du marché</span></span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${issues.length ? 'bg-ochre-soft text-ochre' : 'bg-emerald-soft text-emerald'}`}>{issues.length ? `${issues.length} point(s) à vérifier` : 'Aucun point détecté'}</span><span aria-hidden="true" className="hidden text-muted sm:inline">▾</span>
    </summary>
    <div className="border-t border-line p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-xs leading-relaxed text-muted">Ces contrôles signalent des incohérences possibles et expliquent le calcul. Vérifiez avec vos plans : aucune quantité n’est corrigée automatiquement.</p><select aria-label="Filtrer les contrôles" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setLimit(20); }} className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-2"><option value="all">Tous les contrôles</option><option value="incomplete">Dimensions incomplètes</option><option value="duplicate">Doublons possibles</option><option value="dimension">Dimensions à vérifier</option><option value="zero">Quantités nulles</option><option value="repetition">Répétitions combinées</option><option value="count">Comptages interprétés</option><option value="diameter">Diamètres hors barème</option><option value="overrun">Dépassements</option></select></div>
      <div className="space-y-2">{filtered.slice(0, limit).map((issue) => <div key={issue.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-paper/60 p-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${issue.severity === 'attention' ? 'bg-ochre' : 'bg-cyan'}`} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-ink-2">{issue.title}<span className="ml-2 font-mono text-[10px] font-medium text-cyan">{articleLabels[issue.articleKey]}</span></p><p className="mt-1 text-[11px] leading-relaxed text-muted">{issue.detail}</p></div><button type="button" onClick={() => onNavigate(issue.articleKey, issue.lineIds[0])} className="rounded-md border border-line bg-paper-2 px-3 py-1.5 text-[11px] font-semibold text-cyan hover:border-cyan">{issue.lineIds.length ? 'Voir la mesure' : 'Ouvrir le prix'} →</button></div>)}</div>
      {!filtered.length && <p className="rounded-lg bg-emerald-soft/20 px-4 py-5 text-center text-xs text-muted">{issues.length ? 'Aucun point dans cette catégorie.' : 'Aucune incohérence détectée par ces contrôles. Continuez à vérifier les mesures avec les pièces du chantier.'}</p>}
      {filtered.length > limit && <button type="button" onClick={() => setLimit((prev) => prev + 20)} className="mt-3 text-xs font-semibold text-cyan">Afficher les contrôles suivants ({filtered.length - limit})</button>}
    </div>
  </details>;
}
