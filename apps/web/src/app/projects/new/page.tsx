// Nouveau marché — the full fiche form (identique au système source: type,
// objet, n° marché, année, commune, société + identité administrative,
// imputation budgétaire, intervenants, dates & délai). montant reste à 0 —
// il naît du bordereau.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { BtpProject, Intervenants } from '@/lib/btp';

export const metadata = { title: 'Nouveau marché — ATLAS' };

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export default async function NewProjectPage() {
  const intervenants = await apiGet<Intervenants>('/btp/projects/intervenants').catch(
    () => ({ assistanceTechnique: [], maitreOeuvre: [], societes: [] }) as Intervenants,
  );

  async function createProject(formData: FormData) {
    'use server';
    let created: BtpProject;
    try {
      created = await apiPost<BtpProject>('/btp/projects', {
        reference: field(formData, 'reference') ?? '',
        name:
          (field(formData, 'objet') ?? '').slice(0, 180) || (field(formData, 'reference') ?? ''),
        objet: field(formData, 'objet'),
        buyerName: field(formData, 'maitreOeuvre'),
        annee: field(formData, 'annee'),
        societe: field(formData, 'societe'),
        commune: field(formData, 'commune'),
        typeMarche: field(formData, 'typeMarche'),
        modePassation: field(formData, 'modePassation'),
        rc: field(formData, 'rc'),
        cb: field(formData, 'cb'),
        cnss: field(formData, 'cnss'),
        patente: field(formData, 'patente'),
        programme: field(formData, 'programme'),
        projetLibelle: field(formData, 'projetLibelle'),
        ligneBudgetaire: field(formData, 'ligneBudgetaire'),
        chapitre: field(formData, 'chapitre'),
        assistanceTechnique: field(formData, 'assistanceTechnique'),
        maitreOeuvre: field(formData, 'maitreOeuvre'),
        dateOuverture: field(formData, 'dateOuverture'),
        ordreServiceDate: field(formData, 'osc'),
        delaiMois: field(formData, 'delaiMois') ? Number(field(formData, 'delaiMois')) : undefined,
        status: field(formData, 'status'),
      });
    } catch (error) {
      if (isRedirectError(error)) throw error;
      const code = error instanceof AtlasApiError && error.status === 400 ? 'invalid' : 'failed';
      redirect(`/projects/new?error=${code}`);
    }
    redirect(`/projects/${created.id}?tab=bordereau&created=1`);
  }

  const inputClass =
    'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-widest text-faint';

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Retour aux marchés
      </Link>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Nouveau marché</h1>
      <p className="mt-1 text-sm text-muted">
        Le montant du marché sera calculé automatiquement à partir du bordereau des prix.
      </p>

      <form action={createProject} className="mt-8 max-w-4xl space-y-6">
        {/* Marché */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Le marché
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Objet du marché *
                <textarea
                  name="objet"
                  required
                  rows={3}
                  placeholder="Travaux d'aménagement…"
                  className={`${inputClass} mt-1 font-normal normal-case tracking-normal`}
                />
              </label>
            </div>
            <label className={labelClass}>
              N° du marché *
              <input
                name="reference"
                required
                placeholder="07/2026/…"
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
            <label className={labelClass}>
              Année *
              <input name="annee" required placeholder="2026" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Type de marché
              <select name="typeMarche" className={`${inputClass} mt-1`}>
                <option value="normal">Normal</option>
                <option value="negocie">Négocié</option>
              </select>
            </label>
            <label className={labelClass}>
              Mode de passation
              <input
                name="modePassation"
                placeholder="Appel d'offres ouvert…"
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className={labelClass}>
              Commune
              <input name="commune" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Statut initial
              <select name="status" defaultValue="preparation" className={`${inputClass} mt-1`}>
                <option value="preparation">Préparation</option>
                <option value="en_cours">En cours</option>
              </select>
            </label>
          </div>
        </section>

        {/* Société attributaire */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Société attributaire
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Société
                <input name="societe" list="societes" className={`${inputClass} mt-1`} />
              </label>
              <datalist id="societes">
                {intervenants.societes.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </div>
            <label className={labelClass}>
              RC
              <input name="rc" className={`${inputClass} mt-1 font-mono`} />
            </label>
            <label className={labelClass}>
              CB (compte bancaire)
              <input name="cb" className={`${inputClass} mt-1 font-mono`} />
            </label>
            <label className={labelClass}>
              CNSS
              <input name="cnss" className={`${inputClass} mt-1 font-mono`} />
            </label>
            <label className={labelClass}>
              Patente
              <input name="patente" className={`${inputClass} mt-1 font-mono`} />
            </label>
          </div>
        </section>

        {/* Imputation budgétaire */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Imputation budgétaire
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Programme
              <input name="programme" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Projet
              <input name="projetLibelle" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Ligne
              <input name="ligneBudgetaire" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Chapitre
              <input name="chapitre" className={`${inputClass} mt-1`} />
            </label>
          </div>
        </section>

        {/* Intervenants & délais */}
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan">
            Intervenants, dates & délai
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Maître d&apos;œuvre / Maître d&apos;ouvrage
                <input name="maitreOeuvre" list="moes" className={`${inputClass} mt-1`} />
              </label>
              <datalist id="moes">
                {intervenants.maitreOeuvre.map((m) => (
                  <option key={m.name} value={m.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>
                Assistance technique
                <input name="assistanceTechnique" list="ats" className={`${inputClass} mt-1`} />
              </label>
              <datalist id="ats">
                {intervenants.assistanceTechnique.map((a) => (
                  <option key={a.name} value={a.name} />
                ))}
              </datalist>
            </div>
            <label className={labelClass}>
              Date d&apos;ouverture des plis
              <input type="date" name="dateOuverture" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              O.S.C (ordre de service de commencement)
              <input type="date" name="osc" className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              Délai d&apos;exécution (mois)
              <input
                type="number"
                name="delaiMois"
                min="0.5"
                step="0.5"
                placeholder="6"
                className={`${inputClass} mt-1 font-mono`}
              />
            </label>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90"
          >
            Créer le marché
          </button>
          <Link href="/projects" className="text-sm font-semibold text-muted hover:text-ink">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
