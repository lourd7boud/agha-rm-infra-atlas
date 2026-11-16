'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtQty, type Avenant, type BordereauLigne, type RevisionFormula } from '@/lib/btp-shared';

const input = 'mt-1 block w-full min-w-0 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-cyan';
const secondary = 'rounded-lg border border-line px-3 py-2 text-xs font-semibold text-cyan hover:bg-cyan-soft disabled:opacity-50';

type QuantityDraft = { key: number; ligneId: string; baseline: number | null; quantity: string };
type ArticleDraft = { key: number; numero: string; designation: string; unite: string; quantity: string; price: string; origine: '' | 'marche' | 'negocie'; formula: string };
type BordereauResult = { lines: BordereauLigne[] } | { error: string };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted">{label}{children}</label>;
}

export function AvenantForm({ projectId, formulas, createAction, loadBordereauAction, draft }: {
  projectId: string;
  formulas: RevisionFormula[] | undefined;
  createAction: (previous: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  loadBordereauAction: (projectId: string, dateEffet: string) => Promise<BordereauResult>;
  draft?: Avenant;
}) {
  const recorded = draft?.bordereauImpact;
  const [result, action, pending] = useActionState(createAction, {});
  const [mode, setMode] = useState<'total' | 'bordereau'>(recorded ? 'bordereau' : 'total');
  const [details, setDetails] = useState({
    objet: draft?.objet ?? '', reference: draft?.reference ?? '', dateAvenant: draft?.dateAvenant?.slice(0, 10) ?? '',
    typeAvenant: draft?.typeAvenant ?? 'modification', montantDeltaMad: draft ? String(draft.montantDeltaMad) : '',
    delaiDeltaMois: draft ? String(draft.delaiDeltaMois) : '', dateEffet: recorded?.dateEffet ?? '',
    tauxTva: String(recorded?.tauxTva ?? 20), dateSignatureTitulaire: recorded?.dateSignatureTitulaire ?? '',
  });
  const [quantities, setQuantities] = useState<QuantityDraft[]>(() => recorded?.quantities.map((row, index) => ({
    key: index, ligneId: row.ligneId, baseline: row.ancienneQuantite, quantity: String(row.nouvelleQuantite),
  })) ?? []);
  const [articles, setArticles] = useState<ArticleDraft[]>(() => recorded?.additions.map((row, index) => ({
    key: (recorded.quantities.length + index), numero: String(row.numero), designation: row.designation,
    unite: row.unite, quantity: String(row.quantite), price: String(row.prixUnitaire),
    origine: row.origine, formula: row.formuleId ?? '',
  })) ?? []);
  const [projection, setProjection] = useState<(BordereauResult & { date: string }) | null>(null);
  const [retry, setRetry] = useState(0);
  const nextKey = useRef((recorded?.quantities.length ?? 0) + (recorded?.additions.length ?? 0));
  const structured = mode === 'bordereau';
  const date = details.dateEffet;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const matchingProjection = date && projection?.date === date ? projection : null;
  const bordereauReady = matchingProjection !== null && 'lines' in matchingProjection;
  const availableLines = bordereauReady ? matchingProjection.lines : [];
  const hasNegotiatedPrice = articles.some((row) => row.origine === 'negocie');
  const canAddQuantity = quantities.length < availableLines.length;
  const requiresSourceReview = quantities.some((row) => {
    if (!row.ligneId) return false;
    const source = availableLines.find((line) => line.id === row.ligneId);
    return !source || (row.baseline !== null && row.baseline !== source.quantite);
  });

  useEffect(() => {
    if (!structured || !validDate) return;
    let obsolete = false;
    loadBordereauAction(projectId, date).then((next) => {
      if (!obsolete) setProjection({ ...next, date });
    }).catch(() => {
      if (!obsolete) setProjection({ date, error: 'Impossible de charger les quantités à cette date.' });
    });
    return () => { obsolete = true; };
  }, [structured, date, validDate, projectId, loadBordereauAction, retry]);

  function updateDetail(name: keyof typeof details, value: string) {
    setDetails((previous) => ({ ...previous, [name]: value }));
  }

  function updateQuantity(key: number, change: Partial<Omit<QuantityDraft, 'key'>>) {
    setQuantities((previous) => previous.map((row) => row.key === key ? { ...row, ...change } : row));
  }

  function updateArticle(key: number, change: Partial<Omit<ArticleDraft, 'key'>>) {
    setArticles((previous) => previous.map((row) => row.key === key ? { ...row, ...change } : row));
  }

  return (
    <form action={action} className="border-t border-line px-5 py-4">
      <input type="hidden" name="projectId" value={projectId} />
      {draft?.observations && <input type="hidden" name="observations" value={draft.observations} />}
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <h4 className="text-sm font-bold text-ink">{draft ? `Modifier le brouillon n°${draft.numero}` : 'Ajouter un avenant'}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effet sur le marché">
            {recorded ? <>
              <input type="hidden" name="avenantMode" value="bordereau" />
              <span className="mt-1 block py-2 text-sm font-normal">Modification des postes du bordereau</span>
            </> : <select name="avenantMode" className={input} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="total">Montant ou délai uniquement</option>
              <option value="bordereau">Modifier les quantités ou les prix du bordereau</option>
            </select>}
          </Field>
          {!structured && <Field label="Type">
            <select name="typeAvenant" className={input} value={details.typeAvenant} onChange={(event) => updateDetail('typeAvenant', event.target.value)}>
              <option value="modification">Modification</option>
              <option value="prix_nouveaux">Prix nouveaux</option>
              <option value="mixte">Mixte</option>
              <option value="diminution">Diminution</option>
            </select>
          </Field>}
          <div className="sm:col-span-2">
            <Field label="Objet de l’avenant *">
              <input name="objet" required minLength={3} maxLength={2000} className={input} value={details.objet} onChange={(event) => updateDetail('objet', event.target.value)} />
            </Field>
          </div>
          <Field label={structured ? 'Référence de l’avenant signé *' : 'Référence'}>
            <input name="reference" required={structured} maxLength={200} className={input} value={details.reference} onChange={(event) => updateDetail('reference', event.target.value)} />
          </Field>
          <Field label="Date de l’avenant">
            <input name="dateAvenant" type="date" className={input} value={details.dateAvenant} onChange={(event) => updateDetail('dateAvenant', event.target.value)} />
          </Field>
          {!structured && <Field label="Montant (± MAD TTC)">
            <input name="montantDeltaMad" type="number" step="0.01" className={input} value={details.montantDeltaMad} onChange={(event) => updateDetail('montantDeltaMad', event.target.value)} />
          </Field>}
          <Field label="Délai supplémentaire (mois)">
            <input name="delaiDeltaMois" type="number" step="any" className={input} value={details.delaiDeltaMois} onChange={(event) => updateDetail('delaiDeltaMois', event.target.value)} />
          </Field>
        </div>
        {structured && (
          <div className="min-w-0 space-y-4 border-t border-line pt-4">
            <p className="text-sm text-muted">Reportez les postes de la pièce signée. Le montant TTC sera calculé à partir des quantités, des prix et de la TVA.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date d’effet figurant sur l’avenant *">
                <input name="impactDateEffet" type="date" max="9999-12-31" required className={input} value={date} onChange={(event) => {
                  setProjection(null);
                  updateDetail('dateEffet', event.target.value);
                }} />
              </Field>
              <Field label="TVA indiquée dans l’avenant (%) *">
                <input name="impactTauxTva" type="number" min="0" max="100" step="0.01" required className={input} value={details.tauxTva} onChange={(event) => updateDetail('tauxTva', event.target.value)} />
              </Field>
            </div>

            <section className="space-y-3">
              <h5 className="text-sm font-semibold">Quantités modifiées</h5>
              {!validDate && <p className="text-xs text-muted">Indiquez la date d’effet pour afficher les quantités du bordereau à cette date.</p>}
              {validDate && !matchingProjection && <p role="status" className="text-xs text-muted">Chargement du bordereau à la date d’effet…</p>}
              {matchingProjection && 'error' in matchingProjection && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-clay">
                <p>{matchingProjection.error}</p>
                <button type="button" className={secondary} onClick={() => { setProjection(null); setRetry((previous) => previous + 1); }}>Réessayer</button>
              </div>}
              {quantities.map((row, index) => {
                const line = availableLines.find((item) => item.id === row.ligneId);
                return (
                  <div key={row.key} className="grid min-w-0 gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <Field label={`Ligne du bordereau ${index + 1} *`}>
                      <select name="quantityLine" required disabled={!bordereauReady} className={input} value={row.ligneId} onChange={(event) => updateQuantity(row.key, {
                        ligneId: event.target.value, baseline: availableLines.find((item) => item.id === event.target.value)?.quantite ?? null, quantity: '',
                      })}>
                        <option value="">Choisir une ligne</option>
                        {row.ligneId && !line && <option value={row.ligneId}>Poste enregistré de cet avenant</option>}
                        {availableLines.map((item) => (
                          <option key={item.id} value={item.id} disabled={quantities.some((other) => other.key !== row.key && other.ligneId === item.id)}>
                            N°{item.numero} · {item.designation}
                          </option>
                        ))}
                      </select>
                      <input type="hidden" name="oldQuantity" value={row.baseline ?? line?.quantite ?? ''} />
                      {row.baseline !== null && <span className="mt-1 block text-xs font-normal">Quantité de référence enregistrée : {fmtQty(row.baseline)} {line?.unite}</span>}
                      {line && <span className="mt-1 block text-xs font-normal">Quantité du bordereau à cette date : {fmtQty(line.quantite)} {line.unite}</span>}
                      {bordereauReady && row.ligneId && !line && <span className="mt-1 block text-xs text-clay">Ce poste ne figure pas au bordereau à cette date. Choisissez une autre ligne.</span>}
                    </Field>
                    {line && row.baseline !== null && row.baseline !== line.quantite && <div className="space-y-2 text-xs sm:col-span-2">
                      <p role="alert" className="text-ochre">La quantité du bordereau a changé. Vérifiez la pièce signée avant de reprendre cette référence.</p>
                      <button type="button" className={secondary} onClick={() => updateQuantity(row.key, { baseline: line.quantite })}>
                        Reprendre {fmtQty(line.quantite)} {line.unite} après vérification
                      </button>
                    </div>}
                    <Field label={`Quantité totale signée${line ? ` (${line.unite})` : ''} *`}>
                      <input name="newQuantity" type="number" min="0" step="any" required className={input} value={row.quantity} onChange={(event) => updateQuantity(row.key, { quantity: event.target.value })} />
                    </Field>
                    <button type="button" onClick={() => setQuantities((previous) => previous.filter((item) => item.key !== row.key))} className="justify-self-start text-xs font-semibold text-clay">Retirer cette modification</button>
                  </div>
                );
              })}
              <button type="button" disabled={!canAddQuantity} className={secondary} onClick={() => {
                const key = nextKey.current++;
                setQuantities((previous) => [...previous, { key, ligneId: '', baseline: null, quantity: '' }]);
              }}>+ Modifier une quantité</button>
              {bordereauReady && !availableLines.length && <p className="text-xs text-muted">Le bordereau ne contient aucune ligne à modifier à cette date.</p>}
            </section>

            <section className="space-y-3">
              <h5 className="text-sm font-semibold">Nouveaux articles</h5>
              {articles.length > 0 && <p className="text-xs text-muted">Ajoutez un article par prix distinct dans l’avenant signé.</p>}
              {articles.map((row) => (
                <div key={row.key} className="grid min-w-0 gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
                  <Field label="N° de prix dans l’avenant *">
                    <input name="articleNumero" type="number" min="1" step="1" required className={input} value={row.numero} onChange={(event) => updateArticle(row.key, { numero: event.target.value })} />
                  </Field>
                  <Field label="Origine du prix signée *">
                    <select name="articleOrigine" required className={input} value={row.origine} onChange={(event) => updateArticle(row.key, { origine: event.target.value as ArticleDraft['origine'] })}>
                      <option value="">Choisir l’origine</option>
                      <option value="marche">Prix rattaché aux conditions du marché initial</option>
                      <option value="negocie">Prix nouveau négocié</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Désignation signée *">
                      <input name="articleDesignation" required maxLength={2000} className={input} value={row.designation} onChange={(event) => updateArticle(row.key, { designation: event.target.value })} />
                    </Field>
                  </div>
                  <Field label="Unité *">
                    <input name="articleUnite" required maxLength={20} className={input} value={row.unite} onChange={(event) => updateArticle(row.key, { unite: event.target.value })} />
                  </Field>
                  <Field label="Quantité signée *">
                    <input name="articleQuantite" type="number" min="0" step="any" required className={input} value={row.quantity} onChange={(event) => updateArticle(row.key, { quantity: event.target.value })} />
                  </Field>
                  <Field label="Prix unitaire HT (MAD) *">
                    <input name="articlePrixUnitaire" type="number" min="0" step="any" required className={input} value={row.price} onChange={(event) => updateArticle(row.key, { price: event.target.value })} />
                  </Field>
                  <details className="min-w-0 self-end rounded-lg border border-line p-2.5">
                    <summary className="cursor-pointer text-xs font-semibold text-muted">Formule propre au prix, si prévue</summary>
                    <div className="mt-2">
                      <Field label="Formule figurant dans l’avenant">
                        <select name="articleFormuleId" className={input} value={row.formula} onChange={(event) => updateArticle(row.key, { formula: event.target.value })}>
                          <option value="">Reprendre la formule du marché</option>
                          {row.formula && !formulas?.some((formula) => formula.id === row.formula) && <option value={row.formula}>Formule enregistrée dans l’avenant</option>}
                          {formulas?.map((formula) => <option key={formula.id} value={formula.id}>{formula.name}</option>)}
                        </select>
                      </Field>
                      {!formulas && <p className="mt-1 text-xs text-clay">Le registre des formules est indisponible. Réessayez avant de saisir une formule propre à ce prix.</p>}
                    </div>
                  </details>
                  <button type="button" onClick={() => setArticles((previous) => previous.filter((item) => item.key !== row.key))} className="justify-self-start text-xs font-semibold text-clay">Retirer cet article</button>
                </div>
              ))}
              <button type="button" className={secondary} onClick={() => {
                const key = nextKey.current++;
                setArticles((previous) => [...previous, { key, numero: '', designation: '', unite: '', quantity: '', price: '', origine: '', formula: '' }]);
              }}>+ Ajouter un article</button>
            </section>
            {hasNegotiatedPrice && <div className="max-w-sm">
              <Field label="Date de signature par le titulaire *">
                <input name="impactDateSignatureTitulaire" type="date" required className={input} value={details.dateSignatureTitulaire} onChange={(event) => updateDetail('dateSignatureTitulaire', event.target.value)} />
              </Field>
            </div>}
          </div>
        )}
        {result.error && <p role="alert" className="rounded-lg border border-clay-soft bg-clay-soft px-3 py-2 text-sm text-clay">{result.error}</p>}
        <button type="submit" disabled={structured && (!bordereauReady || requiresSourceReview)} className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90 disabled:opacity-50">
          {pending ? 'Enregistrement…' : draft ? 'Enregistrer les modifications du brouillon' : 'Créer le brouillon d’avenant'}
        </button>
      </fieldset>
    </form>
  );
}
