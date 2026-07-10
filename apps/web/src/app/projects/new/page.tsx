// Nouveau marché — wizard en 3 étapes: 1) comment avons-nous obtenu ce
// marché (adjudicataire direct, bon de commande ≤500k DH, sous-traitance,
// groupement, marché privé), 2) les champs propres au mode (notre société
// auto-remplie quand NOUS sommes l'attributaire), 3) la fiche marché.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { BtpProject, Intervenants, NotreEntreprise } from '@/lib/btp';
import { NewMarcheWizard } from './NewMarcheWizard';

export const metadata = { title: 'Nouveau marché — ATLAS' };

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export default async function NewProjectPage() {
  const [intervenants, entrepriseInfo] = await Promise.all([
    apiGet<Intervenants>('/btp/projects/intervenants').catch(
      () => ({ assistanceTechnique: [], maitreOeuvre: [], societes: [] }) as Intervenants,
    ),
    apiGet<{ entreprise: NotreEntreprise }>('/btp/notre-entreprise').catch(() => null),
  ]);
  const entreprise: NotreEntreprise = entrepriseInfo?.entreprise ?? {
    societe: 'AGHA RM INFRA',
    formeJuridique: 'SARL AU',
    rc: '20823',
    cnss: '6984871',
    patente: '19280379',
    identifiantFiscal: '73070479',
    ice: '003939552000065',
    siege: 'Boudnib',
  };

  async function createProject(formData: FormData) {
    'use server';
    let created: BtpProject;
    let acquisition: Record<string, unknown> = {};
    const rawAcquisition = field(formData, 'acquisition');
    if (rawAcquisition) {
      try {
        acquisition = JSON.parse(rawAcquisition) as Record<string, unknown>;
      } catch {
        redirect('/projects/new?error=invalid');
      }
    }
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
        modeObtention: field(formData, 'modeObtention') ?? 'ao_direct',
        acquisition,
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

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/projects" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Retour aux marchés
      </Link>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Nouveau marché</h1>
      <p className="mt-1 text-sm text-muted">
        Choisissez d&apos;abord comment la société a obtenu ce marché — chaque mode a ses
        champs. Le montant naîtra du bordereau des prix.
      </p>
      <NewMarcheWizard
        action={createProject}
        intervenants={intervenants}
        entreprise={entreprise}
      />
    </div>
  );
}
