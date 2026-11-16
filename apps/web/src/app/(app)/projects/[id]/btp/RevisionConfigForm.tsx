'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { fmtDate, type RevisionView } from '@/lib/btp-shared';
import { saveRevisionConfig } from '../actions';

const field = 'mt-1 block min-w-0 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm';
const percent = (value: number) => (value * 100).toLocaleString('fr-MA', { maximumFractionDigits: 4 });

function SaveButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded-lg bg-cyan px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-60">
      {pending ? 'Enregistrement…' : active ? 'Enregistrer' : 'Enregistrer et activer la révision'}
    </button>
  );
}

export function RevisionConfigForm({ projectId, view, negotiated }: { projectId: string; view: RevisionView; negotiated: boolean }) {
  const { config, defaults, formulas, indexes } = view;
  const [inline, setInline] = useState(formulas.length === 0);
  const [formulaId, setFormulaId] = useState(config?.formulaId ?? '');
  const [indexRows, setIndexRows] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [baseDate, setBaseDate] = useState(config?.baseDate?.slice(0, 10) ?? '');
  const [error, setError] = useState('');
  const formula = formulas.find((item) => item.id === formulaId);
  const effectiveBase = defaults?.baseDate;
  const overrides = baseDate === (config?.baseDate?.slice(0, 10) ?? '') ? config?.baseIndexes ?? {} : {};
  const codes = Object.keys(overrides);
  const knownCodes = [...new Set(indexes.flatMap((row) => Object.keys(row.indexValues)))].sort();

  return (
    <form action={saveRevisionConfig} className="space-y-4" id="revision-config" onSubmit={(event) => {
      if (!inline || ['disable', 'registry-base'].includes((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? '')) return;
      const data = new FormData(event.currentTarget);
      const codes = data.getAll('formula-code').map((value) => String(value).trim());
      const weights = data.getAll('formula-weight').map((value) => String(value).trim());
      const filled = codes.filter(Boolean);
      const incomplete = codes.some((code, index) => Boolean(code) !== Boolean(weights[index]));
      const total = Number(data.get('formula-fixed')) + weights.reduce((sum, value) => sum + Number(value), 0);
      const invalid = incomplete || filled.length === 0 || new Set(filled).size !== filled.length
        || !Number.isFinite(total) || Math.abs(total - 100) > 0.000001;
      if (invalid) {
        event.preventDefault();
        setError('Renseignez chaque indice une seule fois. La partie fixe et les poids doivent totaliser 100 %.');
      } else setError('');
    }}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="formulaMode" value={inline ? 'inline' : 'catalogue'} />
      {error && <p role="alert" className="text-sm text-clay">{error}</p>}
      {config && Object.keys(config.baseIndexes).length > 0 && <div className="rounded-lg border border-line bg-ochre-soft/25 p-3 text-xs">
        <p>Indices de base saisis manuellement · {Object.entries(config.baseIndexes).map(([code, value]) => `${code} ${value}`).join(' · ')}</p>
        <button type="submit" name="revisionAction" value="registry-base" formNoValidate className="mt-2 font-semibold text-cyan underline">Reprendre les indices du registre</button>
      </div>}
      <label className="block text-sm font-semibold">
        Report de la révision
        <select name="postingMode" defaultValue={config?.postingMode ?? 'each_decompte'} className={field}>
          <option value="each_decompte">Intégrer à chaque décompte</option>
          <option value="final_only">Intégrer au décompte « et dernier »</option>
        </select>
      </label>
      {formulas.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <button type="button" aria-pressed={!inline} onClick={() => setInline(false)} className={`rounded-lg border border-line px-3 py-2 ${!inline ? 'bg-cyan-soft text-cyan' : 'text-muted'}`}>Choisir une formule</button>
          <button type="button" aria-pressed={inline} onClick={() => setInline(true)} className={`rounded-lg border border-line px-3 py-2 ${inline ? 'bg-cyan-soft text-cyan' : 'text-muted'}`}>Saisir la formule</button>
        </div>
      )}
      {inline ? (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Coefficients de la formule du CPS</legend>
          <label className="block text-sm">
            Partie fixe (%)
            <input type="number" name="formula-fixed" min="15" max="100" step="0.01" required className={field} />
          </label>
          <datalist id="revision-index-codes">{knownCodes.map((code) => <option key={code} value={code} />)}</datalist>
          {Array.from({ length: indexRows }, (_, index) => (
            <div key={index} className="grid grid-cols-2 gap-3">
              <label className="text-sm">Indice {index + 1}
                <input name="formula-code" list="revision-index-codes" maxLength={50} required={index === 0} className={field} />
              </label>
              <label className="text-sm">Poids (%)
                <input name="formula-weight" type="number" min="0.01" max="85" step="0.01" required={index === 0} className={field} />
              </label>
            </div>
          ))}
          <button type="button" onClick={() => setIndexRows((count) => count + 1)} className="text-sm font-semibold text-cyan">+ Ajouter un indice</button>
          <p className="text-xs text-muted">La partie fixe et les poids des indices doivent totaliser 100 %.</p>
        </fieldset>
      ) : (
        <label className="block text-sm font-semibold">
          Formule du CPS
          <select name="formulaId" required value={formulaId} onChange={(event) => setFormulaId(event.target.value)} className={field}>
            <option value="">Sélectionner une formule</option>
            {formulas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · fixe {percent(item.fixedPart)} % · {Object.entries(item.weights).map(([code, weight]) => `${code} ${percent(weight)} %`).join(' + ')}
              </option>
            ))}
          </select>
        </label>
      )}
      <dl className="space-y-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Référence contractuelle</dt>
          <dd>{effectiveBase ? `${fmtDate(effectiveBase)} · ${defaults?.baseSource === 'offres' ? 'Date limite de remise des offres' : negotiated ? 'Signature du titulaire' : 'Référence contractuelle enregistrée'}` : negotiated
            ? 'Signature du titulaire à renseigner' : (
              <Link href={`/projects/${projectId}?section=admin&tab=apercu`} className="font-semibold text-cyan underline">Renseigner la date limite dans la fiche marché</Link>
            )}</dd>
        </div>
        {defaults?.contractDeadline && <div><dt className="text-xs text-muted">Fin du délai contractuel</dt><dd>{fmtDate(defaults.contractDeadline)}</dd></div>}
      </dl>
      {negotiated && !effectiveBase && !advanced && (
        <label className="block text-sm">
          Date de signature par le titulaire
          <input type="date" name="baseDate" className={field} />
        </label>
      )}
      <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="block text-xs font-semibold text-muted underline underline-offset-2">
        Corrections et retard
      </button>
      {advanced && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <label className="block text-sm">
            {negotiated ? 'Date de signature par le titulaire' : 'Dérogation à la date de référence de la fiche'}
            <input type="date" name="baseDate" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            Fin du délai contractuel (correction)
            <input type="date" name="contractDeadline" defaultValue={config?.contractDeadline?.slice(0, 10)} className={field} />
          </label>
          <label className="block text-sm">
            Retard imputable au titulaire
            <select name="delayAttributable" defaultValue={config?.delayAttributable == null ? '' : config.delayAttributable ? 'yes' : 'no'} className={field}>
              <option value="">À qualifier si le délai est dépassé</option>
              <option value="yes">Oui</option>
              <option value="no">Non</option>
            </select>
          </label>
          {config && Object.keys(config.baseIndexes).length > 0 && <input type="hidden" name="save-base-indexes" value="yes" />}
          {codes.length > 0 && (
            <fieldset key={baseDate} className="grid grid-cols-2 gap-2">
              <legend className="text-sm">Indices de base déjà corrigés</legend>
              {codes.map((code) => <label key={code} className="text-xs">{code}
                <input name={`base-index:${code}`} type="number" min="0.000001" step="any" defaultValue={overrides[code]} className={field} />
              </label>)}
            </fieldset>
          )}
          {config?.isEnabled && <button type="submit" name="revisionAction" value="disable" formNoValidate className="text-xs font-semibold text-clay underline">Désactiver la révision</button>}
        </div>
      )}
      <SaveButton active={!!config?.isEnabled && !!formula} />
    </form>
  );
}
