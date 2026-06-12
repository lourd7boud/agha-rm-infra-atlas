import type { CompetitorBidRecord, CompetitorRecord } from './intel.repository';

/**
 * Competitor Profiler (C2) — deterministic dossier built from the Result
 * Miner's observations. Published results only: the profile states what the
 * portal published, never an inference about capability or strategy.
 */

const RECENT_RESULTS_LIMIT = 5;

export interface BuyerBreakdown {
  buyerName: string;
  wins: number;
  totalMad: number;
}

export interface CompetitorProfile {
  id: string;
  canonicalName: string;
  /** Every published row recorded for this competitor (wins and losses). */
  observations: number;
  wins: number;
  totalWonMad: number;
  avgWinMad: number | null;
  minWinMad: number | null;
  maxWinMad: number | null;
  /** Buyers ranked by amount won — where this competitor is implanted. */
  buyers: BuyerBreakdown[];
  recentResults: CompetitorBidRecord[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export function buildCompetitorProfile(
  competitor: CompetitorRecord,
  bids: CompetitorBidRecord[],
): CompetitorProfile {
  const winningBids = bids.filter((b) => b.isWinner);
  const winAmounts = winningBids
    .map((b) => b.amountMad)
    .filter((amount): amount is number => amount !== undefined);

  const buyerMap = new Map<string, BuyerBreakdown>();
  for (const win of winningBids) {
    const current = buyerMap.get(win.buyerName) ?? {
      buyerName: win.buyerName,
      wins: 0,
      totalMad: 0,
    };
    buyerMap.set(win.buyerName, {
      buyerName: win.buyerName,
      wins: current.wins + 1,
      totalMad: current.totalMad + (win.amountMad ?? 0),
    });
  }

  const datedResults = bids.filter(
    (b): b is CompetitorBidRecord & { resultDate: Date } =>
      b.resultDate !== undefined,
  );
  const sortedDates = datedResults
    .map((b) => b.resultDate)
    .sort((a, b) => a.getTime() - b.getTime());

  const recentResults = [...datedResults]
    .sort((a, b) => b.resultDate.getTime() - a.resultDate.getTime())
    .slice(0, RECENT_RESULTS_LIMIT);

  const toIsoDay = (value: Date | undefined): string | null =>
    value ? value.toISOString().slice(0, 10) : null;

  return {
    id: competitor.id,
    canonicalName: competitor.canonicalName,
    observations: bids.length,
    wins: winningBids.length,
    totalWonMad: winAmounts.reduce((sum, amount) => sum + amount, 0),
    avgWinMad:
      winAmounts.length > 0
        ? winAmounts.reduce((sum, amount) => sum + amount, 0) / winAmounts.length
        : null,
    minWinMad: winAmounts.length > 0 ? Math.min(...winAmounts) : null,
    maxWinMad: winAmounts.length > 0 ? Math.max(...winAmounts) : null,
    buyers: [...buyerMap.values()].sort((a, b) => b.totalMad - a.totalMad),
    recentResults,
    firstSeen: toIsoDay(sortedDates[0]),
    lastSeen: toIsoDay(sortedDates[sortedDates.length - 1]),
  };
}
