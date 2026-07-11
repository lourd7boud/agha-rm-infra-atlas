import { describe, expect, test, beforeEach } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import {
  InMemoryTenderRepository,
  type TenderRepository,
} from './tender.repository';
import {
  TenderChatService,
  buildTenderChatSystemPrompt,
  formatCompanyProfileForChat,
  formatCompetitorIntelForChat,
  formatVaultReadinessForChat,
  readDossierText,
} from './tender-chat.service';
import {
  InMemoryIntelRepository,
  type IntelRepository,
} from '../intel/intel.repository';
import { InMemoryVaultRepository } from '../vault/vault.repository';
import type { PublishedResult } from '../intel/intel.parser';
import { buildTenderCompetitorIntel } from './competitor-intel.domain';

const BUYER = 'REGION DE GUELMIM - OUED NOUN';

/** Seeds a small competitor archive for BUYER: two firms across two past
 *  markets, one with a corroborated 25% winning rebate (amount 300k / est 400k). */
async function seedIntel(): Promise<IntelRepository> {
  const intel = new InMemoryIntelRepository();
  const alpha = await intel.upsertCompetitor('ENTREPRISE ALPHA');
  const beta = await intel.upsertCompetitor('SOCIETE BETA');
  const bid = (over: Partial<PublishedResult>): PublishedResult => ({
    reference: '99/2025',
    buyerName: BUYER,
    bidderName: 'ENTREPRISE ALPHA',
    isWinner: false,
    ...over,
  });
  await intel.insertResult(
    bid({ reference: '99/2025', bidderName: 'ENTREPRISE ALPHA', amountMad: 300000, estimationMad: 400000, isWinner: true }),
    alpha.id,
  );
  await intel.insertResult(bid({ reference: '99/2025', bidderName: 'SOCIETE BETA', amountMad: 350000 }), beta.id);
  await intel.insertResult(bid({ reference: '98/2025', bidderName: 'ENTREPRISE ALPHA', amountMad: 220000 }), alpha.id);
  return intel;
}

async function seedTender(repo: TenderRepository): Promise<string> {
  const tender = await repo.create({
    reference: '06/BR/RGON/2026',
    buyerName: 'REGION DE GUELMIM - OUED NOUN',
    procedure: 'AOO',
    objet: 'Travaux de construction d’un ouvrage d’art',
    location: 'GUELMIM',
    estimationMad: 379104,
    cautionProvisoireMad: 7000,
    deadlineAt: new Date('2026-07-15T09:00:00Z'),
    sourceUrl: 'https://www.marchespublics.gov.ma/x',
  });
  return tender.id;
}

describe('TenderChatService.ask', () => {
  let repo: InMemoryTenderRepository;

  beforeEach(() => {
    repo = new InMemoryTenderRepository();
  });

  test('feeds the structured tender context to the LLM and returns its answer', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient([
      'Le cautionnement provisoire est de 7 000 MAD selon la fiche.',
    ]);
    const service = new TenderChatService(repo, llm);

    const reply = await service.ask(id, 'Quel est le cautionnement provisoire ?');

    expect(reply.answer).toContain('7 000');
    expect(reply.model).toBe('fake-T1');
    expect(reply.contextChars).toBeGreaterThan(0);
    // The prompt fed to the model carries the structured tender block.
    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('06/BR/RGON/2026');
    expect(prompt).toContain('REGION DE GUELMIM');
    expect(prompt).toContain('GUELMIM');
    expect(prompt).toContain('Budget estimé: 379104');
    expect(prompt).toContain('NOUVELLE QUESTION');
  });

  test('echoes prior history but caps it to the last 12 turns', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm);

    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    await service.ask(id, 'et donc ?', history);

    const prompt = llm.requests[0]!.prompt!;
    // First 8 messages dropped (20 → keep last 12).
    expect(prompt).not.toContain('m0');
    expect(prompt).not.toContain('m7');
    expect(prompt).toContain('m8');
    expect(prompt).toContain('m19');
  });

  test('rejects an empty question', async () => {
    const id = await seedTender(repo);
    const service = new TenderChatService(repo, new FakeLlmClient([]));
    await expect(service.ask(id, '   ')).rejects.toThrow();
  });

  test('throws NotFound on an unknown tender id', async () => {
    const service = new TenderChatService(repo, new FakeLlmClient([]));
    await expect(service.ask('nonexistent', 'q')).rejects.toThrow();
  });

  test('throws ServiceUnavailable when no LLM client is configured', async () => {
    const id = await seedTender(repo);
    const service = new TenderChatService(repo, null);
    await expect(service.ask(id, 'q')).rejects.toThrow();
  });
});

describe('TenderChatService.streamAsk', () => {
  let repo: InMemoryTenderRepository;

  beforeEach(() => {
    repo = new InMemoryTenderRepository();
  });

  test('streams the same answer as ask() but as delta chunks + a finish event', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient([
      'Le délai d’exécution est de 4 mois selon le RC.',
    ]);
    const service = new TenderChatService(repo, llm);

    const events = [];
    for await (const ev of service.streamAsk(id, 'Quel est le délai ?')) {
      events.push(ev);
    }

    const deltas = events.filter((e) => e.type === 'delta');
    const finishes = events.filter((e) => e.type === 'finish');
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(finishes.length).toBe(1);
    const joined = deltas
      .map((e) => (e.type === 'delta' ? e.text : ''))
      .join('');
    expect(joined).toContain('4 mois');
    const finish = finishes[0]!;
    if (finish.type !== 'finish') throw new Error('expected finish');
    expect(finish.model).toBe('fake-T1');
    expect(typeof finish.inputTokens).toBe('number');
    expect(typeof finish.outputTokens).toBe('number');
  });

  test('still emits a single delta + finish when the provider has no streamComplete (fallback)', async () => {
    const fallbackLlm = {
      complete: async () => ({
        text: 'one-shot answer',
        model: 'fallback-model',
        inputTokens: 5,
        outputTokens: 8,
      }),
      completeVision: async () => { throw new Error('n/a'); },
      completeVisionDoc: async () => { throw new Error('n/a'); },
    };
    const id = await seedTender(repo);
    const service = new TenderChatService(repo, fallbackLlm as never);

    const events = [];
    for await (const ev of service.streamAsk(id, 'q?')) {
      events.push(ev);
    }
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ type: 'delta', text: 'one-shot answer' });
    expect(events[1]).toEqual({
      type: 'finish',
      model: 'fallback-model',
      inputTokens: 5,
      outputTokens: 8,
    });
  });

  test('rejects an empty question (validation BEFORE the first delta)', async () => {
    const id = await seedTender(repo);
    const service = new TenderChatService(repo, new FakeLlmClient([]));
    const gen = service.streamAsk(id, '   ');
    await expect(gen.next()).rejects.toThrow();
  });

  test('throws NotFound on an unknown tender id', async () => {
    const service = new TenderChatService(repo, new FakeLlmClient([]));
    const gen = service.streamAsk('nonexistent', 'q');
    await expect(gen.next()).rejects.toThrow();
  });

  test('throws ServiceUnavailable when no LLM is configured', async () => {
    const id = await seedTender(repo);
    const service = new TenderChatService(repo, null);
    const gen = service.streamAsk(id, 'q');
    await expect(gen.next()).rejects.toThrow();
  });
});

describe('buildTenderChatSystemPrompt (identity)', () => {
  test('establishes the AGHA RM INFRA / ATLAS agent identity', () => {
    const prompt = buildTenderChatSystemPrompt(new Date('2026-07-11T00:00:00Z'));
    expect(prompt).toContain('ATLAS');
    expect(prompt).toContain('AGHA RM INFRA');
    // Injects today's date.
    expect(prompt).toContain('11/07/2026');
  });

  test('forbids claiming to be a Google / generic language model', () => {
    const prompt = buildTenderChatSystemPrompt(new Date());
    expect(prompt).toContain('Google');
    // The rule is a PROHIBITION — it names Google only to ban the claim, and
    // instructs never to say "grand modèle de langage".
    expect(prompt).toMatch(/ne dis JAMAIS|jamais.*modèle de langage/i);
    expect(prompt).toContain('grand modèle de langage');
  });
});

describe('TenderChatService.ask — agent capabilities', () => {
  let repo: InMemoryTenderRepository;

  beforeEach(() => {
    repo = new InMemoryTenderRepository();
  });

  test('feeds the persisted DCE text so the agent can read the dossier prose', async () => {
    const id = await seedTender(repo);
    await repo.updateEnrichment(id, {}, {
      dossierText: "Article 7 : La visite des lieux est OBLIGATOIRE le 10/07/2026 à 10h.",
    });
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm);

    await service.ask(id, 'La visite des lieux est-elle obligatoire ?');

    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('CONTENU DU DOSSIER');
    expect(prompt).toContain('visite des lieux est OBLIGATOIRE');
  });

  test('feeds buyer archive intel (likely competitors + winning rebate) into the prompt', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm, await seedIntel());

    await service.ask(id, 'Combien de concurrents et à quel prix ?');

    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('ARCHIVE');
    expect(prompt).toContain('ENTREPRISE ALPHA');
    // 25% rebate (300k vs 400k) surfaced as a pricing benchmark.
    expect(prompt).toContain('Rabais médian');
    expect(prompt).toContain('25.0 %');
  });

  test('feeds the vault readiness so the agent can flag missing pieces', async () => {
    const id = await seedTender(repo);
    const vault = new InMemoryVaultRepository();
    // Only ONE of the six required kinds is present → the rest are "manquantes".
    await vault.create({
      kind: 'registre_commerce',
      label: 'RC',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm, null, vault);

    await service.ask(id, 'Quelles pièces nous manquent ?');

    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('COFFRE-FORT AGHA RM INFRA');
    expect(prompt).toContain('MANQUANTES');
    expect(prompt).toContain('Attestation fiscale (DGI)');
    expect(prompt).toContain('Registre de commerce'); // the one present
  });

  test('degrades gracefully to DCE-only context when intel + vault are absent', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm);

    const reply = await service.ask(id, 'objet du marché ?');

    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).not.toContain('ARCHIVE —');
    expect(prompt).not.toContain('COFFRE-FORT');
    expect(reply.answer).toBe('ok');
  });

  test('prepends the identity instructions INTO the user prompt (CC-relay gateways ignore system)', async () => {
    const id = await seedTender(repo);
    const llm = new FakeLlmClient(['ok']);
    const service = new TenderChatService(repo, llm);

    await service.ask(id, 'qui es-tu ?');

    const req = llm.requests[0]!;
    // Identity lives in BOTH system and the user message — the user copy is what
    // survives gateways that drop the system field.
    expect(req.system).toContain('ATLAS');
    expect(req.prompt).toContain('INSTRUCTIONS');
    expect(req.prompt).toContain('ATLAS');
    expect(req.prompt).toContain('grand modèle de langage');
  });

  test('prefers the dedicated strong chat client (Opus) over the default llm', async () => {
    const id = await seedTender(repo);
    const defaultLlm = new FakeLlmClient(['DEFAULT-FAST']);
    const chatLlm = new FakeLlmClient(['STRONG-OPUS']);
    // (repo, llm, intel, vault, chatLlm)
    const service = new TenderChatService(repo, defaultLlm, null, null, chatLlm);

    const reply = await service.ask(id, 'question');

    expect(reply.answer).toBe('STRONG-OPUS');
    expect(chatLlm.requests).toHaveLength(1);
    expect(defaultLlm.requests).toHaveLength(0);
  });

  test('falls back to the default llm when no chat client is configured', async () => {
    const id = await seedTender(repo);
    const defaultLlm = new FakeLlmClient(['DEFAULT-FAST']);
    const service = new TenderChatService(repo, defaultLlm);

    const reply = await service.ask(id, 'question');

    expect(reply.answer).toBe('DEFAULT-FAST');
    expect(defaultLlm.requests).toHaveLength(1);
  });
});

describe('chat context formatters (pure)', () => {
  test('readDossierText returns the excerpt or null', () => {
    expect(readDossierText({ dossierText: 'texte du DCE' })).toBe('texte du DCE');
    expect(readDossierText({ dossierText: '   ' })).toBeNull();
    expect(readDossierText({})).toBeNull();
    expect(readDossierText(null)).toBeNull();
  });

  test('formatCompetitorIntelForChat renders the open predictive block', async () => {
    const intel = await seedIntel();
    const ci = buildTenderCompetitorIntel(
      { reference: '05/2026', buyerName: BUYER, deadlineAt: new Date('2027-01-01T00:00:00Z') },
      await intel.findBidsForBuyer(BUYER),
      new Date('2026-07-11T00:00:00Z'),
    );
    const text = formatCompetitorIntelForChat(ci);
    expect(text).toContain('Concurrents probables');
    expect(text).toContain('ENTREPRISE ALPHA');
    expect(text).toContain('Rabais médian');
  });

  test('formatCompanyProfileForChat grounds the agent in AGHA RM INFRA', () => {
    const text = formatCompanyProfileForChat();
    expect(text).toContain('PROFIL AGHA RM INFRA');
    expect(text).toContain('Métiers:');
    expect(text).toContain('Plafond');
  });

  test('formatVaultReadinessForChat lists missing required kinds', () => {
    const text = formatVaultReadinessForChat(
      [{ kind: 'registre_commerce', expiresAt: new Date('2027-01-01T00:00:00Z') }],
      new Date('2026-07-11T00:00:00Z'),
    );
    expect(text).toContain('COFFRE-FORT AGHA RM INFRA');
    expect(text).toContain('MANQUANTES');
    expect(text).toContain('Attestation CNSS');
    expect(text).not.toContain('score 100%');
  });
});
