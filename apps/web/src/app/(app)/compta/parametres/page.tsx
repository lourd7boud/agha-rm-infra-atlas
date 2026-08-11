// Paramètres fiscaux — profil légal/fiscal complet de la société (pilote les
// calculs IS/CM/TVA et la fiche légale) + gestion des exercices comptables.
import { apiGet } from '@/lib/api';
import { fmtMad, type ComptaProfil, type Exercice } from '@/lib/compta';
import { createExercice, setExerciceStatut, updateProfil } from '../actions';
import { ComptaHeader, SectionCard, StatusBanners, StatutBadge, inputClass } from '../ui';

export const metadata = { title: 'Paramètres fiscaux — Comptabilité ATLAS' };

export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; code?: string }>;
}) {
  const params = await searchParams;
  const [profil, exercices] = await Promise.all([
    apiGet<ComptaProfil>('/compta/profil'),
    apiGet<Exercice[]>('/compta/exercices'),
  ]);

  const champ = (
    name: keyof ComptaProfil,
    label: string,
    options?: { type?: string; placeholder?: string; mono?: boolean },
  ) => (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
      {label}
      <input
        name={name}
        type={options?.type ?? 'text'}
        defaultValue={
          profil[name] === null || profil[name] === undefined
            ? ''
            : options?.type === 'date'
              ? String(profil[name]).slice(0, 10)
              : String(profil[name])
        }
        placeholder={options?.placeholder}
        className={`${inputClass} ${options?.mono ? 'font-mono' : ''}`}
      />
    </label>
  );

  return (
    <div>
      <ComptaHeader
        title="Paramètres fiscaux"
        subtitle="Le profil pilote tous les calculs (taux IS, cotisation minimale, régime TVA) et la fiche légale affichée au tableau de bord."
      />
      <StatusBanners searchParams={params} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard title="Profil de la société">
            <form action={updateProfil} className="space-y-4 px-5 py-4">
              <input type="hidden" name="backTo" value="/compta/parametres" />
              <div className="grid gap-3 sm:grid-cols-3">
                {champ('raisonSociale', 'Raison sociale')}
                {champ('formeJuridique', 'Forme juridique', { placeholder: 'SARL' })}
                {champ('capitalSocial', 'Capital social (MAD)', { mono: true })}
                {champ('registreCommerce', 'Registre de commerce', { mono: true })}
                {champ('identifiantFiscal', 'Identifiant fiscal (IF)', { mono: true })}
                {champ('ice', 'ICE', { mono: true })}
                {champ('taxeProfessionnelle', 'N° taxe professionnelle', { mono: true })}
                {champ('cnssAffiliation', 'Affiliation CNSS', { mono: true })}
                {champ('gerant', 'Gérant')}
                {champ('adresse', 'Adresse')}
                {champ('ville', 'Ville')}
                {champ('dateCreation', 'Date de création', { type: 'date', mono: true })}
              </div>

              <div className="rounded-lg border border-line bg-sand/30 p-4">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted">
                  Régime fiscal — pilote les calculs
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                    Régime TVA
                    <select name="regimeTva" defaultValue={profil.regimeTva} className={inputClass}>
                      <option value="mensuel">Mensuel (CA ≥ 1 M MAD)</option>
                      <option value="trimestriel">Trimestriel</option>
                    </select>
                  </label>
                  {champ('tauxIs', 'Taux IS (%)', { mono: true })}
                  {champ('tauxCotisationMinimale', 'Taux CM (%)', { mono: true })}
                  {champ('prorataTva', 'Prorata TVA (%)', { mono: true })}
                  {champ('effectif', 'Effectif', { mono: true })}
                  <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-muted">
                    <input
                      type="checkbox"
                      name="assujettiTp"
                      defaultChecked={profil.assujettiTp}
                      className="h-4 w-4"
                    />
                    Assujettie à la taxe professionnelle
                  </label>
                  {champ('exonerationTpJusquau', 'Exonération TP jusqu’au', {
                    type: 'date',
                    mono: true,
                  })}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Notes internes
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={profil.notes ?? ''}
                  className={`${inputClass} resize-y`}
                />
              </label>

              <button className="rounded-lg bg-cyan px-5 py-2.5 text-sm font-bold text-paper hover:opacity-90">
                Enregistrer le profil
              </button>
            </form>
          </SectionCard>
        </div>

        <div>
          <SectionCard
            title="Exercices comptables"
            subtitle="La clôture fige le résultat net calculé et verrouille la saisie."
          >
            <ul className="divide-y divide-line">
              {exercices.map((exercice) => (
                <li key={exercice.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="font-mono text-sm font-bold tabular-nums">{exercice.annee}</span>
                  <StatutBadge statut={exercice.statut} />
                  {exercice.resultatNet !== null && (
                    <span className="font-mono text-xs tabular-nums text-muted">
                      {fmtMad(exercice.resultatNet)}
                    </span>
                  )}
                  <form action={setExerciceStatut} className="ml-auto">
                    <input type="hidden" name="annee" value={exercice.annee} />
                    <input
                      type="hidden"
                      name="statut"
                      value={exercice.statut === 'ouvert' ? 'cloture' : 'ouvert'}
                    />
                    <input type="hidden" name="backTo" value="/compta/parametres" />
                    <button
                      className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                        exercice.statut === 'ouvert'
                          ? 'bg-sand text-muted hover:bg-line'
                          : 'bg-cyan-soft/50 text-cyan'
                      }`}
                    >
                      {exercice.statut === 'ouvert' ? 'Clôturer' : 'Rouvrir'}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={createExercice} className="flex gap-2 border-t border-line px-5 py-3">
              <input type="hidden" name="backTo" value="/compta/parametres" />
              <input
                name="annee"
                required
                inputMode="numeric"
                placeholder="Année (ex. 2024)"
                className={`${inputClass} flex-1 font-mono`}
              />
              <button className="rounded-lg bg-sand px-3 py-2 text-sm font-bold text-ink-2 hover:bg-line">
                Ouvrir
              </button>
            </form>
          </SectionCard>

          <div className="mt-6 rounded-xl border border-cyan-soft/60 bg-cyan-soft/10 p-4 text-xs leading-relaxed text-muted">
            <p className="mb-1 font-bold text-ink-2">Accès comptables externes</p>
            Le rôle Keycloak <code className="font-mono text-cyan">comptable</code> donne accès à
            toute cette section (et rien d'autre) — demandez à l'administrateur de créer un compte
            pour votre fiduciaire.
          </div>
        </div>
      </div>
    </div>
  );
}
