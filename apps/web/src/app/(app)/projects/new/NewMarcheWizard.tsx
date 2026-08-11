'use client';

// Wizard « Nouveau marché » — étape 1: mode d'obtention (5 cartes), étape 2:
// champs du mode (notre société pré-remplie quand nous sommes l'attributaire),
// étape 3: fiche marché complète. L'objet `acquisition` part en JSON caché;
// le back le valide par mode (zod) et re-remplit l'identité société.
import { useMemo, useState } from 'react';
import type { Intervenants, ModeObtention, NotreEntreprise } from '@/lib/btp-shared';

interface WizardProps {
  action: (formData: FormData) => void;
  intervenants: Intervenants;
  entreprise: NotreEntreprise;
}

interface MembreRow {
  societe: string;
  ice: string;
  partPct: string;
  montantPartMad: string;
}

const MODES: Array<{
  key: ModeObtention;
  icon: string;
  titre: string;
  titreAr: string;
  detail: string;
}> = [
  {
    key: 'ao_direct',
    icon: '🏛️',
    titre: 'Marché public — nous sommes l’adjudicataire',
    titreAr: 'صفقة عمومية — نحن نائل الصفقة',
    detail: 'Appel d’offres ouvert/restreint, concours ou négocié remporté par la société.',
  },
  {
    key: 'bon_commande',
    icon: '🧾',
    titre: 'Bon de commande',
    titreAr: 'سند طلب',
    detail: 'Prestations ≤ 500 000 DH TTC/an (décret 2-22-431, art. 91).',
  },
  {
    key: 'sous_traitance',
    icon: '🤝',
    titre: 'Sous-traitance',
    titreAr: 'مقاولة من الباطن',
    detail: 'Nous exécutons une part d’un marché dont le titulaire est une autre société.',
  },
  {
    key: 'groupement',
    icon: '🏗️',
    titre: 'Groupement d’entreprises',
    titreAr: 'تجمع مقاولات',
    detail: 'Conjoint ou solidaire — mandataire ou membre, avec quote-parts.',
  },
  {
    key: 'marche_prive',
    icon: '🏠',
    titre: 'Marché privé',
    titreAr: 'صفقة خاصة',
    detail: 'Client privé: devis accepté, contrat, modalités libres.',
  },
];

const inputClass =
  'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-widest text-faint';

function Field({
  label,
  children,
  span2,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={`${labelClass} ${span2 ? 'sm:col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  );
}

export function NewMarcheWizard({ action, intervenants, entreprise }: WizardProps) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<ModeObtention>('ao_direct');

  // ── état acquisition par mode ──
  const [aoDirect, setAoDirect] = useState({
    modePassation: 'ao_ouvert',
    caractere: 'ordinaire',
    lot: '',
    cautionProvisoireMad: '',
    cautionDefinitivePct: '3',
    retenueGarantiePct: '7',
  });
  const [bc, setBc] = useState({ numeroBc: '', dateBc: '', ordonnateur: '', montantBcMad: '' });
  const [st, setSt] = useState({
    titulaireSociete: '',
    titulaireRc: '',
    titulaireIce: '',
    titulaireContact: '',
    titulaireTelephone: '',
    marchePrincipalRef: '',
    maitreOuvrageFinal: '',
    montantPartMad: '',
    pourcentagePart: '',
    contratRef: '',
    contratDate: '',
    agrementMo: false,
    agrementDate: '',
    delaiPaiementJours: '',
  });
  const [grp, setGrp] = useState({
    typeGroupement: 'conjoint',
    notreRole: 'mandataire',
    mandataireSociete: '',
    conventionDate: '',
    notrePartPct: '',
    notrePartMad: '',
  });
  const [membres, setMembres] = useState<MembreRow[]>([
    { societe: entreprise.societe, ice: entreprise.ice, partPct: '', montantPartMad: '' },
    { societe: '', ice: '', partPct: '', montantPartMad: '' },
  ]);
  const [prive, setPrive] = useState({
    clientNom: '',
    clientIce: '',
    clientTelephone: '',
    clientAdresse: '',
    devisRef: '',
    devisDate: '',
    contratRef: '',
    acomptePct: '',
    retenueGarantiePct: '',
    modalitesPaiement: '',
  });

  const nous = mode === 'ao_direct' || mode === 'bon_commande';
  const numOrU = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
  const strOrU = (v: string) => (v.trim() === '' ? undefined : v.trim());

  const acquisition = useMemo((): Record<string, unknown> => {
    if (mode === 'ao_direct') {
      return {
        modePassation: aoDirect.modePassation,
        caractere: aoDirect.caractere,
        lot: strOrU(aoDirect.lot),
        cautionProvisoireMad: numOrU(aoDirect.cautionProvisoireMad),
        cautionDefinitivePct: numOrU(aoDirect.cautionDefinitivePct) ?? 3,
        retenueGarantiePct: numOrU(aoDirect.retenueGarantiePct) ?? 7,
      };
    }
    if (mode === 'bon_commande') {
      return {
        numeroBc: bc.numeroBc.trim(),
        dateBc: strOrU(bc.dateBc),
        ordonnateur: strOrU(bc.ordonnateur),
        montantBcMad: numOrU(bc.montantBcMad),
      };
    }
    if (mode === 'sous_traitance') {
      return {
        titulaire: {
          societe: st.titulaireSociete.trim(),
          rc: strOrU(st.titulaireRc),
          ice: strOrU(st.titulaireIce),
          contact: strOrU(st.titulaireContact),
          telephone: strOrU(st.titulaireTelephone),
        },
        marchePrincipalRef: st.marchePrincipalRef.trim(),
        maitreOuvrageFinal: strOrU(st.maitreOuvrageFinal),
        montantPartMad: numOrU(st.montantPartMad),
        pourcentagePart: numOrU(st.pourcentagePart),
        contratRef: strOrU(st.contratRef),
        contratDate: strOrU(st.contratDate),
        agrementMo: st.agrementMo,
        agrementDate: strOrU(st.agrementDate),
        delaiPaiementJours: numOrU(st.delaiPaiementJours),
      };
    }
    if (mode === 'groupement') {
      return {
        typeGroupement: grp.typeGroupement,
        notreRole: grp.notreRole,
        mandataireSociete: strOrU(grp.mandataireSociete),
        conventionDate: strOrU(grp.conventionDate),
        notrePartPct: numOrU(grp.notrePartPct),
        notrePartMad: numOrU(grp.notrePartMad),
        membres: membres
          .filter((m) => m.societe.trim())
          .map((m) => ({
            societe: m.societe.trim(),
            ice: strOrU(m.ice),
            partPct: numOrU(m.partPct),
            montantPartMad: numOrU(m.montantPartMad),
          })),
      };
    }
    return {
      client: {
        nom: prive.clientNom.trim(),
        ice: strOrU(prive.clientIce),
        telephone: strOrU(prive.clientTelephone),
        adresse: strOrU(prive.clientAdresse),
      },
      devisRef: strOrU(prive.devisRef),
      devisDate: strOrU(prive.devisDate),
      contratRef: strOrU(prive.contratRef),
      acomptePct: numOrU(prive.acomptePct),
      retenueGarantiePct: numOrU(prive.retenueGarantiePct),
      modalitesPaiement: strOrU(prive.modalitesPaiement),
    };
  }, [mode, aoDirect, bc, st, grp, membres, prive]);

  const step2Valid =
    mode === 'ao_direct' ||
    (mode === 'bon_commande' && bc.numeroBc.trim() !== '') ||
    (mode === 'sous_traitance' &&
      st.titulaireSociete.trim() !== '' &&
      st.marchePrincipalRef.trim() !== '') ||
    (mode === 'groupement' && membres.some((m) => m.societe.trim())) ||
    (mode === 'marche_prive' && prive.clientNom.trim() !== '');

  const stepPill = (n: number, label: string) => (
    <button
      type="button"
      onClick={() => n < step && setStep(n)}
      className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
        step === n
          ? 'bg-cyan text-paper'
          : n < step
            ? 'bg-emerald-soft text-emerald hover:opacity-80'
            : 'bg-sand text-faint'
      }`}
    >
      <span className="font-mono">{n}</span> {label}
    </button>
  );

  return (
    <form action={action} className="mt-8 max-w-5xl space-y-6">
      <input type="hidden" name="modeObtention" value={mode} />
      <input type="hidden" name="acquisition" value={JSON.stringify(acquisition)} />

      {/* Stepper */}
      <div className="flex flex-wrap items-center gap-2">
        {stepPill(1, "Mode d'obtention")}
        <span className="text-faint">→</span>
        {stepPill(2, 'Détails du mode')}
        <span className="text-faint">→</span>
        {stepPill(3, 'Fiche marché')}
      </div>

      {/* ── Étape 1: cartes ── */}
      {step === 1 && (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMode(m.key);
                  setStep(2);
                }}
                className={`group rounded-xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan hover:shadow-md ${
                  mode === m.key ? 'border-cyan bg-cyan-soft/30' : 'border-line bg-paper-2'
                }`}
              >
                <div className="text-2xl">{m.icon}</div>
                <div className="mt-2 text-sm font-bold leading-snug text-ink">{m.titre}</div>
                <div className="mt-0.5 text-xs font-semibold text-cyan" dir="rtl">
                  {m.titreAr}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">{m.detail}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Étape 2: champs du mode ── */}
      {step === 2 && (
        <section className="space-y-6">
          {nous && (
            <div className="rounded-xl border border-emerald-soft bg-emerald-soft/20 p-5 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald">
                Notre société — remplie automatiquement · بيانات شركتنا تلقائياً
              </h2>
              <div className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="text-faint">Société :</span>{' '}
                  <strong>
                    {entreprise.societe} {entreprise.formeJuridique}
                  </strong>
                </div>
                <div>
                  <span className="text-faint">RC :</span>{' '}
                  <span className="font-mono">{entreprise.rc}</span>
                </div>
                <div>
                  <span className="text-faint">CNSS :</span>{' '}
                  <span className="font-mono">{entreprise.cnss}</span>
                </div>
                <div>
                  <span className="text-faint">Patente/TP :</span>{' '}
                  <span className="font-mono">{entreprise.patente}</span>
                </div>
                <div>
                  <span className="text-faint">IF :</span>{' '}
                  <span className="font-mono">{entreprise.identifiantFiscal}</span>
                </div>
                <div>
                  <span className="text-faint">ICE :</span>{' '}
                  <span className="font-mono">{entreprise.ice}</span>
                </div>
              </div>
              <input type="hidden" name="societe" value={entreprise.societe} />
              <input type="hidden" name="rc" value={entreprise.rc} />
              <input type="hidden" name="cnss" value={entreprise.cnss} />
              <input type="hidden" name="patente" value={entreprise.patente} />
            </div>
          )}

          {mode === 'ao_direct' && (
            <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
                Passation du marché public
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Mode de passation *">
                  <select
                    className={`${inputClass} mt-1`}
                    value={aoDirect.modePassation}
                    onChange={(e) => setAoDirect({ ...aoDirect, modePassation: e.target.value })}
                  >
                    <option value="ao_ouvert">Appel d&apos;offres ouvert</option>
                    <option value="ao_restreint">Appel d&apos;offres restreint</option>
                    <option value="ao_preselection">AO avec présélection</option>
                    <option value="concours">Concours</option>
                    <option value="negocie_publicite">Négocié avec publicité</option>
                    <option value="negocie_sans_publicite">Négocié sans publicité</option>
                  </select>
                </Field>
                <Field label="Caractère">
                  <select
                    className={`${inputClass} mt-1`}
                    value={aoDirect.caractere}
                    onChange={(e) => setAoDirect({ ...aoDirect, caractere: e.target.value })}
                  >
                    <option value="ordinaire">Ordinaire</option>
                    <option value="cadre">Marché-cadre</option>
                    <option value="reconductible">Reconductible</option>
                    <option value="tranches_conditionnelles">À tranches conditionnelles</option>
                  </select>
                </Field>
                <Field label="Lot (si alloti)">
                  <input
                    className={`${inputClass} mt-1`}
                    value={aoDirect.lot}
                    onChange={(e) => setAoDirect({ ...aoDirect, lot: e.target.value })}
                    placeholder="Lot n°2"
                  />
                </Field>
                <Field label="Caution provisoire (DH)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={aoDirect.cautionProvisoireMad}
                    onChange={(e) =>
                      setAoDirect({ ...aoDirect, cautionProvisoireMad: e.target.value })
                    }
                    placeholder="7 000"
                  />
                </Field>
                <Field label="Caution définitive (%)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={aoDirect.cautionDefinitivePct}
                    onChange={(e) =>
                      setAoDirect({ ...aoDirect, cautionDefinitivePct: e.target.value })
                    }
                  />
                </Field>
                <Field label="Retenue de garantie (%)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={aoDirect.retenueGarantiePct}
                    onChange={(e) =>
                      setAoDirect({ ...aoDirect, retenueGarantiePct: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          )}

          {mode === 'bon_commande' && (
            <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-cyan">
                Bon de commande
              </h2>
              <p className="mb-4 text-xs text-muted">
                Plafond légal: 500 000 DH TTC par année et par nature de prestation (décret
                2-22-431, art. 91).
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="N° du bon de commande *">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    value={bc.numeroBc}
                    onChange={(e) => setBc({ ...bc, numeroBc: e.target.value })}
                    placeholder="BC 14/2026"
                  />
                </Field>
                <Field label="Date du BC">
                  <input
                    type="date"
                    className={`${inputClass} mt-1`}
                    value={bc.dateBc}
                    onChange={(e) => setBc({ ...bc, dateBc: e.target.value })}
                  />
                </Field>
                <Field label="Ordonnateur">
                  <input
                    className={`${inputClass} mt-1`}
                    value={bc.ordonnateur}
                    onChange={(e) => setBc({ ...bc, ordonnateur: e.target.value })}
                  />
                </Field>
                <Field label="Montant TTC (DH)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={bc.montantBcMad}
                    onChange={(e) => setBc({ ...bc, montantBcMad: e.target.value })}
                    placeholder="≤ 500 000"
                  />
                </Field>
              </div>
            </div>
          )}

          {mode === 'sous_traitance' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
                  Titulaire principal du marché
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Société titulaire *" span2>
                    <input
                      className={`${inputClass} mt-1`}
                      value={st.titulaireSociete}
                      onChange={(e) => setSt({ ...st, titulaireSociete: e.target.value })}
                      placeholder="STE ..."
                    />
                  </Field>
                  <Field label="RC">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      value={st.titulaireRc}
                      onChange={(e) => setSt({ ...st, titulaireRc: e.target.value })}
                    />
                  </Field>
                  <Field label="ICE">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      value={st.titulaireIce}
                      onChange={(e) => setSt({ ...st, titulaireIce: e.target.value })}
                    />
                  </Field>
                  <Field label="Contact">
                    <input
                      className={`${inputClass} mt-1`}
                      value={st.titulaireContact}
                      onChange={(e) => setSt({ ...st, titulaireContact: e.target.value })}
                    />
                  </Field>
                  <Field label="Téléphone">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      value={st.titulaireTelephone}
                      onChange={(e) => setSt({ ...st, titulaireTelephone: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
              <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
                  Notre part de sous-traitance
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Réf. marché principal *">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      value={st.marchePrincipalRef}
                      onChange={(e) => setSt({ ...st, marchePrincipalRef: e.target.value })}
                      placeholder="12/2026/…"
                    />
                  </Field>
                  <Field label="Maître d'ouvrage final">
                    <input
                      className={`${inputClass} mt-1`}
                      value={st.maitreOuvrageFinal}
                      onChange={(e) => setSt({ ...st, maitreOuvrageFinal: e.target.value })}
                    />
                  </Field>
                  <Field label="Montant de notre part (DH)">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      inputMode="decimal"
                      value={st.montantPartMad}
                      onChange={(e) => setSt({ ...st, montantPartMad: e.target.value })}
                    />
                  </Field>
                  <Field label="% du marché principal">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      inputMode="decimal"
                      value={st.pourcentagePart}
                      onChange={(e) => setSt({ ...st, pourcentagePart: e.target.value })}
                      placeholder="≤ 50"
                    />
                  </Field>
                  <Field label="Réf. contrat de sous-traitance">
                    <input
                      className={`${inputClass} mt-1`}
                      value={st.contratRef}
                      onChange={(e) => setSt({ ...st, contratRef: e.target.value })}
                    />
                  </Field>
                  <Field label="Date du contrat">
                    <input
                      type="date"
                      className={`${inputClass} mt-1`}
                      value={st.contratDate}
                      onChange={(e) => setSt({ ...st, contratDate: e.target.value })}
                    />
                  </Field>
                  <Field label="Délai paiement par titulaire (jours)">
                    <input
                      className={`${inputClass} mt-1 font-mono`}
                      inputMode="numeric"
                      value={st.delaiPaiementJours}
                      onChange={(e) => setSt({ ...st, delaiPaiementJours: e.target.value })}
                      placeholder="60"
                    />
                  </Field>
                  <div className="flex items-end gap-4">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={st.agrementMo}
                        onChange={(e) => setSt({ ...st, agrementMo: e.target.checked })}
                        className="h-4 w-4 accent-[var(--color-cyan)]"
                      />
                      Sous-traitance notifiée au maître d&apos;ouvrage
                    </label>
                  </div>
                  {st.agrementMo && (
                    <Field label="Date de notification">
                      <input
                        type="date"
                        className={`${inputClass} mt-1`}
                        value={st.agrementDate}
                        onChange={(e) => setSt({ ...st, agrementDate: e.target.value })}
                      />
                    </Field>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted">
                  ⚖️ CCAG-T: la sous-traitance ne peut dépasser 50 % du marché principal et doit
                  être notifiée au maître d&apos;ouvrage.
                </p>
              </div>
            </div>
          )}

          {mode === 'groupement' && (
            <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
                Groupement d&apos;entreprises
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Type de groupement *">
                  <select
                    className={`${inputClass} mt-1`}
                    value={grp.typeGroupement}
                    onChange={(e) => setGrp({ ...grp, typeGroupement: e.target.value })}
                  >
                    <option value="conjoint">Conjoint (chacun son lot)</option>
                    <option value="solidaire">Solidaire (responsabilité totale)</option>
                  </select>
                </Field>
                <Field label="Notre rôle *">
                  <select
                    className={`${inputClass} mt-1`}
                    value={grp.notreRole}
                    onChange={(e) => setGrp({ ...grp, notreRole: e.target.value })}
                  >
                    <option value="mandataire">Mandataire</option>
                    <option value="membre">Membre</option>
                  </select>
                </Field>
                {grp.notreRole === 'membre' && (
                  <Field label="Société mandataire">
                    <input
                      className={`${inputClass} mt-1`}
                      value={grp.mandataireSociete}
                      onChange={(e) => setGrp({ ...grp, mandataireSociete: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Date convention de groupement">
                  <input
                    type="date"
                    className={`${inputClass} mt-1`}
                    value={grp.conventionDate}
                    onChange={(e) => setGrp({ ...grp, conventionDate: e.target.value })}
                  />
                </Field>
                <Field label="Notre part (%)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={grp.notrePartPct}
                    onChange={(e) => setGrp({ ...grp, notrePartPct: e.target.value })}
                  />
                </Field>
                <Field label="Notre part (DH)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={grp.notrePartMad}
                    onChange={(e) => setGrp({ ...grp, notrePartMad: e.target.value })}
                  />
                </Field>
              </div>
              <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-faint">
                Membres du groupement
              </h3>
              <div className="space-y-2">
                {membres.map((m, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_100px_1fr_36px]">
                    <input
                      className={inputClass}
                      placeholder={`Société membre ${i + 1}`}
                      value={m.societe}
                      onChange={(e) =>
                        setMembres(membres.map((x, j) => (j === i ? { ...x, societe: e.target.value } : x)))
                      }
                    />
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder="ICE"
                      value={m.ice}
                      onChange={(e) =>
                        setMembres(membres.map((x, j) => (j === i ? { ...x, ice: e.target.value } : x)))
                      }
                    />
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder="%"
                      inputMode="decimal"
                      value={m.partPct}
                      onChange={(e) =>
                        setMembres(membres.map((x, j) => (j === i ? { ...x, partPct: e.target.value } : x)))
                      }
                    />
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder="Montant DH"
                      inputMode="decimal"
                      value={m.montantPartMad}
                      onChange={(e) =>
                        setMembres(
                          membres.map((x, j) => (j === i ? { ...x, montantPartMad: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setMembres(membres.filter((_, j) => j !== i))}
                      className="rounded-lg border border-line text-sm text-clay hover:bg-clay-soft"
                      aria-label="Supprimer le membre"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setMembres([...membres, { societe: '', ice: '', partPct: '', montantPartMad: '' }])
                }
                className="mt-2 text-xs font-semibold text-cyan hover:underline"
              >
                + Ajouter un membre
              </button>
            </div>
          )}

          {mode === 'marche_prive' && (
            <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
                Client privé & conditions
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Client *" span2>
                  <input
                    className={`${inputClass} mt-1`}
                    value={prive.clientNom}
                    onChange={(e) => setPrive({ ...prive, clientNom: e.target.value })}
                    placeholder="Nom / raison sociale"
                  />
                </Field>
                <Field label="ICE (si société)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    value={prive.clientIce}
                    onChange={(e) => setPrive({ ...prive, clientIce: e.target.value })}
                  />
                </Field>
                <Field label="Téléphone">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    value={prive.clientTelephone}
                    onChange={(e) => setPrive({ ...prive, clientTelephone: e.target.value })}
                  />
                </Field>
                <Field label="Adresse" span2>
                  <input
                    className={`${inputClass} mt-1`}
                    value={prive.clientAdresse}
                    onChange={(e) => setPrive({ ...prive, clientAdresse: e.target.value })}
                  />
                </Field>
                <Field label="Réf. devis">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    value={prive.devisRef}
                    onChange={(e) => setPrive({ ...prive, devisRef: e.target.value })}
                  />
                </Field>
                <Field label="Date devis">
                  <input
                    type="date"
                    className={`${inputClass} mt-1`}
                    value={prive.devisDate}
                    onChange={(e) => setPrive({ ...prive, devisDate: e.target.value })}
                  />
                </Field>
                <Field label="Réf. contrat">
                  <input
                    className={`${inputClass} mt-1`}
                    value={prive.contratRef}
                    onChange={(e) => setPrive({ ...prive, contratRef: e.target.value })}
                  />
                </Field>
                <Field label="Acompte (%)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={prive.acomptePct}
                    onChange={(e) => setPrive({ ...prive, acomptePct: e.target.value })}
                  />
                </Field>
                <Field label="Retenue garantie (%)">
                  <input
                    className={`${inputClass} mt-1 font-mono`}
                    inputMode="decimal"
                    value={prive.retenueGarantiePct}
                    onChange={(e) => setPrive({ ...prive, retenueGarantiePct: e.target.value })}
                  />
                </Field>
                <Field label="Modalités de paiement" span2>
                  <input
                    className={`${inputClass} mt-1`}
                    value={prive.modalitesPaiement}
                    onChange={(e) => setPrive({ ...prive, modalitesPaiement: e.target.value })}
                    placeholder="30% à la commande, 40% mi-chantier…"
                  />
                </Field>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-line px-5 py-2 text-sm font-semibold text-muted hover:text-ink"
            >
              ← Mode
            </button>
            <button
              type="button"
              disabled={!step2Valid}
              onClick={() => setStep(3)}
              className="rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continuer → fiche marché
            </button>
          </div>
        </section>
      )}

      {/* ── Étape 3: fiche marché ── */}
      <div className={step === 3 ? 'space-y-6' : 'hidden'}>
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Le marché
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Objet du marché *" span2>
              <textarea
                name="objet"
                required={step === 3}
                rows={3}
                placeholder="Travaux d'aménagement…"
                className={`${inputClass} mt-1 font-normal normal-case tracking-normal`}
              />
            </Field>
            <Field label="N° du marché / référence *">
              <input
                name="reference"
                required={step === 3}
                placeholder={mode === 'marche_prive' ? 'DEV-2026-…' : '07/2026/…'}
                className={`${inputClass} mt-1 font-mono`}
              />
            </Field>
            <Field label="Année *">
              <input name="annee" required={step === 3} placeholder="2026" className={`${inputClass} mt-1`} />
            </Field>
            <Field label="Type de marché">
              <select name="typeMarche" className={`${inputClass} mt-1`}>
                <option value="normal">Normal</option>
                <option value="negocie">Négocié</option>
              </select>
            </Field>
            <Field label="Commune">
              <input name="commune" className={`${inputClass} mt-1`} />
            </Field>
            <Field label="Statut initial">
              <select name="status" defaultValue="preparation" className={`${inputClass} mt-1`}>
                <option value="preparation">Préparation</option>
                <option value="en_cours">En cours</option>
              </select>
            </Field>
          </div>
        </section>

        {!nous && (
          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
              Société exécutante (nous)
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Société" span2>
                <input
                  name="societe"
                  defaultValue={entreprise.societe}
                  className={`${inputClass} mt-1`}
                />
              </Field>
              <Field label="RC">
                <input name="rc" defaultValue={entreprise.rc} className={`${inputClass} mt-1 font-mono`} />
              </Field>
              <Field label="CNSS">
                <input
                  name="cnss"
                  defaultValue={entreprise.cnss}
                  className={`${inputClass} mt-1 font-mono`}
                />
              </Field>
              <Field label="Patente">
                <input
                  name="patente"
                  defaultValue={entreprise.patente}
                  className={`${inputClass} mt-1 font-mono`}
                />
              </Field>
              <Field label="CB (compte bancaire)">
                <input name="cb" className={`${inputClass} mt-1 font-mono`} />
              </Field>
            </div>
          </section>
        )}

        {mode !== 'marche_prive' && (
          <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
              Imputation budgétaire
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Programme">
                <input name="programme" className={`${inputClass} mt-1`} />
              </Field>
              <Field label="Projet">
                <input name="projetLibelle" className={`${inputClass} mt-1`} />
              </Field>
              <Field label="Ligne">
                <input name="ligneBudgetaire" className={`${inputClass} mt-1`} />
              </Field>
              <Field label="Chapitre">
                <input name="chapitre" className={`${inputClass} mt-1`} />
              </Field>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Intervenants, dates & délai
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field
                label={
                  mode === 'marche_prive'
                    ? 'Client / donneur d’ordre'
                    : "Maître d'œuvre / Maître d'ouvrage"
                }
              >
                <input name="maitreOeuvre" list="moes" className={`${inputClass} mt-1`} />
              </Field>
              <datalist id="moes">
                {intervenants.maitreOeuvre.map((m) => (
                  <option key={m.name} value={m.name} />
                ))}
              </datalist>
            </div>
            <div>
              <Field label="Assistance technique">
                <input name="assistanceTechnique" list="ats" className={`${inputClass} mt-1`} />
              </Field>
              <datalist id="ats">
                {intervenants.assistanceTechnique.map((a) => (
                  <option key={a.name} value={a.name} />
                ))}
              </datalist>
            </div>
            <Field label="Date d'ouverture des plis">
              <input type="date" name="dateOuverture" className={`${inputClass} mt-1`} />
            </Field>
            <Field label="O.S.C (ordre de service de commencement)">
              <input type="date" name="osc" className={`${inputClass} mt-1`} />
            </Field>
            <Field label="Délai d'exécution (mois)">
              <input
                type="number"
                name="delaiMois"
                min="0.5"
                step="0.5"
                placeholder="6"
                className={`${inputClass} mt-1 font-mono`}
              />
            </Field>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-lg border border-line px-5 py-2 text-sm font-semibold text-muted hover:text-ink"
          >
            ← Détails du mode
          </button>
          <button
            type="submit"
            className="rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90"
          >
            Créer le marché
          </button>
        </div>
      </div>
    </form>
  );
}
