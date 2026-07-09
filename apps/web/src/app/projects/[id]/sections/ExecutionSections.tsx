import {
  fmtDate,
  fmtMad,
  type Bordereau,
  type BordereauLigne,
  type Decompte,
  type Metre,
  type ProjectSummary,
  type RevisionResponse,
} from '@/lib/projects';

/** A server action bound in the detail page (native <form action>). */
type ProjectFormAction = (formData: FormData) => Promise<void>;

const CARD = 'mb-8 rounded-xl border border-line bg-paper-2 p-6 shadow-sm';
const LABEL = 'text-xs font-semibold uppercase tracking-widest text-faint';
const TH = 'py-2 pr-3 text-left text-xs uppercase tracking-wider text-faint';
const TD = 'py-2 pr-3 align-top';
const NUM = 'py-2 pr-3 text-right font-mono tabular-nums';

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function statutBadge(statut: string): string {
  const s = statut.toLowerCase();
  if (s === 'valide' || s === 'paye' || s === 'approuve')
    return 'bg-emerald-soft text-emerald';
  if (s === 'soumis' || s === 'en_attente') return 'bg-ochre-soft text-ochre';
  if (s === 'annule' || s === 'rejete') return 'bg-clay-soft text-clay';
  return 'bg-sand text-muted';
}

/** Fiche marché — the chantier's administrative identity (ported BTP fields). */
export function MarcheInfoSection({ project }: { project: ProjectSummary }) {
  const rows: Array<[string, string | undefined]> = [
    ['Objet', project.objet],
    ['Société', project.societe],
    ['Commune', project.commune],
    ['Année', project.annee],
    ['Type de marché', project.typeMarche],
    ['Mode de passation', project.modePassation],
    ["Maître d'œuvre", project.maitreOeuvre],
    ['Assistance technique', project.assistanceTechnique],
    [
      "Délai d'exécution",
      project.delaiExecutionJours ? `${project.delaiExecutionJours}` : undefined,
    ],
    ['Réception provisoire', fmtDate(project.receptionProvisoire)],
    ['Réception définitive', fmtDate(project.receptionDefinitive)],
    ['Achèvement des travaux', fmtDate(project.achevementTravaux)],
  ];
  const shown = rows.filter(([, v]) => v && v !== '—');
  if (shown.length === 0) return null;
  return (
    <section className={CARD}>
      <p className={`mb-4 ${LABEL}`}>Fiche marché</p>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-faint">{label}</dt>
            <dd className="mt-0.5 text-sm text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Bordereau des prix (BPU) — the priced bill of quantities. */
export function BordereauSection({ bordereaux }: { bordereaux: Bordereau[] }) {
  const lignes: BordereauLigne[] = bordereaux.flatMap((b) =>
    Array.isArray(b.lignes) ? b.lignes : [],
  );
  return (
    <section className={CARD}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className={LABEL}>Bordereau des prix (BPU)</p>
        <span className="text-xs text-faint">
          {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
        </span>
      </div>
      {lignes.length === 0 ? (
        <p className="text-sm text-faint">Aucun bordereau enregistré.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>N° prix</th>
                <th className={TH}>Désignation</th>
                <th className={TH}>Unité</th>
                <th className={`${TH} text-right`}>Quantité</th>
                <th className={`${TH} text-right`}>P.U. HT</th>
                <th className={`${TH} text-right`}>Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const q = num(l.quantite);
                const pu = num(l.prixUnitaire);
                const montant =
                  num(l.montant) ?? (q != null && pu != null ? q * pu : undefined);
                return (
                  <tr key={i} className="border-b border-line/50">
                    <td className={`${TD} font-mono text-xs text-faint`}>
                      {String(l.prixNo ?? i + 1)}
                    </td>
                    <td className={`${TD} text-ink-2`}>{l.designation ?? '—'}</td>
                    <td className={`${TD} text-muted`}>{l.unite ?? '—'}</td>
                    <td className={NUM}>
                      {q != null ? q.toLocaleString('fr-MA') : '—'}
                    </td>
                    <td className={NUM}>{pu != null ? fmtMad(pu) : '—'}</td>
                    <td className={`${NUM} text-ink-2`}>
                      {montant != null ? fmtMad(montant) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Décomptes — line-item progress-payment statements. */
export function DecomptesSection({ decomptes }: { decomptes: Decompte[] }) {
  return (
    <section className={CARD}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className={LABEL}>Décomptes</p>
          <p className="mt-1 text-xs text-faint">
            Générés automatiquement depuis le métré (quantité = cumul des
            métrés · TVA · retenue · net à payer).
          </p>
        </div>
        <span className="text-xs text-faint">{decomptes.length}</span>
      </div>
      {decomptes.length === 0 ? (
        <p className="text-sm text-faint">Aucun décompte enregistré.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>N°</th>
                <th className={TH}>Date</th>
                <th className={`${TH} text-right`}>Montant période</th>
                <th className={`${TH} text-right`}>Cumulé</th>
                <th className={`${TH} text-right`}>TTC</th>
                <th className={`${TH} text-right`}>Retenue</th>
                <th className={`${TH} text-right`}>Net à payer</th>
                <th className={TH}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {decomptes.map((d) => (
                <tr key={d.id} className="border-b border-line/50">
                  <td className={`${TD} font-mono text-xs`}>
                    {d.numero}
                    {d.isDernier ? ' · dernier' : ''}
                  </td>
                  <td className={`${TD} text-muted`}>{fmtDate(d.dateDecompte)}</td>
                  <td className={NUM}>{fmtMad(d.montantActuelMad)}</td>
                  <td className={NUM}>{fmtMad(d.montantCumuleMad)}</td>
                  <td className={`${NUM} text-ink-2`}>
                    {fmtMad(d.totalGeneralTtcMad || d.totalTtcMad)}
                  </td>
                  <td className={NUM}>{fmtMad(d.retenueGarantieMad)}</td>
                  <td className={`${NUM} text-ink-2`}>{fmtMad(d.netAPayerMad)}</td>
                  <td className={TD}>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statutBadge(d.statut)}`}
                    >
                      {d.statut}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Révision des prix — per-project config + formulas + monthly indexes. */
export function RevisionSection({ revision }: { revision: RevisionResponse }) {
  const { config, formulas, indexes } = revision;
  // Révision is a per-chantier setup — only surface it where it's configured.
  if (!config) return null;
  const activeFormula = config?.formulaId
    ? formulas.find((f) => f.id === config.formulaId)
    : formulas.find((f) => f.isDefault);
  return (
    <section className={CARD}>
      <p className={`mb-4 ${LABEL}`}>Révision des prix</p>

      {config ? (
        <div className="mb-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-faint">Formule</dt>
            <dd className="mt-0.5 text-sm text-ink-2">
              {activeFormula?.name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Date de base</dt>
            <dd className="mt-0.5 text-sm text-ink-2">{fmtDate(config.baseDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">État</dt>
            <dd className="mt-0.5 text-sm text-ink-2">
              {config.isEnabled ? 'Activée' : 'Désactivée'}
            </dd>
          </div>
        </div>
      ) : (
        <p className="mb-5 text-sm text-faint">
          Révision non configurée pour ce chantier.
        </p>
      )}

      {activeFormula && Object.keys(activeFormula.weights).length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs text-faint">
            Pondération (partie fixe {activeFormula.fixedPart})
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(activeFormula.weights).map(([k, w]) => (
              <span
                key={k}
                className="rounded-md border border-line bg-sand px-2.5 py-1 font-mono text-xs text-ink-2"
              >
                {k}: {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {indexes.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-xs text-faint">
            Index mensuels ({indexes.length})
          </p>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Mois</th>
                <th className={TH}>Indices</th>
                <th className={TH}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {indexes.slice(0, 24).map((idx) => (
                <tr key={idx.id} className="border-b border-line/50">
                  <td className={`${TD} font-mono text-xs`}>
                    {fmtDate(idx.monthDate)}
                  </td>
                  <td className={`${TD} font-mono text-xs text-muted`}>
                    {Object.entries(idx.indexValues)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('  ')}
                  </td>
                  <td className={TD}>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statutBadge(idx.status)}`}
                    >
                      {idx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Métré — measurement summary per BPU line. */
export function MetreSection({ metres }: { metres: Metre[] }) {
  if (metres.length === 0) return null;
  return (
    <section className={CARD}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className={LABEL}>Métré</p>
        <span className="text-xs text-faint">{metres.length} lignes</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Désignation</th>
              <th className={TH}>Unité</th>
              <th className={`${TH} text-right`}>Quantité cumulée</th>
            </tr>
          </thead>
          <tbody>
            {metres.slice(0, 60).map((m) => (
              <tr key={m.id} className="border-b border-line/50">
                <td className={`${TD} text-ink-2`}>{m.designation ?? '—'}</td>
                <td className={`${TD} text-muted`}>{m.unite ?? '—'}</td>
                <td className={NUM}>{m.totalQuantite.toLocaleString('fr-MA')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Editable "fiche marché" — a native <details> form patching the chantier. */
export function FicheMarcheEditSection({
  project,
  updateDetails,
}: {
  project: ProjectSummary;
  updateDetails: ProjectFormAction;
}) {
  const inputCls =
    'mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-cyan';
  const Field = ({
    name,
    label,
    value,
    type = 'text',
  }: {
    name: string;
    label: string;
    value: string | number | undefined;
    type?: string;
  }) => (
    <label className="block">
      <span className="text-xs text-faint">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ''} className={inputCls} />
    </label>
  );
  return (
    <details className="mb-8 rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-widest text-faint">
        Modifier la fiche marché
      </summary>
      <form
        action={updateDetails}
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="text-xs text-faint">Objet</span>
          <textarea
            name="objet"
            rows={2}
            defaultValue={project.objet ?? ''}
            className={inputCls}
          />
        </label>
        <Field name="societe" label="Société" value={project.societe} />
        <Field name="commune" label="Commune" value={project.commune} />
        <Field name="annee" label="Année" value={project.annee} />
        <Field name="typeMarche" label="Type de marché" value={project.typeMarche} />
        <Field
          name="modePassation"
          label="Mode de passation"
          value={project.modePassation}
        />
        <Field name="maitreOeuvre" label="Maître d'œuvre" value={project.maitreOeuvre} />
        <Field
          name="assistanceTechnique"
          label="Assistance technique"
          value={project.assistanceTechnique}
        />
        <Field
          name="delaiExecutionJours"
          label="Délai d'exécution (jours)"
          value={project.delaiExecutionJours}
          type="number"
        />
        <Field
          name="receptionProvisoire"
          label="Réception provisoire"
          value={project.receptionProvisoire?.slice(0, 10)}
          type="date"
        />
        <Field
          name="receptionDefinitive"
          label="Réception définitive"
          value={project.receptionDefinitive?.slice(0, 10)}
          type="date"
        />
        <Field
          name="achevementTravaux"
          label="Achèvement des travaux"
          value={project.achevementTravaux?.slice(0, 10)}
          type="date"
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Enregistrer
          </button>
        </div>
      </form>
    </details>
  );
}
