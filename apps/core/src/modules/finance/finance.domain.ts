/**
 * Finance division v1 — pure treasury arithmetic over existing data:
 * - cautions: cash locked at banks (provisoire / définitive / retenue)
 * - receivables: validated décomptes awaiting payment (TGR délais)
 */

const MS_PER_DAY = 86_400_000;
/** Active guarantee older than this is worth chasing for release. */
const STALE_CAUTION_DAYS = 365;

export type CautionKind = 'provisoire' | 'definitive' | 'retenue_remplacee';
export type CautionStatus = 'active' | 'liberee';

export interface CautionView {
  kind: CautionKind;
  amountMad: number;
  issuedAt: Date;
  status: CautionStatus;
}

export interface CautionSummary {
  activeCount: number;
  activeTotalMad: number;
  byKind: Record<CautionKind, number>;
  staleCount: number;
  staleTotalMad: number;
}

export function summarizeCautions(
  cautions: CautionView[],
  today: Date,
): CautionSummary {
  const active = cautions.filter((c) => c.status === 'active');
  const stale = active.filter(
    (c) => (today.getTime() - c.issuedAt.getTime()) / MS_PER_DAY > STALE_CAUTION_DAYS,
  );
  const byKind: Record<CautionKind, number> = {
    provisoire: 0,
    definitive: 0,
    retenue_remplacee: 0,
  };
  for (const c of active) byKind[c.kind] += c.amountMad;

  return {
    activeCount: active.length,
    activeTotalMad: active.reduce((sum, c) => sum + c.amountMad, 0),
    byKind,
    staleCount: stale.length,
    staleTotalMad: stale.reduce((sum, c) => sum + c.amountMad, 0),
  };
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface ReceivableInput {
  projectReference: string;
  buyerName: string;
  numero: number;
  netAPayerMad: number;
  periodEnd: Date;
  status: string;
}

export interface ReceivableItem extends ReceivableInput {
  daysOutstanding: number;
  bucket: AgingBucket;
}

export interface Receivables {
  items: ReceivableItem[];
  totalMad: number;
  aging: Record<AgingBucket, number>;
}

function bucketFor(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function buildReceivables(
  situations: ReceivableInput[],
  today: Date,
): Receivables {
  const items = situations
    .filter((s) => s.status === 'valide')
    .map((s) => {
      const daysOutstanding = Math.max(
        0,
        Math.floor((today.getTime() - s.periodEnd.getTime()) / MS_PER_DAY),
      );
      return { ...s, daysOutstanding, bucket: bucketFor(daysOutstanding) };
    })
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding);

  const aging: Record<AgingBucket, number> = {
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  for (const item of items) aging[item.bucket] += item.netAPayerMad;

  return {
    items,
    totalMad: items.reduce((sum, item) => sum + item.netAPayerMad, 0),
    aging,
  };
}
