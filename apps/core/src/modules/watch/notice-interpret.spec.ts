import { describe, expect, test } from 'vitest';
import type { LlmClient, LlmCompletion, LlmRequest } from '../brain/llm.client';
import { InMemoryIntelRepository } from '../intel/intel.repository';
import { InMemoryNoticeRepository } from '../intel/notice.repository';
import {
  NoticeInterpretService,
  parseFrMoney,
  parseNoticeDeterministic,
} from './notice-interpret';

const TEMPLATED_NOTICE = `
ROYAUME DU MAROC
Avis de résultat définitif
Acheteur public : COMMUNE DE TIZNIT
Objet du marché : Travaux de construction d'un mur de clôture
Attributaire : STE ATLAS TRAVAUX SARL
Montant de l'offre retenue (TTC) : 1 234 567,89 DH
Estimation administrative : 1 500 000,00 DH
`;

class FakeLlm implements LlmClient {
  constructor(private readonly reply: string) {}
  async complete(_req: LlmRequest): Promise<LlmCompletion> {
    return { text: this.reply, model: 'fake', inputTokens: 1, outputTokens: 1 };
  }
  async completeVision(): Promise<LlmCompletion> {
    throw new Error('not used');
  }
  async completeVisionDoc(): Promise<LlmCompletion> {
    throw new Error('not used');
  }
}

class BrokenLlm implements LlmClient {
  async complete(): Promise<LlmCompletion> {
    throw new Error('HTTP 402 daily_cost_limit_exceeded');
  }
  async completeVision(): Promise<LlmCompletion> {
    throw new Error('not used');
  }
  async completeVisionDoc(): Promise<LlmCompletion> {
    throw new Error('not used');
  }
}

describe('parseFrMoney', () => {
  test.each([
    ['1 234 567,89', 1_234_567.89],
    ['1.234.567,89', 1_234_567.89],
    ['1234567.89', 1_234_567.89],
    ['250 000', 250_000],
    ['1.234.567', 1_234_567], // dots as thousands (3 trailing digits)
    ['20 000 DH', 20_000],
  ])('%s → %d', (raw, expected) => {
    expect(parseFrMoney(raw as string)).toBe(expected);
  });

  test('rejects implausible amounts', () => {
    expect(parseFrMoney('12')).toBeNull(); // below 1000 MAD
    expect(parseFrMoney('9999999999999')).toBeNull();
    expect(parseFrMoney('abc')).toBeNull();
  });
});

describe('parseNoticeDeterministic', () => {
  test('reads the templated résultat-définitif layout without any LLM', () => {
    const parsed = parseNoticeDeterministic(TEMPLATED_NOTICE);
    expect(parsed).not.toBeNull();
    expect(parsed!.attributaire).toBe('STE ATLAS TRAVAUX SARL');
    expect(parsed!.montantMad).toBe(1_234_567.89);
    expect(parsed!.estimationMad).toBe(1_500_000);
    expect(parsed!.acheteur).toBe('COMMUNE DE TIZNIT');
    expect(parsed!.objet).toContain('mur de clôture');
  });

  test('returns null when the montant is missing (falls through to LLM)', () => {
    const parsed = parseNoticeDeterministic(
      'Attributaire : STE X\nAucun montant indiqué',
    );
    expect(parsed).toBeNull();
  });

  test('returns null on free-form text — never guesses', () => {
    expect(parseNoticeDeterministic('page blanche illisible')).toBeNull();
  });
});

async function seedNotice(
  repo: InMemoryNoticeRepository,
  overrides: { annonceType?: '4' | '5'; ocrText?: string; idAvis?: string },
) {
  await repo.insertAcquired({
    annonceType: overrides.annonceType ?? '4',
    idAvis: overrides.idAvis ?? 'a1',
    sourceUrl: `https://portal/d${overrides.idAvis ?? 'a1'}`,
    reference: 'AO 5/2026',
    ocrText: overrides.ocrText ?? TEMPLATED_NOTICE,
  });
}

describe('NoticeInterpretService', () => {
  test('templated notice interprets deterministically — zero LLM calls', async () => {
    const notices = new InMemoryNoticeRepository();
    const intel = new InMemoryIntelRepository();
    await seedNotice(notices, {});
    // BrokenLlm proves the deterministic path never touches the engine.
    const service = new NoticeInterpretService(notices, intel, new BrokenLlm());

    const summary = await service.interpretOnce({ limit: 10 });

    expect(summary.deterministic).toBe(1);
    expect(summary.viaLlm).toBe(0);
    expect(summary.bidsStored).toBe(1);
    expect(summary.stopped).toBe(false);
    expect(await notices.listByStatus('interpreted', 10)).toHaveLength(1);
    const bids = await intel.listAllBids();
    expect(bids[0]!.bidderName).toBe('STE ATLAS TRAVAUX SARL');
    expect(bids[0]!.isWinner).toBe(true);
  });

  test('PV notice goes through the LLM and stores every bidder', async () => {
    const notices = new InMemoryNoticeRepository();
    const intel = new InMemoryIntelRepository();
    await seedNotice(notices, { annonceType: '5', ocrText: 'tableau des offres…' });
    const service = new NoticeInterpretService(
      notices,
      intel,
      new FakeLlm(
        JSON.stringify({
          acheteur: 'ONEE',
          objet: 'Forage de puits',
          estimation_mad: 900_000,
          soumissionnaires: [
            { nom: 'STE ALPHA', montant_mad: 850_000, retenu: true },
            { nom: 'STE BETA', montant_mad: 910_000, retenu: false },
          ],
          lisible: true,
        }),
      ),
    );

    const summary = await service.interpretOnce({ limit: 10 });

    expect(summary.viaLlm).toBe(1);
    expect(summary.bidsStored).toBe(2);
    const bids = await intel.listAllBids();
    expect(bids).toHaveLength(2);
    expect(bids.filter((b) => b.isWinner)).toHaveLength(1);
    expect(bids[0]!.estimationMad).toBe(900_000);
  });

  test('LLM transport failure stops the batch and leaves rows acquired', async () => {
    const notices = new InMemoryNoticeRepository();
    const intel = new InMemoryIntelRepository();
    await seedNotice(notices, { annonceType: '5', idAvis: 'p1', ocrText: 'pv 1' });
    await seedNotice(notices, { annonceType: '5', idAvis: 'p2', ocrText: 'pv 2' });
    const service = new NoticeInterpretService(notices, intel, new BrokenLlm());

    const summary = await service.interpretOnce({ limit: 10 });

    expect(summary.stopped).toBe(true);
    expect(summary.bidsStored).toBe(0);
    // Both rows still acquired — retried for free on the next run.
    expect(await notices.listByStatus('acquired', 10)).toHaveLength(2);
  });

  test('unreadable LLM verdict marks the notice as error (no retry loop)', async () => {
    const notices = new InMemoryNoticeRepository();
    const intel = new InMemoryIntelRepository();
    await seedNotice(notices, { annonceType: '5', ocrText: 'illisible' });
    const service = new NoticeInterpretService(
      notices,
      intel,
      new FakeLlm(JSON.stringify({ soumissionnaires: [], lisible: false })),
    );

    const summary = await service.interpretOnce({ limit: 10 });

    expect(summary.unreadable).toBe(1);
    expect(await notices.listByStatus('error', 10)).toHaveLength(1);
  });
});
