import { describe, expect, test, beforeEach } from 'vitest';
import { FakeLlmClient } from '../brain/llm.client';
import { InMemoryIntelRepository } from '../intel/intel.repository';
import { InMemoryTenderRepository } from './tender.repository';
import { TenderAssistantService } from './tender-assistant.service';

describe('TenderAssistantService.ask', () => {
  let tenders: InMemoryTenderRepository;
  let intel: InMemoryIntelRepository;

  beforeEach(async () => {
    tenders = new InMemoryTenderRepository();
    intel = new InMemoryIntelRepository();
    await tenders.create({
      reference: 'AO 23/2026/DRETLH',
      buyerName: "Direction Régionale de l'Équipement de Marrakech",
      procedure: 'AOO',
      objet: "Construction d'un pont sur oued N'Fis",
      location: 'Marrakech',
      deadlineAt: new Date('2026-08-01T09:00:00Z'),
      sourceUrl: 'https://x/1',
    });
    await tenders.create({
      reference: 'AO 56/2026/ORMVAO',
      buyerName: 'ORMVA de Ouarzazate',
      procedure: 'AOO',
      objet: 'Travaux d’irrigation à Errachidia',
      location: 'Errachidia',
      deadlineAt: new Date('2026-08-10T09:00:00Z'),
      sourceUrl: 'https://x/2',
    });
  });

  test('feeds facets + a relevant sample to the model and returns filters + a real-ref answer', async () => {
    const json = JSON.stringify({
      filters: { categories: ['Travaux'], regions: ['Marrakech-Safi'], search: 'pont' },
      answer: 'Un marché trouvé à Marrakech : [AO 23/2026/DRETLH].',
    });
    const llm = new FakeLlmClient([json]);

    const reply = await new TenderAssistantService(tenders, intel, llm).ask(
      'travaux de pont à Marrakech',
    );

    expect(reply.answer).toContain('AO 23/2026/DRETLH');
    expect(reply.filters.region).toBe('Marrakech-Safi');
    expect(reply.filters.q).toBe('pont');
    expect(reply.matchedCount).toBeGreaterThan(0);
    expect(reply.topRefs.some((r) => r.reference === 'AO 23/2026/DRETLH')).toBe(true);
    expect(reply.model).toBe('fake-T1');
    // The model received the facet vocabulary + a keyword sample.
    const prompt = llm.requests[0]!.prompt!;
    expect(prompt).toContain('FACETS DISPONIBLES');
    expect(prompt).toContain('ÉCHANTILLON');
    expect(prompt).toContain('AO 23/2026/DRETLH');
    // Gemini controlled-generation schema MUST be sent — without it the model
    // ignores the prompt's JSON spec and hallucinates its own shape (live-verified).
    expect(llm.requests[0]!.responseSchema).toBeTruthy();
  });

  test('rejects an empty question', async () => {
    const llm = new FakeLlmClient([]);
    await expect(new TenderAssistantService(tenders, intel, llm).ask('   ')).rejects.toThrow();
  });

  test('falls back to first active tenders when no keyword matches', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ filters: {}, answer: 'Vue d’ensemble : [AO 23/2026/DRETLH].' }),
    ]);
    await new TenderAssistantService(tenders, intel, llm).ask('vue d’ensemble');
    // Still grounded — the sample falls back to first items rather than empty.
    expect(llm.requests[0]!.prompt!).toContain('AO 23/2026/DRETLH');
  });

  test('uses the lean read-model loaders, never the whole-catalogue findAll/listAllBids (OOM guard)', async () => {
    // The heavy loaders detoast every tender's `raw` jsonb + the whole 585k-row
    // competitor_bid table, which OOM-crashed the 792 MB core. Poison them so this
    // test fails the day someone reintroduces the whole-catalogue fold here.
    tenders.findAll = () => {
      throw new Error('findAll() must not be called by the assistant (OOM)');
    };
    intel.listAllBids = () => {
      throw new Error('listAllBids() must not be called by the assistant (OOM)');
    };
    const llm = new FakeLlmClient([
      JSON.stringify({ filters: { search: 'pont' }, answer: 'Trouvé : [AO 23/2026/DRETLH].' }),
    ]);

    const reply = await new TenderAssistantService(tenders, intel, llm).ask(
      'travaux de pont à Marrakech',
    );

    expect(reply.answer).toContain('AO 23/2026/DRETLH');
    expect(reply.matchedCount).toBeGreaterThan(0);
  });

  test('throws ServiceUnavailable when no LLM client is configured', async () => {
    await expect(
      new TenderAssistantService(tenders, intel, null).ask('q'),
    ).rejects.toThrow();
  });

  test('throws 503 on non-JSON model output', async () => {
    const llm = new FakeLlmClient(['désolé pas de json']);
    await expect(
      new TenderAssistantService(tenders, intel, llm).ask('q'),
    ).rejects.toThrow();
  });
});
