import { describe, expect, it } from 'vitest';
import { extractDossierDecisionExcerpts } from './dossier-decision-evidence';
import type { DossierFileOcr, DossierFileOcrPage } from './dossier-file-ocr';

function makeFile(filename: string, hashCharacter: string, pages: DossierFileOcrPage[]): DossierFileOcr {
  return {
    version: 1,
    engine: 'local-ocr',
    filename,
    sha256: hashCharacter.repeat(64),
    sizeBytes: 32_000,
    checkedAt: '2026-11-13T19:30:00Z',
    totalPages: pages.length,
    pagesProcessed: pages.length,
    coverage: 'complete',
    state: 'text',
    pages,
  };
}

function textPage(num: number, text: string): DossierFileOcrPage {
  return { num, state: 'text', text, textTruncated: false };
}

describe('extractDossierDecisionExcerpts', () => {
  it('selects decision passages from the RC and CPS and preserves exact source locations', () => {
    const rc = makeFile('DCE/RC AO 41.pdf', 'a', [
      textPage(2, 'SOMMAIRE\nARTICLE 07 : VISITE DES LIEUX ........ 5\nARTICLE 09 : DOSSIER ADMINISTRATIF ........ 7'),
      textPage(5, 'TITRE II - PRÉPARATION DES OFFRES\nARTICLE 07 : VISITE DES LIEUX\nLes concurrents ou leurs représentants désignés sont informés qu’une visite des lieux et une réunion d’information auront lieu au siège du Département du Port de Kénitra et Mehdia le 27/11/2026 à partir de 10h 00.'),
      textPage(7, 'ARTICLE 09 : DOSSIER ADMINISTRATIF\nLe dossier administratif comprend les pièces suivantes : déclaration sur l’honneur et attestation.\nLe cautionnement provisoire est fixé à 20 000 dirhams. Le récépissé est transmis électroniquement.'),
      textPage(9, '5) Certificat de qualification et de classification\nPour les concurrents installés au Maroc : une copie du certificat justifiant la qualification C1 et la classe 4.'),
      textPage(11, 'ARTICLE 15 : DÉPÔT DES PLIS\nLes offres doivent être déposées exclusivement par voie électronique sur le portail au plus tard le 02/12/2026.'),
      textPage(12, 'ARTICLE 16 : DÉLAI D’EXÉCUTION\nCe délai court à compter de l’ordre de service et il est fixé à six mois.'),
    ]);
    const cps = makeFile('CPS AO 41.pdf', 'b', [
      textPage(8, 'Pour les concurrents installés au Maroc : le certificat de qualification et de classification justifie la qualification C1 et la classe 4.'),
      textPage(14, 'ARTICLE 16 : DÉLAI D’EXÉCUTION\nLe délai court à compter de l’ordre de service et il est fixé à six mois.'),
    ]);

    const excerpts = extractDossierDecisionExcerpts([cps, rc]);
    expect(excerpts.map(result => [result.topic, result.filename, result.page])).toEqual([
      ['visit', rc.filename, 5],
      ['qualifications', rc.filename, 9],
      ['guarantee', rc.filename, 7],
      ['submission', rc.filename, 11],
      ['required_documents', rc.filename, 7],
      ['execution', cps.filename, 14],
    ]);
    expect(excerpts.find(item => item.topic === 'visit')?.quote).toContain('27/11/2026');
    for (const item of excerpts) {
      const file = [rc, cps].find(candidate => candidate.filename === item.filename);
      const page = file?.pages.find(candidate => candidate.num === item.page);
      expect(item.sha256).toBe(file?.sha256);
      expect(page?.text.replace(/\s+/gu, ' ')).toContain(item.quote);
      expect(item.quote.length).toBeLessThanOrEqual(300);
    }
    expect(extractDossierDecisionExcerpts([rc, cps])).toEqual(excerpts);
  });

  it('ignores continuation tables of contents, unreadable pages and other PDFs', () => {
    const toc = 'ARTICLE 07 : VISITE DES LIEUX OBLIGATOIRE ........ 5\n' +
      'ARTICLE 09 : DOSSIER ADMINISTRATIF ET ATTESTATIONS ........ 7\n' +
      'ARTICLE 12 : DÉPÔT ELECTRONIQUE DES OFFRES ........ 9';
    const text = 'ARTICLE 07 : VISITE DES LIEUX\nLa visite des lieux est obligatoire pour les concurrents et aura lieu le 27/11/2026.';
    const rc = makeFile('RC.pdf', 'a', [textPage(2, toc), { ...textPage(5, text), state: 'no_text' }]);
    const unrelated = makeFile('BPU.pdf', 'b', [textPage(1, text)]);
    expect(extractDossierDecisionExcerpts([rc, unrelated])).toEqual([]);
  });

  it('does not stitch around a contents row or fabricate a missing date', () => {
    const first = 'Une visite des lieux est indiquée dans cet article et les modalités détaillées figurent dans le document.';
    const other = 'La séance de cette commission aura lieu le 27/11/2026.';
    const rc = makeFile('Règlement de consultation.pdf', 'a', [textPage(3, `${first}\nDossier administratif .... 7\n${other}`)]);
    expect(extractDossierDecisionExcerpts([rc])).toEqual([]);
  });

  it('points to the qualification table and preserves the full negation of a visit obligation', () => {
    const rc = makeFile('RC.pdf', 'a', [
      textPage(5, 'ARTICLE 07 : VISITE DES LIEUX\nLes concurrents sont informés qu’une visite des lieux et une réunion auront lieu au port le 27/11/2026 à partir de 10h 00. '
        + 'Précisions sur la préparation de l’offre. '.repeat(10)
        + 'La présence des concurrents à la réunion ou la visite des lieux n’est pas obligatoire. L’absence ne constitue pas un motif d’élimination.'),
      textPage(9, 'Certificat de qualification et de classification. Pour les concurrents installés au Maroc : une copie du certificat justifiant les classifications exigées.'),
      textPage(10, 'Secteur d’activité               Qualification         Classe\n\nC1\nC\nRéseaux de conduites sous pression           4\nM1\nM\nTravaux courants de plomberie sanitaire     4\nNB : règles de groupement.'),
    ]);
    const excerpts = extractDossierDecisionExcerpts([rc]);
    const visit = excerpts.find(item => item.topic === 'visit');
    expect(visit?.page).toBe(5);
    expect(visit?.quote).toContain('n’est pas obligatoire');
    const qualifications = excerpts.find(item => item.topic === 'qualifications');
    expect(qualifications?.page).toBe(10);
    expect(qualifications?.layout).toBe('table');
    expect(qualifications?.quote).toContain('M1');
  });
});
