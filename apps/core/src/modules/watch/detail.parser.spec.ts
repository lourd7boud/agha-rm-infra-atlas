import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractDetailLinks,
  firstDetailLink,
  parseDetailPage,
  parseMoneyMad,
} from './detail.parser';

// The byte-for-byte HTTP response our anonymous crawler receives for consultation
// 1020081 (page=entreprise.EntrepriseDetailsConsultation). Every summary field is
// present in the server HTML (display:none until "+" is clicked) — this fixture
// proves the crawler can harvest the whole published metadata block offline.
const REAL_DETAIL = readFileSync(
  join(process.cwd(), 'src/modules/watch/fixtures/detail-consultation-real.html'),
  'utf8',
);

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

  it('parses a legitimate zero (prix acquisition des plans)', () => {
    expect(parseMoneyMad('0,00 MAD ')).toBe(0);
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

describe('parseDetailPage — the four legacy fields', () => {
  it('pulls reference, objet, category and caution', () => {
    const f = parseDetailPage(REAL_DETAIL);
    expect(f.reference).toBe('12/2026');
    expect(f.objet).toContain('PRESTATIONS DE DÉVERSEMENT');
    expect(f.categorie).toBe('Services');
    expect(f.cautionProvisoireMad).toBe(27000);
  });
});

describe('parseDetailPage — estimation via ReferentielZoneText (the fixed bug)', () => {
  it('reads the published estimation from the repeater, NOT the non-existent _estimation id', () => {
    // Before the fix the parser keyed on id="…Summary_estimation" which does not
    // exist in the real markup, so estimation was always null. The real value
    // (1 399 968,00) lives in RepeaterReferentielZoneText_ctl0_labelReferentielZoneText.
    expect(parseDetailPage(REAL_DETAIL).estimationMad).toBe(1399968);
  });

  it('stays null when no zone-text titre mentions estimation', () => {
    const noEstimation = `
      <span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_reference">1/2026</span>
      <span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_idReferentielZoneText_RepeaterReferentielZoneText_ctl0_titre">Délai (jours)</span>
      <span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_idReferentielZoneText_RepeaterReferentielZoneText_ctl0_labelReferentielZoneText" class="content-bloc">45</span>`;
    expect(parseDetailPage(noEstimation).estimationMad).toBeNull();
  });
});

describe('parseDetailPage — the full published metadata block', () => {
  it('harvests every atomic field the portal publishes', () => {
    const f = parseDetailPage(REAL_DETAIL);
    expect(f.buyerEntity).toBe('RMTA / CUKS - Commune urbaine de KELAAT SRAGHNA');
    expect(f.typeAnnonce).toBe('Annonce de consultation');
    expect(f.typeProcedure).toBe("Appel d'offres ouvert");
    expect(f.modePassation).toBe('Sur offre de prix');
    expect(f.location).toBe('MAROC, EL KELAA DES SRAGHNA');
    expect(f.deadline).toBe('27/07/2026 11:00');
    expect(f.domainesActivite).toContain('Collecte des déchets ménagers');
    expect(f.adresseRetrait).toBe('PORTAIL DES MARCHES PUBLICS');
    expect(f.adresseDepot).toBe('PORTAIL DES MARCHES PUBLICS');
    expect(f.lieuOuverturePlis).toBe("BUREAUX DE LA COMMUNE D'EL KELAA SRAGHNA");
    expect(f.prixAcquisitionPlansMad).toBe(0);
    expect(f.reserveAuxPme).toBe(false);
    expect(f.qualifications).toBe('-');
    expect(f.agrements).toBe('-');
    expect(f.prospectus).toBe('-');
    expect(f.reunion).toBe('-');
    expect(f.variante).toBe(false);
    expect(f.lotCount).toBeNull(); // non-allotti → nbrLots empty
  });

  it('extracts the visites des lieux repeater (date + adresse pairs)', () => {
    const f = parseDetailPage(REAL_DETAIL);
    expect(f.visites).toHaveLength(1);
    expect(f.visites[0]?.date).toBe('16/07/2026 10:30');
    expect(f.visites[0]?.adresse).toContain('DÉCHARGE PUBLIQUE DE LA COMMUNE');
  });

  it('extracts the administrative contact incl. télécopieur', () => {
    const f = parseDetailPage(REAL_DETAIL);
    expect(f.contact.nom).toBe('FARID ELOFI');
    expect(f.contact.email).toBe('farid.elofi@gmail.com');
    expect(f.contact.telephone).toBe('0661179143');
    expect(f.contact.telecopieur).toBe('0524411380');
  });
});

describe('parseDetailPage — robustness', () => {
  it('returns nulls/empties for an unrelated page without throwing', () => {
    const f = parseDetailPage('<html><body>Not a consultation</body></html>');
    expect(f.reference).toBeNull();
    expect(f.estimationMad).toBeNull();
    expect(f.buyerEntity).toBeNull();
    expect(f.reserveAuxPme).toBeNull();
    expect(f.variante).toBeNull();
    expect(f.visites).toEqual([]);
    expect(f.contact).toEqual({
      nom: null,
      email: null,
      telephone: null,
      telecopieur: null,
    });
  });

  it('reads "Oui" as reserveAuxPme=true', () => {
    const html = `<span id="x_idRefRadio_RepeaterReferentielRadio_ctl0_labelReferentielRadio" class="content-bloc">Oui</span>`;
    expect(parseDetailPage(html).reserveAuxPme).toBe(true);
  });

  it('parses an allotissement lot count when present', () => {
    const html = `<span id="ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_nbrLots">4</span>`;
    expect(parseDetailPage(html).lotCount).toBe(4);
  });
});
