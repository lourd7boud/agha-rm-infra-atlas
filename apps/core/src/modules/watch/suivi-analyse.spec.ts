import { describe, expect, test } from 'vitest';
import {
  computeReferencePrice,
  parseSuiviAnalyse,
  pickWinner,
  suiviTargetFromSourceUrl,
  type AnalyseBidder,
} from './suivi-analyse';

// ── Live capture, refConsultation=1036844 (DPA Boulemane) ────────────────────
// Current 6-column layout: Entreprise | Admin | Technique | Finance | Avant | Après.
// Estimation MO (referentiel repeater) = 420 000 MAD. marchecal's own output for
// this exact page: prix de référence 418 062,86 MAD, gagnant FCI-DEVELOPPEMENT
// (411 600), diff vs MO −2 %, diff vs Réf −1,55 %.
const LIVE_REFERENTIEL = `
<span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_idReferentielZoneText_RepeaterReferentielZoneText_ctl0_titre">Estimation (en Dhs TTC) * </span>
<span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_idReferentielZoneText_RepeaterReferentielZoneText_ctl0_labelReferentielZoneText">420 000,00</span>
<input type="hidden" id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_idReferentielZoneText_RepeaterReferentielZoneText_ctl0_oldValue" value="420 000,00" />
`;

const row = (
  name: string,
  admin: string,
  tech: string,
  fin: string,
  avant: string,
  apres: string,
) => `<tr>
  <td><h3 class="center">${name}</h3></td>
  <td class="center">${admin} </td>
  <td class="center">${tech} </td>
  <td class="center">${fin} </td>
  <td style="color:#e01600"> ${avant} </td>
  <td style="color:#00ad09"> ${apres} </td>
</tr>`;

const LIVE_TABLE = `
<table cellpadding="3" class="table-results">
  <thead>
    <tr><th class="top" colspan="6"></th></tr>
    <tr><th class="center">Entreprise</th><th class="center">Enveloppes administratives</th><th class="center">Enveloppes techniques</th><th colspan="3" class="center">Enveloppes Financières</th></tr>
    <tr><th></th><th></th><th></th><th class="center"></th><th class="center">Avant Correction</th><th class="center">Après Correction</th></tr>
  </thead>
  <tbody>
    ${row('FCI-DEVELOPPEMENT', 'Admissible', 'Admissible', 'Admissible', '411 600,00', '411 600,00')}
    ${row('SOCIETE D\u2019ETUDES ASSISTANCE TE', 'Admissible', 'Admissible', 'Admissible', '418 800,00', '418 800,00')}
    ${row('BUREAU DES ETUDES PRIMATECH IN', 'Admissible', 'Ecartée', 'Fermée', '-', '-')}
    ${row('CAPITAL RH', 'Admissible', 'Admissible', 'Admissible', '420 000,00', '420 000,00')}
    ${row('CAPITAL INGENIERIE', 'Admissible', 'Admissible', 'Admissible', '419 952,00', '419 952,00')}
    ${row('STE GENERALE D\u2019INGENIERIE ET D', 'Admissible', 'Ecartée', 'Fermée', '-', '-')}
    ${row('PCM CONSULTING', 'Admissible', 'Admissible', 'Admissible', '419 328,00', '419 328,00')}
    ${row('SETARYA INGENIERIE', 'Admissible', 'Admissible', 'Admissible', '420 000,00', '420 000,00')}
    ${row('DIRASSAT INGENIERIE', 'Admissible', 'Admissible', 'Admissible', '403 200,00', '403 200,00')}
  </tbody>
</table>`;

const LIVE_PAGE = `${LIVE_REFERENTIEL}\n${LIVE_TABLE}`;

// ── Legacy 5-column layout (refConsultation=1011708, no technical envelope) ──
const LEGACY_TABLE = `
<table cellpadding="3" class="table-results">
  <thead>
    <tr><th class="top" colspan="6"></th></tr>
    <tr><th class="center"> Entreprise </th><th class="center"> Enveloppes administratives </th><th colspan="3" class="center"> Enveloppes Financières </th></tr>
    <tr><th></th><th></th><th class="center"></th><th class="center"> Avant Correction </th><th class="center"> Après Correction </th></tr>
  </thead>
  <tbody>
    <tr><td><h3 class="center">KANBAN</h3></td><td class="center">Admissible </td><td class="center">Admissible </td><td> 5 005 399,89 </td><td> 5 005 399,89 </td></tr>
    <tr><td><h3 class="center">M2M PRO</h3></td><td class="center">Admissible </td><td class="center">Admissible </td><td> 4 710 964,60 </td><td> 4 710 964,60 </td></tr>
    <tr><td><h3 class="center">ADDAMAN SECURITE PRIVEE</h3></td><td class="center">Admissible </td><td class="center">Admissible </td><td> 4 206 639,02 </td><td> 4 206 639,02 </td></tr>
    <tr><td><h3 class="center">STE LPS SERVICES SARL</h3></td><td class="center">Ecartée </td><td class="center">Fermée </td><td> - </td><td> - </td></tr>
  </tbody>
</table>`;

describe('parseSuiviAnalyse — live 6-column layout (marchecal parity)', () => {
  const result = parseSuiviAnalyse(LIVE_PAGE);

  test('finds the dépouillement and reads the estimation from the referentiel', () => {
    expect(result.hasResults).toBe(true);
    expect(result.estimationMad).toBe(420000);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0]!.name).toBe('Lot unique');
  });

  test('parses every soumissionnaire with both correction amounts + statuses', () => {
    const lot = result.lots[0]!;
    expect(lot.bidders).toHaveLength(9);
    const byName = Object.fromEntries(lot.bidders.map((b) => [b.entreprise, b]));
    expect(byName['FCI-DEVELOPPEMENT']!.amountMad).toBe(411600);
    expect(byName['FCI-DEVELOPPEMENT']!.admissible).toBe(true);
    // Ecartée (technique) + Fermée (finance) → not admissible, no amount.
    expect(byName['BUREAU DES ETUDES PRIMATECH IN']!.admissible).toBe(false);
    expect(byName['BUREAU DES ETUDES PRIMATECH IN']!.amountMad).toBeNull();
    expect(byName['BUREAU DES ETUDES PRIMATECH IN']!.finStatus).toBe('Ecartée');
  });

  test('prix de référence = (estimation + moyenne offres ≤ estimation)/2 — matches marchecal', () => {
    // (420000 + 416125,714…) / 2 = 418 062,857…
    expect(result.lots[0]!.referencePrice).toBeCloseTo(418062.86, 2);
  });

  test('winner = admissible offer closest BELOW the prix de référence (not the lowest)', () => {
    const lot = result.lots[0]!;
    expect(lot.winner?.entreprise).toBe('FCI-DEVELOPPEMENT');
    expect(lot.winningAmount).toBe(411600);
    // DIRASSAT (403 200) is the absolute lowest but sits farther below the
    // reference → presumptively abnormally low, not retained.
    expect(lot.winner?.entreprise).not.toBe('DIRASSAT INGENIERIE');
  });

  test('percentages match marchecal exactly (2-decimal, signed)', () => {
    const lot = result.lots[0]!;
    expect(lot.diffWinnerVsMoPct).toBe(-2); // (411600-420000)/420000
    expect(lot.diffWinnerVsRefPct).toBeCloseTo(-1.55, 2);
    const byName = Object.fromEntries(lot.bidders.map((b) => [b.entreprise, b]));
    expect(byName['DIRASSAT INGENIERIE']!.diffVsMoPct).toBe(-4);
    expect(byName['SOCIETE D\u2019ETUDES ASSISTANCE TE']!.diffVsMoPct).toBe(-0.29);
    expect(byName['PCM CONSULTING']!.diffVsMoPct).toBe(-0.16);
    expect(byName['CAPITAL RH']!.diffVsMoPct).toBe(0);
  });
});

describe('parseSuiviAnalyse — legacy 5-column layout (no technical envelope)', () => {
  test('still reads bidders + amounts from the last two cells', () => {
    // No referentiel on this fixture → estimation passed as override.
    const result = parseSuiviAnalyse(LEGACY_TABLE, 4800000);
    const lot = result.lots[0]!;
    expect(lot.bidders).toHaveLength(4);
    const byName = Object.fromEntries(lot.bidders.map((b) => [b.entreprise, b]));
    expect(byName['KANBAN']!.amountMad).toBe(5005399.89);
    expect(byName['STE LPS SERVICES SARL']!.admissible).toBe(false);
    expect(byName['STE LPS SERVICES SARL']!.amountMad).toBeNull();
  });
});

describe('computeReferencePrice', () => {
  test('excludes offers above the estimation from the mean', () => {
    // eligible = [411600]; mean = 411600; (420000+411600)/2 = 415800.
    expect(computeReferencePrice([411600, 500000], 420000)).toBeCloseTo(415800, 2);
  });
  test('null without estimation or without any eligible offer', () => {
    expect(computeReferencePrice([100], null)).toBeNull();
    expect(computeReferencePrice([500000], 420000)).toBeNull();
    expect(computeReferencePrice([], 420000)).toBeNull();
  });
});

describe('pickWinner', () => {
  const mk = (entreprise: string, amountMad: number): AnalyseBidder => ({
    entreprise,
    adminStatus: 'Admissible',
    finStatus: 'Admissible',
    avantMad: amountMad,
    apresMad: amountMad,
    amountMad,
    admissible: true,
    diffVsMoPct: null,
  });
  test('highest offer at/below the reference price', () => {
    const winner = pickWinner([mk('A', 403200), mk('B', 411600), mk('C', 418800)], 418062.86);
    expect(winner?.entreprise).toBe('B');
  });
  test('falls back to the lowest offer when nothing is at/below the reference', () => {
    const winner = pickWinner([mk('A', 403200), mk('B', 411600)], 400000);
    expect(winner?.entreprise).toBe('A');
  });
  test('falls back to moins-disant when no reference price', () => {
    const winner = pickWinner([mk('A', 403200), mk('B', 411600)], null);
    expect(winner?.entreprise).toBe('A');
  });
  test('null when no admissible priced offer', () => {
    expect(pickWinner([], 100)).toBeNull();
  });
});

describe('suiviTargetFromSourceUrl', () => {
  test('builds the suivi URL from a detail sourceUrl', () => {
    expect(
      suiviTargetFromSourceUrl(
        'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=1036844&orgAcronyme=q1s',
      ),
    ).toEqual({
      url: 'https://www.marchespublics.gov.ma/?page=entreprise.SuiviConsultation&refConsultation=1036844&orgAcronyme=q1s',
      refConsultation: '1036844',
      orgAcronyme: 'q1s',
    });
  });
  test('null on a malformed URL', () => {
    expect(suiviTargetFromSourceUrl('https://example.com/nope')).toBeNull();
  });
});
