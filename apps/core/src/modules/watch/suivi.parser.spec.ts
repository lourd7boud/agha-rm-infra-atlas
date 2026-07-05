import { describe, expect, test } from 'vitest';
import {
  buildSuiviUrl,
  parseSuiviCommission,
  refOrgFromUrl,
} from './suivi.parser';

// Real "Suivre la commission" (SuiviConsultation) table captured live from
// marchespublics.gov.ma (refConsultation=1011708) — 3 admissible priced bidders
// + 1 écartée with no amount.
const REAL_TABLE = `
<table cellpadding="3" class="table-results">
  <thead>
    <tr><th class="top" colspan="6"><span class="left">&nbsp;</span></th></tr>
    <tr>
      <th class="center"> Entreprise </th>
      <th class="center"> Enveloppes administratives </th>
      <th colspan="3" class="center"> Enveloppes Financières </th>
    </tr>
    <tr>
      <th></th><th></th><th class="center"></th>
      <th class="center"> Avant Correction </th>
      <th class="center"> Après Correction </th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><h3 class="center">KANBAN</h3></td>
      <td class="center">Admissible </td>
      <td class="center">Admissible </td>
      <td style="color: #e01600; text-align: center;"> 5 005 399,89 </td>
      <td style="color: #00ad09; text-align: center;"> 5 005 399,89 </td>
    </tr>
    <tr>
      <td><h3 class="center">M2M PRO</h3></td>
      <td class="center">Admissible </td>
      <td class="center">Admissible </td>
      <td style="color: #e01600; text-align: center;"> 4 710 964,60 </td>
      <td style="color: #00ad09; text-align: center;"> 4 710 964,60 </td>
    </tr>
    <tr>
      <td><h3 class="center">ADDAMAN SECURITE PRIVEE</h3></td>
      <td class="center">Admissible </td>
      <td class="center">Admissible </td>
      <td style="color: #e01600; text-align: center;"> 4 206 639,02 </td>
      <td style="color: #00ad09; text-align: center;"> 4 206 639,02 </td>
    </tr>
    <tr>
      <td><h3 class="center">STE LPS SERVICES SARL</h3></td>
      <td class="center">Ecartée </td>
      <td class="center">Fermée </td>
      <td style="color: #e01600; text-align: center;"> - </td>
      <td style="color: #00ad09; text-align: center;"> - </td>
    </tr>
  </tbody>
</table>`;

describe('parseSuiviCommission', () => {
  test('extracts every soumissionnaire with amount + admissibility', () => {
    const { bidders } = parseSuiviCommission(REAL_TABLE);
    expect(bidders).toHaveLength(4);
    const byName = Object.fromEntries(bidders.map((b) => [b.entreprise, b]));
    expect(byName['KANBAN']!.amountMad).toBe(5005399.89);
    expect(byName['KANBAN']!.admissible).toBe(true);
    expect(byName['M2M PRO']!.amountMad).toBe(4710964.6);
    expect(byName['ADDAMAN SECURITE PRIVEE']!.amountMad).toBe(4206639.02);
    // Écartée + Fermée → not admissible, no amount.
    expect(byName['STE LPS SERVICES SARL']!.admissible).toBe(false);
    expect(byName['STE LPS SERVICES SARL']!.amountMad).toBeNull();
  });

  test('winner = lowest ADMISSIBLE offer (moins-disant)', () => {
    const { winner } = parseSuiviCommission(REAL_TABLE);
    expect(winner?.entreprise).toBe('ADDAMAN SECURITE PRIVEE');
    expect(winner?.amountMad).toBe(4206639.02);
  });

  test('a page without a commission table yields no bidders (never throws)', () => {
    expect(parseSuiviCommission('<html><body>rien</body></html>')).toEqual({
      bidders: [],
      winner: null,
    });
  });
});

describe('buildSuiviUrl / refOrgFromUrl', () => {
  test('builds the canonical SuiviConsultation URL', () => {
    expect(
      buildSuiviUrl('1011708', 's3d', 'https://www.marchespublics.gov.ma/x'),
    ).toBe(
      'https://www.marchespublics.gov.ma/?page=entreprise.SuiviConsultation&refConsultation=1011708&orgAcronyme=s3d',
    );
  });

  test('extracts ref+org from a detail URL', () => {
    expect(
      refOrgFromUrl(
        'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=1011708&orgAcronyme=s3d',
      ),
    ).toEqual({ refConsultation: '1011708', orgAcronyme: 's3d' });
    expect(refOrgFromUrl('https://example.com/nope')).toBeNull();
  });
});
