import Link from 'next/link';
import type { TenderProcedure } from '@atlas/contracts';
import { apiGet } from '@/lib/api';
import { BuyerAvatar } from '@/components/ui/BuyerAvatar';
import { Icon } from '@/components/ui/Icon';
import { PROCEDURE_LABELS } from '@/lib/labels';

interface CountEntry {
  key: string;
  count: number;
}

interface BuyerProfile {
  buyerName: string;
  region: string;
  tenderCount: number;
  activeCount: number;
  procedures: CountEntry[];
  topSegments: CountEntry[];
  withEstimationCount: number;
  avgEstimationMad: number | null;
  firstDeadline: string | null;
  lastDeadline: string | null;
}

const SEGMENT_LABELS: Record<string, string> = {
  irrigation: 'Irrigation',
  eau_potable: 'Eau potable',
  assainissement: 'Assainissement',
  barrage: 'Barrages & digues',
  forage: 'Forages & puits',
  routes: 'Routes & voirie',
  electricite: 'Électrification',
  batiment: 'Bâtiment',
  genie_civil: 'Génie civil',
  etudes: 'Études & MOE',
  fourniture: 'Fournitures',
  autre: 'Autre',
};

function segmentLabel(key: string): string {
  return SEGMENT_LABELS[key] ?? key;
}

export default async function BuyersPage() {
  const buyers = await apiGet<BuyerProfile[]>('/tender/buyers');
  const totalTenders = buyers.reduce((sum, b) => sum + b.tenderCount, 0);
  const located = buyers.filter((b) => b.region !== 'Non localisé').length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight">
            Observatoire des Acheteurs
          </h1>
          <p className="mt-1 text-sm text-muted">
            Le côté <span className="text-ink">demande</span> du marché —{' '}
            <span className="font-semibold text-ink">{buyers.length}</span>{' '}
            acheteurs · {totalTenders} appels d&apos;offres observés · {located}{' '}
            localisés
          </p>
        </div>
        <Link
          href="/tenders"
          className="flex items-center gap-1.5 rounded-md border border-line-2 bg-paper-2 px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          <Icon name="tenders" size={15} />
          Inventaire des marchés
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {buyers.map((buyer) => (
          <article
            key={buyer.buyerName}
            className="flex flex-col rounded-xl border border-line bg-paper-2 p-4 shadow-card transition hover:border-line-2"
          >
            <div className="flex items-start gap-3">
              <BuyerAvatar name={buyer.buyerName} size="md" />
              <h2 className="line-clamp-2 flex-1 text-sm font-semibold leading-snug text-ink">
                {buyer.buyerName}
              </h2>
              <span className="shrink-0 rounded-md bg-cyan-soft/60 px-2 py-1 font-mono text-sm font-bold tabular-nums text-cyan">
                {buyer.tenderCount}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-1 text-xs text-faint">
              <Icon name="pin" size={11} />
              {buyer.region}
              {buyer.activeCount > 0 && (
                <span className="ml-auto text-emerald">
                  {buyer.activeCount} actif{buyer.activeCount > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {buyer.topSegments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {buyer.topSegments.slice(0, 3).map((seg) => (
                  <span
                    key={seg.key}
                    className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-medium text-muted"
                  >
                    {segmentLabel(seg.key)}
                    <span className="ml-1 text-faint">{seg.count}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
              <div className="flex flex-wrap gap-1">
                {buyer.procedures.slice(0, 3).map((proc) => (
                  <span
                    key={proc.key}
                    className="rounded bg-rail-2/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint"
                    title={PROCEDURE_LABELS[proc.key as TenderProcedure] ?? proc.key}
                  >
                    {proc.key}
                  </span>
                ))}
              </div>
              <div className="text-right">
                {buyer.avgEstimationMad != null ? (
                  <>
                    <div className="font-mono text-xs font-semibold tabular-nums text-ink">
                      {Math.round(buyer.avgEstimationMad).toLocaleString('fr-MA')}
                    </div>
                    <div className="text-[10px] text-faint">est. moy. MAD</div>
                  </>
                ) : (
                  <div className="text-[10px] text-faint/70">estimation —</div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {buyers.length === 0 && (
        <p className="rounded-xl border border-line bg-paper-2 p-10 text-center text-muted">
          Aucun acheteur observé pour le moment.
        </p>
      )}
    </div>
  );
}
