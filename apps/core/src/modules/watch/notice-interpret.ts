import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  NOTICE_REPOSITORY,
  type NoticeRecord,
  type NoticeRepository,
} from '../intel/notice.repository';
import { UNKNOWN_BUYER_LABEL } from '../intel/rebate.domain';
import { parseResultNoticeJson } from './result.parser';
import { RESULT_VISION_PROMPT } from './result.crawler';
import { EXTRAIT_PV_VISION_PROMPT, parseExtraitPvJson } from './pv.parser';

/**
 * Notice INTERPRETATION pipeline — turns archived OCR text into competitor
 * bids. Deterministic regex first (the résultat-définitif layout is highly
 * templated — zero LLM cost), LLM fallback for PVs and free-form notices.
 * A transport-level LLM failure (daily 402 cap, 5xx) STOPS the batch and
 * leaves the remaining rows 'acquired' — they are retried on the next run,
 * nothing is ever lost or double-charged.
 */

/** Plausible bid amount band (MAD) — mirrors the rebate outlier guard. */
const MIN_PLAUSIBLE_MAD = 1_000;
const MAX_PLAUSIBLE_MAD = 5_000_000_000;

export interface DeterministicResult {
  attributaire: string;
  acheteur: string | null;
  montantMad: number;
  estimationMad: number | null;
  objet: string | null;
}

/** "1 234 567,89" / "1.234.567,89" / "1234567.89" → 1234567.89 (or null). */
export function parseFrMoney(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, '').replace(/(?:DH|DHS|MAD)$/i, '');
  let normalized: string;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    // French: dots/spaces are thousands, the comma is the decimal.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // The dot is decimal ONLY when it looks like one (≤2 trailing digits).
    const decimals = cleaned.length - lastDot - 1;
    normalized =
      decimals <= 2
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(/[.,]/g, '');
  } else {
    normalized = cleaned;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value >= MIN_PLAUSIBLE_MAD && value <= MAX_PLAUSIBLE_MAD ? value : null;
}

const pickLine = (text: string, re: RegExp): string | null => {
  const m = re.exec(text);
  if (!m?.[1]) return null;
  const value = m[1].replace(/\s+/g, ' ').replace(/[.;:,]\s*$/, '').trim();
  return value.length >= 3 ? value : null;
};

/**
 * Conservative deterministic read of a résultat-définitif notice. Returns
 * null unless BOTH the attributaire and a plausible montant are matched —
 * anything less falls through to the LLM. Never guesses.
 */
export function parseNoticeDeterministic(
  ocrText: string,
): DeterministicResult | null {
  const text = ocrText.replace(/\r/g, '');
  const attributaire = pickLine(
    text,
    /attributaire(?:\s+du\s+march[eé])?\s*[:\-]\s*([^\n]{3,140})/i,
  );
  const montantRaw = pickLine(
    text,
    /montant(?:\s+de\s+l['’ ]offre)?(?:\s+(?:retenue?|attribu[eé]e?|du\s+march[eé]))?\s*(?:\(?(?:TTC|T\.T\.C\.?|HT)\)?)?\s*[:\-]\s*([\d][\d\s.,]{3,24})/i,
  );
  const montantMad = montantRaw ? parseFrMoney(montantRaw) : null;
  if (!attributaire || montantMad === null) return null;

  const estimationRaw = pickLine(
    text,
    /estimation(?:\s+administrative)?(?:\s+du\s+ma[iî]tre\s+d['’ ]ouvrage)?\s*(?:\(?(?:TTC|T\.T\.C\.?|HT)\)?)?\s*[:\-]\s*([\d][\d\s.,]{3,24})/i,
  );
  return {
    attributaire,
    acheteur: pickLine(
      text,
      /(?:acheteur(?:\s+public)?|ma[iî]tre\s+d['’ ]ouvrage)\s*[:\-]\s*([^\n]{3,140})/i,
    ),
    montantMad,
    estimationMad: estimationRaw ? parseFrMoney(estimationRaw) : null,
    objet: pickLine(text, /objet(?:\s+du\s+march[eé])?\s*[:\-]\s*([^\n]{5,240})/i),
  };
}

export interface InterpretSummary {
  scanned: number;
  deterministic: number;
  viaLlm: number;
  bidsStored: number;
  unreadable: number;
  /** Transport-level LLM failure stopped the batch early. */
  stopped: boolean;
}

export interface InterpretOptions {
  limit?: number;
  /** Interpret only this annonce type ('4' | '5'); default both. */
  annonceType?: '4' | '5';
}

@Injectable()
export class NoticeInterpretService {
  private readonly logger = new Logger('NoticeInterpret');

  constructor(
    @Inject(NOTICE_REPOSITORY) private readonly notices: NoticeRepository,
    @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null = null,
  ) {}

  async interpretOnce(opts: InterpretOptions = {}): Promise<InterpretSummary> {
    const limit = Math.max(1, Math.floor(opts.limit ?? 100));
    const summary: InterpretSummary = {
      scanned: 0,
      deterministic: 0,
      viaLlm: 0,
      bidsStored: 0,
      unreadable: 0,
      stopped: false,
    };

    const batch = (await this.notices.listByStatus('acquired', limit * 2))
      .filter((n) => !opts.annonceType || n.annonceType === opts.annonceType)
      .slice(0, limit);

    for (const notice of batch) {
      if (summary.stopped) break;
      summary.scanned += 1;
      const text = notice.ocrText ?? '';
      try {
        if (notice.annonceType === '4') {
          await this.interpretResultNotice(notice, text, summary);
        } else {
          await this.interpretPvNotice(notice, text, summary);
        }
      } catch (error) {
        // Transport failure (402 daily cap / 5xx): the row STAYS 'acquired'
        // and the batch stops — retried for free on the next run.
        summary.stopped = true;
        this.logger.warn(
          `interpretation stopped (LLM transport): ${(error as Error).message}`,
        );
      }
    }
    this.logger.log(`interpret complete ${JSON.stringify(summary)}`);
    return summary;
  }

  private async interpretResultNotice(
    notice: NoticeRecord,
    text: string,
    summary: InterpretSummary,
  ): Promise<void> {
    const deterministic = parseNoticeDeterministic(text);
    if (deterministic) {
      const stored = await this.storeBid({
        reference: notice.reference ?? null,
        buyerName: deterministic.acheteur,
        bidderName: deterministic.attributaire,
        amountMad: deterministic.montantMad,
        estimationMad: deterministic.estimationMad,
        objet: deterministic.objet,
        isWinner: true,
        sourceUrl: notice.sourceUrl ?? null,
      });
      if (stored) summary.bidsStored += 1;
      summary.deterministic += 1;
      await this.notices.markStatus(notice.id, 'interpreted');
      return;
    }

    if (!this.llm) {
      // No engine and the regexes did not match — leave for a future run.
      summary.stopped = true;
      return;
    }
    const completion = await this.llm.complete({
      tier: 'T1',
      system:
        "Tu extrais des données factuelles d'un avis de résultat scanné. " +
        'RÈGLE STRICTE: si le texte est illisible ou ne contient pas la donnée, ' +
        'renvoie null pour le champ. NE DEVINE JAMAIS.',
      prompt: `${RESULT_VISION_PROMPT}\n\n--- TEXTE EXTRAIT DE L'AVIS (OCR) ---\n${text.slice(0, 8000)}`,
      maxTokens: 500,
    });
    const parsed = parseResultNoticeJson(completion.text);
    summary.viaLlm += 1;
    if (!parsed || !parsed.lisible || !parsed.attributaire) {
      summary.unreadable += 1;
      await this.notices.markStatus(notice.id, 'error', 'illisible (LLM)');
      return;
    }
    const stored = await this.storeBid({
      reference: notice.reference ?? null,
      buyerName: parsed.acheteur,
      bidderName: parsed.attributaire,
      amountMad: parsed.montantMad,
      estimationMad: parsed.estimationMad,
      objet: parsed.objet,
      isWinner: true,
      sourceUrl: notice.sourceUrl ?? null,
    });
    if (stored) summary.bidsStored += 1;
    await this.notices.markStatus(notice.id, 'interpreted');
  }

  private async interpretPvNotice(
    notice: NoticeRecord,
    text: string,
    summary: InterpretSummary,
  ): Promise<void> {
    if (!this.llm) {
      summary.stopped = true;
      return;
    }
    const completion = await this.llm.complete({
      tier: 'T1',
      prompt: `${EXTRAIT_PV_VISION_PROMPT}\n\n--- TEXTE EXTRAIT DU PV (OCR) ---\n${text.slice(0, 12000)}`,
      maxTokens: 2500,
    });
    const pv = parseExtraitPvJson(completion.text);
    summary.viaLlm += 1;
    if (!pv || !pv.lisible || pv.soumissionnaires.length === 0) {
      summary.unreadable += 1;
      await this.notices.markStatus(notice.id, 'error', 'PV illisible (LLM)');
      return;
    }
    for (const bidder of pv.soumissionnaires) {
      const competitor = await this.intel.upsertCompetitor(bidder.name);
      await this.intel.upsertResult(
        {
          reference: notice.reference ?? notice.idAvis,
          buyerName: pv.acheteur ?? notice.buyerName ?? UNKNOWN_BUYER_LABEL,
          bidderName: bidder.name,
          amountMad: bidder.montantMad ?? undefined,
          estimationMad: pv.estimationMad ?? undefined,
          objet: pv.objet ?? undefined,
          isWinner: bidder.isWinner,
          resultDate: new Date(),
          sourceUrl: notice.sourceUrl,
        },
        competitor.id,
      );
      summary.bidsStored += 1;
    }
    await this.notices.markStatus(notice.id, 'interpreted');
  }

  private async storeBid(bid: {
    reference: string | null;
    buyerName: string | null;
    bidderName: string;
    amountMad: number | null;
    estimationMad: number | null;
    objet: string | null;
    isWinner: boolean;
    sourceUrl: string | null;
  }): Promise<boolean> {
    const competitor = await this.intel.upsertCompetitor(bid.bidderName);
    return this.intel.insertResult(
      {
        // A notice without a listing reference still gets a stable key: the
        // portal's own idAvis-derived source URL guarantees uniqueness.
        reference: bid.reference ?? bid.sourceUrl ?? bid.bidderName,
        buyerName: bid.buyerName ?? UNKNOWN_BUYER_LABEL,
        bidderName: bid.bidderName,
        amountMad: bid.amountMad ?? undefined,
        estimationMad: bid.estimationMad ?? undefined,
        objet: bid.objet ?? undefined,
        isWinner: bid.isWinner,
        resultDate: new Date(),
        sourceUrl: bid.sourceUrl ?? undefined,
      },
      competitor.id,
    );
  }
}
