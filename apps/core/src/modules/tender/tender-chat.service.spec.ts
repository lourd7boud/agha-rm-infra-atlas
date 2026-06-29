import { describe, expect, test, beforeEach } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import {
  InMemoryTenderRepository,
  type TenderRepository,
} from './tender.repository';
import { TenderChatService } from './tender-chat.service';

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
