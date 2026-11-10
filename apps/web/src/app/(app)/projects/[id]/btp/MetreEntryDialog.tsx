'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { computeLignePartielClient, metreCalcType, round2Client, DIAMETRES_DISPONIBLES } from '@/lib/btp-shared';
import { fmtMetreQty } from '@/lib/metre-details';
import { buildTemplateLine, entryColumns, parseMetreClipboard, readMetreNumber, templatesForUnit, CLIPBOARD_LIMIT, ENTRY_LIMIT, type ClipboardField, type MeasurementDraft } from '@/lib/metre-entry';

export function MetreEntryDialog({ mode, unit, destination, initialText = '', factor = 1, onApply, onClose }: {
  mode: 'paste' | 'template'; unit: string; destination: string; initialText?: string; factor?: number;
  onApply: (lines: MeasurementDraft[], undoLabel: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(1120px,96vw)] overflow-y-auto rounded-2xl border border-line bg-paper-2 p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
      <div><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan">{destination} · {unit}</p><h2 id={titleId} className="text-xl font-bold">{mode === 'paste' ? 'Importer des mesures' : 'Modèle d’ouvrage'}</h2><p className="mt-1 text-xs text-muted">{mode === 'paste' ? 'Collez votre tableau, vérifiez les colonnes et contrôlez le résultat.' : 'Décrivez les ouvrages identiques ; la quantité est calculée avant l’ajout.'}</p></div>
      <button type="button" onClick={onClose} aria-label="Fermer la saisie assistée" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-sand">✕</button>
    </div>
    {mode === 'paste' ? <PasteEntry unit={unit} initialText={initialText} factor={factor} onApply={onApply} onClose={onClose} /> : <TemplateEntry unit={unit} factor={factor} onApply={onApply} onClose={onClose} />}
  </dialog>;
}

function PasteEntry({ unit, initialText, factor, onApply, onClose }: {
  unit: string; initialText: string; factor: number;
  onApply: (lines: MeasurementDraft[], undoLabel: string) => void; onClose: () => void;
}) {
  const [raw, setRaw] = useState(initialText);
  const [mapping, setMapping] = useState<ClipboardField[]>();
  const [headerMode, setHeaderMode] = useState<'auto' | 'yes' | 'no'>('auto');
  const [previewLimit, setPreviewLimit] = useState(50);
  const preview = useMemo(() => parseMetreClipboard(raw, unit, mapping, headerMode), [raw, unit, mapping, headerMode]);
  const columns = entryColumns(unit);
  const badRows = preview.rows.filter((row) => row.errors.length > 0).length;
  const total = round2Client(preview.rows.reduce((sum, row) => sum + computeLignePartielClient(unit, { id: 'preview', ...row.line }) * factor, 0));
  const allErrors = [...preview.errors, ...(!Number.isFinite(total) ? ['Le résultat dépasse la capacité numérique, après application de la répétition de l’élément. Vérifiez les valeurs.'] : [])];
  const valid = preview.rows.length > 0 && !badRows && !allErrors.length;
  const displayRows = badRows ? [...preview.rows.filter((row) => row.errors.length), ...preview.rows.filter((row) => !row.errors.length)] : preview.rows;
  const sample = `${columns.map((column) => column.label).join('\t')}\n${metreCalcType(unit) === 'poids' ? 'Poteaux P1\t4\t8\t3\t12' : metreCalcType(unit) === 'volume' ? 'Semelle S1\t8\t2\t2\t0,5' : metreCalcType(unit) === 'surface' ? 'Zone A\t1\t5\t3' : metreCalcType(unit) === 'lineaire' ? 'Tronçon A\t1\t12' : 'Ouvrages\t8'}`;
  return <>
    <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-4">
        <div><label htmlFor="metre-paste-data" className="text-sm font-semibold">1. Coller depuis Excel</label><p className="mt-1 text-xs leading-relaxed text-muted">Copiez les cellules puis collez-les ici. Tabulations ou point-virgules ; jusqu’à {ENTRY_LIMIT} mesures. Les colonnes de résultats sont ignorées.</p></div>
        <textarea autoFocus id="metre-paste-data" aria-label="Tableau à importer" value={raw} onChange={(event) => { setRaw(event.target.value); setMapping(undefined); }} maxLength={CLIPBOARD_LIMIT + 1} rows={9} placeholder={sample} className="w-full resize-y rounded-xl border border-line bg-paper p-3 font-mono text-xs leading-relaxed outline-none focus:border-cyan focus:ring-2 focus:ring-cyan/15" />
        <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => { setRaw(sample); setMapping(undefined); setHeaderMode('auto'); }} className="text-xs font-semibold text-cyan hover:underline">Charger un exemple</button><label className="ml-auto text-[11px] text-muted">Titres <select aria-label="Détection des titres" value={headerMode} onChange={(event) => { setHeaderMode(event.target.value as typeof headerMode); setMapping(undefined); }} className="ml-1 rounded border border-line bg-paper px-2 py-1 text-ink-2"><option value="auto">Automatique</option><option value="yes">Première ligne = titres</option><option value="no">Sans titres</option></select></label></div>
        {preview.mapping.length > 0 && <div className="rounded-xl border border-line p-3"><h3 className="mb-3 text-sm font-semibold">2. Associer les colonnes</h3><div className="space-y-2">{preview.mapping.map((field, index) => <label key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-xs"><span className="truncate text-muted" title={preview.headers[index]}>{index + 1}. {preview.headers[index]}</span><select aria-label={`Destination colonne ${index + 1}`} value={field} onChange={(event) => { const next = [...preview.mapping]; next[index] = event.target.value as ClipboardField; setMapping(next); }} className="min-w-0 rounded-md border border-line bg-paper px-2 py-1.5 text-ink-2"><option value="unmapped" disabled>À associer…</option><option value="ignore">Ignorer</option>{columns.map((column) => <option key={column.field} value={column.field}>{column.label}</option>)}<option value="unit">Unité (contrôle)</option></select></label>)}</div><p className="mt-3 text-[10px] text-faint">{preview.hasHeader ? 'Titres détectés.' : 'Ordre du tableau de métré appliqué.'} {preview.mapping.filter((field) => field === 'ignore').length} colonne(s) ignorée(s).</p></div>}
      </div>
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">3. Vérifier l’aperçu</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${valid ? 'bg-emerald-soft text-emerald' : 'bg-sand text-muted'}`}>{preview.rows.length} mesure(s){badRows ? ` · ${badRows} à corriger` : ''}</span></div>
        {allErrors.length > 0 && <div role="alert" className="mb-3 space-y-1 rounded-lg border border-clay/30 bg-clay-soft/20 p-3 text-xs text-clay">{allErrors.map((error) => <p key={error}>{error}</p>)}</div>}
        {!preview.rows.length ? <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-paper p-6 text-center"><span className="mb-3 rounded-xl bg-cyan-soft px-4 py-3 font-mono text-xl text-cyan">↳</span><p className="text-sm font-semibold text-ink-2">Votre tableau apparaîtra ici</p><p className="mt-2 text-xs text-muted">Les mesures seront ajoutées à cet emplacement après validation.</p></div> : <div className="max-h-[440px] overflow-auto rounded-xl border border-line"><table className="w-full min-w-[440px] text-xs"><thead className="sticky top-0 bg-sand text-left text-[10px] text-muted"><tr><th className="px-3 py-2">Source</th><th className="px-3 py-2">Repère / contrôle</th><th className="px-3 py-2 text-right">Partiel ({unit})</th></tr></thead><tbody className="divide-y divide-line">{displayRows.slice(0, previewLimit).map((row) => <tr key={row.sourceRow} className={row.errors.length ? 'bg-clay-soft/10' : ''}><td className="px-3 py-3 align-top font-mono text-faint">L{row.sourceRow}</td><td className="px-3 py-3"><p className="font-medium">{row.line.designation || 'Sans repère'}</p>{row.errors.length ? <ul className="mt-1 space-y-1 text-[11px] text-clay">{row.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : <p className="mt-1 text-[10px] text-muted">{columns.filter((column) => column.field !== 'designation' && column.field !== 'ignore' && column.field !== 'unit' && column.field !== 'unmapped').map((column) => `${column.label} : ${row.line[column.field as keyof MeasurementDraft] ?? 1}`).join(' · ')}</p>}</td><td className="px-3 py-3 text-right align-top font-mono font-semibold text-emerald">{row.errors.length ? '—' : fmtMetreQty(round2Client(computeLignePartielClient(unit, { id: 'preview', ...row.line }) * factor))}</td></tr>)}</tbody></table>{preview.rows.length > previewLimit && <button type="button" onClick={() => setPreviewLimit((count) => count + 50)} className="w-full border-t border-line p-3 text-left text-xs font-semibold text-cyan">Afficher les 50 mesures suivantes ({preview.rows.length - previewLimit} restantes)</button>}{badRows > 0 && <p className="border-t border-line p-3 text-[11px] text-ochre">Les mesures à corriger sont affichées en premier, avec leur numéro de ligne source.</p>}</div>}
        <div className="mt-4 rounded-xl bg-cyan-soft/30 px-4 py-3"><p className="text-[11px] text-muted">Quantité ajoutée {factor !== 1 ? `(répétition de l’élément × ${factor} incluse)` : ''}</p><p className="mt-1 font-mono text-xl font-bold text-cyan">{valid ? fmtMetreQty(total) : '—'} <span className="text-xs">{unit}</span></p></div>
      </div>
    </div>
    <DialogFooter onClose={onClose} disabled={!valid} onConfirm={() => onApply(preview.rows.map((row) => row.line), 'l’import')} label={`Ajouter ${preview.rows.length} mesure(s)`} />
  </>;
}

function TemplateEntry({ unit, factor, onApply, onClose }: {
  unit: string; factor: number; onApply: (lines: MeasurementDraft[], undoLabel: string) => void; onClose: () => void;
}) {
  const templates = templatesForUnit(unit);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const defaults = { nombreSemblables: '1', nombreElements: '1', diametre: '12' };
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [designation, setDesignation] = useState('');
  const [deduction, setDeduction] = useState(false);
  const columns = entryColumns(unit).filter((column) => column.field !== 'designation' && column.field !== 'ignore' && column.field !== 'unit' && column.field !== 'unmapped');
  const numeric: MeasurementDraft = { designation };
  const malformed: string[] = [];
  for (const column of columns) {
    const raw = values[column.field] ?? '';
    const value = readMetreNumber(raw);
    if (raw.trim() && value === undefined) malformed.push(`${column.label} : nombre invalide.`);
    if (value !== undefined) (numeric as Record<string, unknown>)[column.field] = value;
  }
  const result = buildTemplateLine(unit, templateId, numeric, deduction);
  const quantity = computeLignePartielClient(unit, { id: 'preview', ...result.line }) * factor;
  const errors = [...malformed, ...result.errors, ...(!Number.isFinite(quantity) ? ['Le résultat dépasse la capacité numérique après répétition. Vérifiez les valeurs.'] : [])];
  const label = (field: ClipboardField, fallback: string) => field === 'profondeur' ? templateId === 'radier' ? 'Épaisseur (m)' : templateId === 'poteau' ? 'Hauteur (m)' : 'Profondeur (m)' : field === 'longueur' || field === 'largeur' ? `${fallback} (m)` : fallback;
  return <>
    <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-2"><h3 className="mb-3 text-sm font-semibold">Choisir un ouvrage</h3>{templates.map((template) => <button type="button" key={template.id} aria-pressed={templateId === template.id} onClick={() => { setTemplateId(template.id); setValues(defaults); setDesignation(''); }} className={`w-full rounded-xl border p-4 text-left transition ${templateId === template.id ? 'border-cyan bg-cyan-soft/20' : 'border-line hover:bg-sand/50'}`}><span className={`block text-sm font-semibold ${templateId === template.id ? 'text-cyan' : 'text-ink-2'}`}>{template.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted">{template.description}</span></button>)}<p className="pt-3 text-[11px] leading-relaxed text-muted">Modèles compatibles avec {unit}. Les dimensions décrivent un ouvrage ; le nombre indique les ouvrages identiques. Pour une géométrie composée, ajoutez une mesure par partie.</p></div>
      <div className="min-w-0"><h3 className="mb-3 text-sm font-semibold">Renseigner les dimensions</h3><label className="block text-xs font-medium text-muted">Repère de l’ouvrage<input autoFocus aria-label="Repère du modèle" value={designation} onChange={(event) => setDesignation(event.target.value)} placeholder="Ex. : Semelle S1 · zone A" className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-cyan" /></label><div className="mt-4 grid grid-cols-2 gap-3">{columns.map((column) => <label key={column.field} className="text-xs font-medium text-muted">{label(column.field, column.label)}{column.field === 'diametre' ? <select aria-label={`Modèle · ${column.label}`} value={values[column.field] ?? ''} onChange={(event) => setValues((prev) => ({ ...prev, [column.field]: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-sm text-ink"><option value="">Choisir…</option>{DIAMETRES_DISPONIBLES.map((diameter) => <option key={diameter} value={diameter}>{diameter} mm</option>)}</select> : <input aria-label={`Modèle · ${column.label}`} inputMode="decimal" value={values[column.field] ?? ''} onChange={(event) => setValues((prev) => ({ ...prev, [column.field]: event.target.value }))} placeholder={column.field.startsWith('nombre') ? '1' : 'En mètres'} className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-cyan" />}</label>)}</div><label className="mt-4 flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={deduction} onChange={(event) => setDeduction(event.target.checked)} className="accent-cyan" />Déduction (quantité négative)</label>
        <div className="mt-5 rounded-xl border border-cyan/25 bg-cyan-soft/20 p-4"><p className="text-xs font-semibold text-ink-2">Aperçu de la quantité</p><p className="my-2 font-mono text-3xl font-bold text-cyan">{errors.length ? '—' : fmtMetreQty(round2Client(quantity))} <span className="text-sm font-medium">{unit}</span></p><p className="text-[11px] text-muted">{columns.map((column) => `${column.label} : ${String(result.line[column.field as keyof MeasurementDraft] ?? '…')}`).join(' · ')}{factor !== 1 ? ` · élément × ${factor}` : ''}</p>{errors.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-ochre">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}</div>
      </div>
    </div>
    <DialogFooter onClose={onClose} disabled={errors.length > 0} onConfirm={() => onApply([result.line], 'le modèle')} label="Ajouter cette mesure" />
  </>;
}

function DialogFooter({ onClose, onConfirm, disabled, label }: { onClose: () => void; onConfirm: () => void; disabled: boolean; label: string }) {
  return <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper-2 px-5 py-4 sm:px-7"><p className="text-[11px] text-muted">Ajout au brouillon · Enregistrement du métré ensuite</p><div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-muted hover:bg-sand">Annuler</button><button type="button" disabled={disabled} onClick={onConfirm} className="rounded-lg bg-cyan px-4 py-2.5 text-xs font-bold text-paper hover:opacity-90 disabled:opacity-40">{label} →</button></div></div>;
}
