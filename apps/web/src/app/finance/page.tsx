import { apiGet } from '@/lib/api';
import { fmtMad } from '@/lib/projects';

interface CautionItem {
  id: string;
  kind: 'provisoire' | 'definitive' | 'retenue_remplacee';
  reference: string;
  amountMad: number;
  bankName?: string;
  issuedAt: string;
  status: 'active' | 'liberee';
}

interface CautionsResponse {
  summary: {
    activeCount: number;
    activeTotalMad: number;
    byKind: Record<CautionItem['kind'], number>;
    staleCount: number;
    staleTotalMad: number;
  };
  items: CautionItem[];
}

interface ReceivableItem {
  projectReference: string;
  buyerName: string;
  numero: number;
  netAPayerMad: number;
  periodEnd: string;
  daysOutstanding: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
}

interface ReceivablesResponse {
  items: ReceivableItem[];
  totalMad: number;
  aging: Record<ReceivableItem['bucket'], number>;
}

const KIND_LABELS: Record<CautionItem['kind'], string> = {
  provisoire: 'Provisoire',
  definitive: 'Définitive',
  retenue_remplacee: 'Retenue remplacée',
};

const BUCKET_TONES: Record<ReceivableItem['bucket'], string> = {
  '0-30': 'bg-emerald-soft text-emerald',
  '31-60': 'bg-ochre-soft text-ochre',
  '61-90': 'bg-ochre-soft text-ochre-deep',
  '90+': 'bg-clay-soft text-clay',
};

export default async function FinancePage() {
  const [cautions, receivables] = await Promise.all([
    apiGet<CautionsResponse>('/finance/cautions'),
    apiGet<ReceivablesResponse>('/finance/receivables'),
  ]);

  const cards = [
    {
      label: 'Cautions actives (cash bloqué)',
      value: fmtMad(cautions.summary.activeTotalMad),
      hint: `${cautions.summary.activeCount} caution(s) en banque`,
    },
    {
      label: 'À encaisser (décomptes validés)',
      value: fmtMad(receivables.totalMad),
      hint: `${receivables.items.length} décompte(s) en attente TGR`,
    },
    {
      label: 'Retard +60 jours',
      value: fmtMad(receivables.aging['61-90'] + receivables.aging['90+']),
      hint: 'à relancer en priorité',
    },
    {
      label: 'Cautions à libérer (>1 an)',
      value: fmtMad(cautions.summary.staleTotalMad),
      hint: `${cautions.summary.staleCount} mainlevée(s) à demander`,
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Trésorerie</h1>
        <p className="mt-1 text-sm text-muted">
          Cash bloqué en garanties et créances sur décomptes validés
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              {card.label}
            </p>
            <p className="mt-2 font-mono text-lg font-bold tabular-nums">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-faint">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Créances — décomptes validés non payés
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Marché</th>
                <th className="px-4 py-3">N°</th>
                <th className="px-4 py-3 text-right">Net à payer</th>
                <th className="px-4 py-3 text-right">Retard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {receivables.items.map((item) => (
                <tr key={`${item.projectReference}-${item.numero}`}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{item.projectReference}</span>
                    <span className="block text-xs text-faint">
                      {item.buyerName}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{item.numero}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMad(item.netAPayerMad)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${BUCKET_TONES[item.bucket]}`}
                    >
                      {item.daysOutstanding}j
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {receivables.items.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucune créance en attente.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Registre des cautions
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Montant</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cautions.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{item.reference}</span>
                    {item.bankName && (
                      <span className="block text-xs text-faint">
                        {item.bankName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {KIND_LABELS[item.kind]}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtMad(item.amountMad)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.status === 'active'
                          ? 'bg-ochre-soft text-ochre'
                          : 'bg-emerald-soft text-emerald'
                      }`}
                    >
                      {item.status === 'active' ? 'Bloquée' : 'Libérée'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cautions.items.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucune caution enregistrée.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
