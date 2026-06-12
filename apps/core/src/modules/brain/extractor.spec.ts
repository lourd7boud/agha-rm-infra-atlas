import { describe, expect, test } from 'vitest';
import { extractAvis, parseJsonLoose } from './extractor';
import { FakeLlmClient } from './llm.client';

const VALID_PAYLOAD = JSON.stringify({
  reference: 'AO 14/2026/ORMVAH',
  buyerName: 'ORMVA du Haouz',
  procedure: "appel d'offres ouvert",
  objet: "Travaux d'aménagement hydro-agricole",
  estimationMad: 4500000,
  cautionProvisoireMad: 45000,
  deadline: '2026-07-06T10:00',
  visiteDesLieux: null,
  qualificationsRequises: ['Secteur C, qualification C.1, classe 3'],
});

describe('parseJsonLoose', () => {
  test('parses raw JSON', () => {
    expect(parseJsonLoose('{"a": 1}')).toEqual({ a: 1 });
  });

  test('parses fenced JSON blocks', () => {
    expect(parseJsonLoose('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});

describe('extractAvis', () => {
  test('returns typed data for a valid model response', async () => {
    const llm = new FakeLlmClient([VALID_PAYLOAD]);
    const outcome = await extractAvis(llm, 'texte avis…');

    expect(outcome.ok).toBe(true);
    expect(outcome.data?.reference).toBe('AO 14/2026/ORMVAH');
    expect(outcome.data?.estimationMad).toBe(4_500_000);
    expect(llm.requests[0]?.tier).toBe('T1');
  });

  test('flags non-JSON responses without throwing', async () => {
    const llm = new FakeLlmClient(['Désolé, je ne peux pas répondre.']);
    const outcome = await extractAvis(llm, 'texte avis…');

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.[0]).toContain('non-JSON');
    expect(outcome.raw).toContain('Désolé');
  });

  test('flags schema-invalid responses with field-level issues', async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({ estimationMad: 'quatre millions', deadline: '06/07/2026' }),
    ]);
    const outcome = await extractAvis(llm, 'texte avis…');

    expect(outcome.ok).toBe(false);
    expect(outcome.issues?.join(' ')).toContain('estimationMad');
    expect(outcome.issues?.join(' ')).toContain('deadline');
  });
});
