// Nouveau marché — wizard en 3 étapes: 1) comment avons-nous obtenu ce
// marché (adjudicataire direct, bon de commande ≤500k DH, sous-traitance,
// groupement, marché privé), 2) les champs propres au mode (notre société
// auto-remplie quand NOUS sommes l'attributaire), 3) la fiche marché.
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { BtpProject, Intervenants, NotreEntreprise } from '@/lib/btp';
import { NewMarcheWizard } from './NewMarcheWizard';
import { reviewedSourceBordereau, type BtpProjectSource } from '@/lib/btp-source';

export const metadata = { title: 'Nouveau marché — ATLAS' };

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export default async function NewProjectPage({ searchParams }: {
  searchParams: Promise<{ tenderId?: string; error?: string }>;
}) {
  const query = await searchParams;
  const creationId = randomUUID();
  let source: BtpProjectSource | undefined;
  let sourceError = false;
  if (query.tenderId) {
    try {
      source = await apiGet<BtpProjectSource>(`/btp/project-source/${encodeURIComponent(query.tenderId)}`);
    } catch {
      sourceError = true;
    }
  }
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
      if (sourceError) redirect('/projects/new?error=source');
      if (source && formData.get('sourceReviewed') !== 'on') throw new Error('Source non revue');
      if (source) {
        const current = await apiGet<BtpProjectSource>(`/btp/project-source/${source.tenderId}`);
        if (current.sourceVersion !== source.sourceVersion) {
          redirect(`/projects/new?tenderId=${source.tenderId}&error=source-changed`);
        }
      }
      created = await apiPost<BtpProject>('/btp/projects', {
        creationId,
        tenderId: source?.tenderId,
        dateLimiteRemiseOffres: source?.dateLimite ?? field(formData, 'dateLimiteRemiseOffres'),
        bordereau: source ? reviewedSourceBordereau(formData, source) : undefined,
        reference: field(formData, 'reference') ?? '',
        name:
          (field(formData, 'objet') ?? '').slice(0, 180) || (field(formData, 'reference') ?? ''),
        objet: field(formData, 'objet'),
        buyerName: field(formData, 'buyerName'),
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
      redirect(`/projects/new?${source ? `tenderId=${source.tenderId}&` : ''}error=${code}`);
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
      {(sourceError || query.error) && <p role="alert" className="mt-4 rounded-lg border border-clay/30 bg-clay-soft p-3 text-sm text-clay">
        {sourceError || query.error === 'source'
          ? 'La consultation source est indisponible. Revenez à la fiche de consultation pour réessayer.'
          : query.error === 'source-changed'
            ? 'La source a changé. Relisez les données actualisées avant de créer le marché.'
            : 'Le marché n’a pas été créé. Vérifiez les champs obligatoires et les valeurs du BPU.'}
      </p>}
      {!sourceError && <NewMarcheWizard
        action={createProject}
        intervenants={intervenants}
        entreprise={entreprise}
        source={source}
      />}
    </div>
  );
}
