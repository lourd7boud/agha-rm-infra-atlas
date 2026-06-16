import { describe, expect, it } from 'vitest';
import {
  buildResultSearchBody,
  extractAvisDownloadUrl,
  parseFormFields,
  parseResultNoticeJson,
} from './result.parser';

const FORM = `
<form>
<input type="hidden" name="PRADO_PAGESTATE" value="ABC123STATE" />
<input type="text" name="ctl0$CONTENU_PAGE$AdvancedSearch$keyword" value="" />
<input type="submit" name="ctl0$CONTENU_PAGE$AdvancedSearch$lancerRecherche" value="Lancer la recherche" />
<input type="checkbox" name="ctl0$CONTENU_PAGE$AdvancedSearch$optX" value="1" />
<input type="checkbox" name="ctl0$CONTENU_PAGE$AdvancedSearch$optY" value="1" checked />
<select name="ctl0$CONTENU_PAGE$AdvancedSearch$annonceType">
  <option value="0">Tous</option>
  <option value="4">Résultat</option>
</select>
</form>`;

describe('parseFormFields', () => {
  it('keeps PRADO state + text + checked boxes, drops submit + unchecked', () => {
    const f = parseFormFields(FORM);
    expect(f['PRADO_PAGESTATE']).toBe('ABC123STATE');
    expect(f['ctl0$CONTENU_PAGE$AdvancedSearch$keyword']).toBe('');
    expect(f['ctl0$CONTENU_PAGE$AdvancedSearch$annonceType']).toBe('0'); // first (none selected)
    expect(f['ctl0$CONTENU_PAGE$AdvancedSearch$optY']).toBe('1'); // checked
    expect('ctl0$CONTENU_PAGE$AdvancedSearch$optX' in f).toBe(false); // unchecked
    expect('ctl0$CONTENU_PAGE$AdvancedSearch$lancerRecherche' in f).toBe(false); // submit
  });
});

describe('buildResultSearchBody', () => {
  it('sets the result filter + launch button, preserving PRADO state', () => {
    const body = new URLSearchParams(buildResultSearchBody(FORM));
    expect(body.get('ctl0$CONTENU_PAGE$AdvancedSearch$annonceType')).toBe('4');
    expect(body.get('ctl0$CONTENU_PAGE$AdvancedSearch$lancerRecherche')).toBe(
      'Lancer la recherche',
    );
    expect(body.get('PRADO_PAGESTATE')).toBe('ABC123STATE');
  });

  it('accepts an annonceType override (e.g. extrait de PV)', () => {
    const body = new URLSearchParams(buildResultSearchBody(FORM, '5'));
    expect(body.get('ctl0$CONTENU_PAGE$AdvancedSearch$annonceType')).toBe('5');
  });
});

describe('extractAvisDownloadUrl', () => {
  const DETAIL =
    '<a href="index.php?page=entreprise.EntrepriseDownloadAvisJAL&amp;refConsultation=1013455&amp;orgAcronyme=w7t&amp;idAvis=">x</a>' +
    '<a href="index.php?page=entreprise.EntrepriseDownloadAvisJAL&amp;refConsultation=1013455&amp;orgAcronyme=w7t&amp;idAvis=519778">notice</a>';

  it('picks the notice with a real idAvis and builds an absolute URL', () => {
    expect(
      extractAvisDownloadUrl(DETAIL, 'https://www.marchespublics.gov.ma/?page=x'),
    ).toBe(
      'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDownloadAvisJAL&refConsultation=1013455&orgAcronyme=w7t&idAvis=519778',
    );
  });

  it('returns null when no result notice is present', () => {
    expect(extractAvisDownloadUrl('<html></html>', 'https://x.ma')).toBeNull();
  });
});

describe('parseResultNoticeJson', () => {
  it('parses the vision answer (real shape)', () => {
    const out = parseResultNoticeJson(
      '{"attributaire":"STE GROUPE D.J.A.Y","montant_attribue_mad":1177913.89,"estimation_mad":null,"objet":"Surveillance","lisible":true}',
    );
    expect(out?.attributaire).toBe('STE GROUPE D.J.A.Y');
    expect(out?.montantMad).toBe(1177913.89);
    expect(out?.estimationMad).toBeNull();
    expect(out?.lisible).toBe(true);
  });

  it('coerces a French-formatted string montant', () => {
    const out = parseResultNoticeJson(
      'Voici: {"attributaire":"X","montant_attribue_mad":"1 250 000,50 MAD","lisible":true}',
    );
    expect(out?.montantMad).toBe(1250000.5);
  });

  it('handles an illegible notice and non-JSON', () => {
    expect(parseResultNoticeJson('{"lisible":false}')?.lisible).toBe(false);
    expect(parseResultNoticeJson('{"lisible":false}')?.attributaire).toBeNull();
    expect(parseResultNoticeJson('pas de json ici')).toBeNull();
  });
});
