import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { mapProcedure, parsePmmpDate, parsePmmpResults } from './watch.parser';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/watch/fixtures/pmmp-results.html'),
  'utf8',
);
const REAL_SHAPE = readFileSync(
  join(process.cwd(), 'src/modules/watch/fixtures/pmmp-real-shape.html'),
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
      'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=824513&orgAcronyme=d7h',
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

  test('captures the canonical sourceUrl from the row when the ref anchor is a popUp', () => {
    // Live Atexo shape: the référence anchor is a javascript:popUp(...) with no
    // usable href, but the row also carries détails/retraits links embedding the
    // ref+org pair. sourceUrl must resolve to the canonical consultation URL.
    const html = `<table class="table-results"><tbody>
      <tr>
        <td><input type="checkbox" /></td>
        <td>AOO <span>Appel d'offres ouvert</span></td>
        <td>
          <a href="javascript:popUp('index.php?page=commun.PopUpDetailLots&orgAccronyme=m8x&refConsultation=977311&lang=','yes')">06/BR/RGON/2026</a>
          <span>Objet : Travaux de construction d'un ouvrage hydraulique</span>
        </td>
        <td>Commune de Guelmim</td>
        <td>15/07/202610:00</td>
        <td><a href="https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=977311&orgAcronyme=m8x&code=&retraits">0</a></td>
      </tr>
    </tbody></table>`;
    const { tenders } = parsePmmpResults(html, BASE_URL);
    expect(tenders).toHaveLength(1);
    expect(tenders[0]!.reference).toBe('06/BR/RGON/2026');
    expect(tenders[0]!.sourceUrl).toBe(
      'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=977311&orgAcronyme=m8x',
    );
  });

  test('falls back to the live Atexo layout (table.table-results)', () => {
    const { tenders } = parsePmmpResults(REAL_SHAPE, BASE_URL);
    expect(tenders).toHaveLength(3);

    const hydraulique = tenders[0]!;
    expect(hydraulique.reference).toBe('12/BR/AGADIR/2026');
    expect(hydraulique.procedure).toBe('AOO');
    expect(hydraulique.buyerName).toBe('ORMVA du Souss Massa');
    expect(hydraulique.objet).toContain('ouvrage hydraulique');
    expect(hydraulique.deadlineAt.toISOString()).toBe('2026-07-15T09:00:00.000Z');
    expect(hydraulique.sourceUrl).toContain('EntrepriseDetailsConsultation');

    expect(tenders[1]!.procedure).toBe('AOR');
    expect(tenders[2]!.procedure).toBe('concours');
  });
});
