// Fiche d'un avis d'achat — l'atelier de l'agent chargé: fiche portail,
// pièces jointes, et le chiffrage article par article (BdcPricer).
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  BDC_STATUT_BADGES,
  joursRestants,
  PORTAL_BDC_BASE,
  REPONSE_STATUT_BADGES,
  type BdcAvis,
  type BdcReponse,
} from '@/lib/bdc';
import { creerReponse, setReponseStatut } from '../actions';
import { BdcPricer } from './BdcPricer';

export const metadata = { title: 'Bon de commande — ATLAS' };

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function BdcDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { avis, reponse } = await apiGet<{ avis: BdcAvis; reponse: BdcReponse | null }>(
    `/bdc/avis/${id}`,
  );
  const badge = BDC_STATUT_BADGES[avis.statut] ?? {
    label: avis.statut,
    classes: 'bg-sand text-muted',
  };
  const agent = reponse ? (REPONSE_STATUT_BADGES[reponse.statut] ?? null) : null;
  const jours = joursRestants(avis.dateLimite);
  const portalUrl = `${PORTAL_BDC_BASE}/bdc/entreprise/consultation/show/${avis.portalId}`;

  return (
    <div className="px-6 py-8 lg:px-10">
      <Link href="/tenders/bc" className="text-xs font-semibold text-muted hover:text-cyan">
        ← Bons de commande
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-black tracking-tight text-cyan">
              {avis.reference}
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
              {badge.label}
            </span>
            {jours !== null && jours >= 0 && (
              <span
                className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
                  jours <= 3
                    ? 'bg-clay-soft text-clay'
                    : jours <= 7
                      ? 'bg-ochre-soft text-ochre'
                      : 'bg-emerald-soft text-emerald'
                }`}
              >
                J-{jours}
              </span>
            )}
            {agent && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${agent.classes}`}>
                🤖 {agent.label}
              </span>
            )}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted">{avis.objet}</p>
        </div>
        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cyan hover:text-cyan"
        >
          Ouvrir sur le portail ↗
        </a>
      </div>

      {/* Fiche */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Acheteur public', value: avis.acheteur },
          { label: 'Date limite des devis', value: fmtDateTime(avis.dateLimite) },
          { label: "Lieu d'exécution", value: avis.lieu ?? '—' },
          {
            label: 'Catégorie · Nature',
            value: `${avis.categorie ?? '—'}${avis.naturePrestation ? ` · ${avis.naturePrestation}` : ''}`,
          },
        ].map((f) => (
          <div
            key={f.label}
            className="rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              {f.label}
            </p>
            <p className="mt-1 truncate text-sm font-semibold" title={f.value}>
              {f.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pièces jointes */}
      {avis.pieces.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Pièces jointes
          </span>
          {avis.pieces.map((piece) => (
            <a
              key={piece.downloadPath}
              href={`${PORTAL_BDC_BASE}${piece.downloadPath}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-cyan hover:border-cyan"
            >
              📎 {piece.label}
            </a>
          ))}
        </div>
      )}

      {/* Atelier de chiffrage */}
      <div className="mt-8">
        {avis.articles.length === 0 ? (
          <div className="rounded-xl border border-line bg-paper-2 p-8 text-center">
            <p className="font-semibold">Articles pas encore importés</p>
            <p className="mt-1 text-sm text-muted">
              Lancez une synchronisation depuis la liste — le détail de cet avis sera complété.
            </p>
          </div>
        ) : reponse ? (
          <>
            <BdcPricer avis={avis} reponse={reponse} />
            {/* Pipeline de statut */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-faint">
                Statut de la réponse
              </span>
              {(['prete', 'deposee', 'gagnee', 'perdue'] as const).map((statut) => (
                <form key={statut} action={setReponseStatut}>
                  <input type="hidden" name="avisId" value={avis.id} />
                  <input type="hidden" name="statut" value={statut} />
                  <button
                    type="submit"
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      reponse.statut === statut
                        ? (REPONSE_STATUT_BADGES[statut]?.classes ?? 'bg-sand text-muted')
                        : 'border border-line text-muted hover:text-ink'
                    }`}
                  >
                    {REPONSE_STATUT_BADGES[statut]?.label ?? statut}
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              ℹ️ Le dépôt se fait sur le portail (connexion avec le compte société), muni du
              bordereau XLSX généré — l&apos;agent prépare, vous validez et déposez.
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-cyan/40 bg-cyan-soft/10 p-8 text-center">
            <p className="text-lg font-bold">🤖 Confier cet avis à l&apos;agent chargé</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-muted">
              L&apos;agent crée l&apos;espace de chiffrage à partir des {avis.articles.length}{' '}
              article(s) structurés de l&apos;avis: prix par article, marge, totaux et bordereau
              XLSX prêt à déposer.
            </p>
            <form action={creerReponse} className="mt-4">
              <input type="hidden" name="avisId" value={avis.id} />
              <button
                type="submit"
                className="rounded-lg bg-cyan px-6 py-2.5 text-sm font-bold text-paper transition hover:opacity-90"
              >
                Lancer le chiffrage
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
