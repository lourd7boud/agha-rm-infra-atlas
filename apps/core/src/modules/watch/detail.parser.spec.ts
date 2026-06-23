import { describe, expect, it } from 'vitest';
import {
  extractDetailLinks,
  firstDetailLink,
  parseDetailPage,
  parseMoneyMad,
} from './detail.parser';

describe('parseMoneyMad', () => {
  it('parses French-formatted MAD amounts', () => {
    expect(parseMoneyMad('7 000,00 MAD')).toBe(7000);
    expect(parseMoneyMad('1 250 000,50 Dhs')).toBe(1250000.5);
    expect(parseMoneyMad('350 000')).toBe(350000);
  });

  it('returns null when there is no number', () => {
    expect(parseMoneyMad('—')).toBeNull();
    expect(parseMoneyMad('Estimation (en Dhs TTC)')).toBeNull();
    expect(parseMoneyMad(null)).toBeNull();
    expect(parseMoneyMad(undefined)).toBeNull();
  });
});

const LISTING_FIXTURE = `
<a href="https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&amp;refConsultation=977311&amp;orgAcronyme=m8x&amp;code=&amp;retraits">retraits</a>
<a href="https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&amp;refConsultation=977311&amp;orgAcronyme=m8x&amp;depots">depots</a>
<a href="https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&amp;refConsultation=1003098&amp;orgAcronyme=q9t&amp;code=&amp;echanges">echanges</a>
`;

describe('extractDetailLinks', () => {
  it('extracts distinct consultations and builds GET detail URLs', () => {
    const links = extractDetailLinks(
      LISTING_FIXTURE,
      'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch',
    );
    expect(links).toHaveLength(2); // the 977311 sub-links collapse to one
    expect(links[0]).toEqual({
      refConsultation: '977311',
      orgAcronyme: 'm8x',
      detailUrl:
        'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=977311&orgAcronyme=m8x',
    });
    expect(links[1]?.refConsultation).toBe('1003098');
  });

  it('returns nothing on a page with no consultations', () => {
    expect(extractDetailLinks('<html></html>', 'https://x.ma')).toEqual([]);
  });
});

describe('firstDetailLink', () => {
  it('returns the first canonical detail link in a row fragment', () => {
    const link = firstDetailLink(
      LISTING_FIXTURE,
      'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch',
    );
    expect(link).toEqual({
      refConsultation: '977311',
      orgAcronyme: 'm8x',
      detailUrl:
        'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=977311&orgAcronyme=m8x',
    });
  });

  it('returns null when the fragment carries only a popUp ref anchor', () => {
    const popUpOnly =
      `<a href="javascript:popUp('index.php?page=commun.PopUpDetailLots&orgAccronyme=m8x&refConsultation=977311','yes')">ref</a>`;
    expect(firstDetailLink(popUpOnly, 'https://x.ma')).toBeNull();
  });
});

// Faithful to the real Atexo detail markup (id="...idEntrepriseConsultationSummary_<field>").
const PREFIX = 'ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary';
const DETAIL_FIXTURE = `
<div>
  <span id="${PREFIX}_reference">06/BR/RGON/2026</span>
  <span id="${PREFIX}_objet">Réalisation des essais de contrôle et suivi de la qualité</span>
  <span id="${PREFIX}_categoriePrincipale">Services</span>
  <div id="${PREFIX}_panelCautionProvisoire" class="line">
    <span class="tule-240 bold">Caution provisoire : </span>
    <span id="${PREFIX}_cautionProvisoire">7 000,00 MAD </span>
  </div>
  <span id="${PREFIX}_idReferentielZoneText_titre">Estimation (en Dhs TTC)</span>
  <span style="display:none"><span id="${PREFIX}_estimation"></span></span>
</div>`;

describe('parseDetailPage', () => {
  it('pulls reference, objet, category and caution from the detail page', () => {
    const fields = parseDetailPage(DETAIL_FIXTURE);
    expect(fields.reference).toBe('06/BR/RGON/2026');
    expect(fields.objet).toContain('Réalisation des essais');
    expect(fields.categorie).toBe('Services');
    expect(fields.cautionProvisoireMad).toBe(7000);
  });

  it('leaves estimation null when hidden/absent (confidential on open tenders)', () => {
    expect(parseDetailPage(DETAIL_FIXTURE).estimationMad).toBeNull();
  });

  it('does not confuse the caution panel container with its value span', () => {
    // panelCautionProvisoire must not be picked up as the value.
    const fields = parseDetailPage(DETAIL_FIXTURE);
    expect(fields.cautionProvisoireMad).toBe(7000);
  });
});
