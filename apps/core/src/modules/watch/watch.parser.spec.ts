import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { mapProcedure, parsePmmpDate, parsePmmpResults } from './watch.parser';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/watch/fixtures/pmmp-results.html'),
  'utf8',
);
const BASE_URL = 'https://www.marchespublics.gov.ma/';

describe('parsePmmpDate', () => {
  test('converts PMMP local time (UTC+1) to UTC', () => {
    expect(parsePmmpDate('07/07/2026 10:00')?.toISOString()).toBe(
      '2026-07-07T09:00:00.000Z',
    );
  });

  test('returns null on malformed input', () => {
    expect(parsePmmpDate('2026-07-07')).toBeNull();
    expect(parsePmmpDate('')).toBeNull();
  });
});

describe('mapProcedure', () => {
  test('maps French labels to procedure codes', () => {
    expect(mapProcedure("Appel d'offres ouvert")).toBe('AOO');
    expect(mapProcedure("Appel d'offres restreint")).toBe('AOR');
    expect(mapProcedure('Concours')).toBe('concours');
    expect(mapProcedure('Procédure négociée')).toBe('negocie');
  });

  test('returns null for unknown labels', () => {
    expect(mapProcedure('Vente aux enchères')).toBeNull();
  });
});

describe('parsePmmpResults', () => {
  test('extracts all well-formed tenders from the fixture', () => {
    const { tenders, skippedRows } = parsePmmpResults(FIXTURE, BASE_URL);
    expect(tenders).toHaveLength(3);
    expect(skippedRows).toBe(1);

    const pont = tenders[0]!;
    expect(pont.reference).toBe('AO 23/2026/DRETLH');
    expect(pont.procedure).toBe('AOO');
    expect(pont.buyerName).toBe("Direction Régionale de l'Équipement de Marrakech");
    expect(pont.objet).toContain("pont sur oued N'Fis");
    expect(pont.deadlineAt.toISOString()).toBe('2026-07-07T09:00:00.000Z');
    expect(pont.sourceUrl).toBe(
      'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=824513',
    );

    const concours = tenders[2]!;
    expect(concours.reference).toBe('C 03/2026/AUAM');
    expect(concours.procedure).toBe('concours');
  });

  test('returns empty result on a page without the results table', () => {
    const { tenders, skippedRows } = parsePmmpResults('<html><body>maintenance</body></html>', BASE_URL);
    expect(tenders).toEqual([]);
    expect(skippedRows).toBe(0);
  });
});
