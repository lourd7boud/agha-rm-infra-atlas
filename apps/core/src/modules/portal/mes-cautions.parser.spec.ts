import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  parseMesCautions,
  parseMesCautionsDetailed,
} from './mes-cautions.parser';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/portal/fixtures/mes-cautions.html'),
  'utf8',
);

describe('parseMesCautions', () => {
  test('extracts every well-formed caution, skipping the corrupted row', () => {
    // Arrange / Act
    const { cautions, skipped } = parseMesCautionsDetailed(FIXTURE);

    // Assert
    expect(cautions).toHaveLength(3);
    expect(skipped).toHaveLength(1);
    expect(parseMesCautions(FIXTURE)).toHaveLength(3);
  });

  test('parses the montant with space thousands and comma decimal', () => {
    // Arrange
    const [validee, rejetee, brouillon] = parseMesCautions(FIXTURE);

    // Act / Assert — NBSP/space thousands separator, comma decimal, "MAD" dropped.
    expect(validee!.amountMad).toBe(7700);
    expect(rejetee!.amountMad).toBe(1177913.89);
    // Brouillon row carries no montant line → undefined, not 0.
    expect(brouillon!.amountMad).toBeUndefined();
  });

  test('maps the lifecycle statut for each row', () => {
    // Arrange
    const [validee, rejetee, brouillon] = parseMesCautions(FIXTURE);

    // Act / Assert
    expect(validee!.statut).toBe('Validée par la banque');
    expect(rejetee!.statut).toBe('Rejetée par la banque');
    expect(brouillon!.statut).toBe('Brouillon');
  });

  test('extracts bankName, intitulé and the demande PDF filename', () => {
    // Arrange
    const [validee, rejetee] = parseMesCautions(FIXTURE);

    // Act / Assert
    expect(validee!.bankName).toBe('Caisse de Dépôt et de Gestion');
    expect(validee!.intitule).toBe('CAUTION PROVISOIRE');
    expect(validee!.demandeFile).toBe('Demande_Caution_CDG_1191740.pdf');

    expect(rejetee!.bankName).toBe(
      "Banque marocaine pour le commerce et l'industrie",
    );
    expect(rejetee!.intitule).toBe('caution provisoire');
    expect(rejetee!.demandeFile).toBe('Demande_Caution_BMCI_1188002.pdf');
  });

  test('maps reference/procedure/category and objet/organisme/deadline', () => {
    // Arrange
    const [validee] = parseMesCautions(FIXTURE);

    // Act / Assert — labels are trimmed off the values.
    expect(validee!.reference).toBe('01/2026');
    expect(validee!.procedure).toBe('AOO ouvert');
    expect(validee!.category).toBe('Travaux');
    expect(validee!.objet).toContain("pont sur oued N'Fis");
    expect(validee!.organisme).toBe(
      "Direction Régionale de l'Équipement de Marrakech",
    );
    // "06/04/2026 10:00" PMMP local (UTC+1) → 09:00 UTC.
    expect(validee!.deadlineAt?.toISOString()).toBe('2026-04-06T09:00:00.000Z');
  });

  test('returns no cautions on a page without the results table', () => {
    // Arrange / Act
    const outcome = parseMesCautionsDetailed(
      '<html><body>maintenance</body></html>',
    );

    // Assert
    expect(outcome.cautions).toEqual([]);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.surfaceDetected).toBe(false);
    expect(outcome.candidateRows).toBe(0);
  });

  test('accepts the portal results-table shape without tbody and extracts consultation id', () => {
    // Arrange — the authenticated portal uses the same direct-TR result-table idiom.
    const liveShape = `
      <table class="table-results">
        <tr><th>Référence</th><th>Marché</th><th>Caution</th><th>Statut</th><th>Actions</th></tr>
        <tr>
          <td>
            <span class="ref"> 01/2026 </span><br>
            AOO
            <div class="info-bulle"><div>Appel d'offres ouvert</div></div><br>
            Travaux
          </td>
          <td>
            <div><strong>Objet :</strong> Construction d'un ouvrage</div>
            <div><strong>Organisme :</strong> Commune test</div>
            <div><strong>Date limite de remise des plis :</strong> 06/04/2026 10:00:00</div>
          </td>
          <td>
            <div><strong>Banque :</strong> Banque test</div>
            <div><strong>Intitulé :</strong> CAUTION PROVISOIRE</div>
            <div><strong>Montant :</strong> 7&nbsp;700,00 MAD</div>
            <a>Demande_Caution_TEST_984959.pdf</a>
          </td>
          <td>Validée par la banque</td>
          <td><a href="index.php?page=entreprise.EntrepriseDetailsConsultation&amp;refConsultation=984959">Consulter</a></td>
        </tr>
      </table>`;

    // Act
    const outcome = parseMesCautionsDetailed(liveShape);

    // Assert
    expect(outcome.skipped).toEqual([]);
    expect(outcome.surfaceDetected).toBe(true);
    expect(outcome.candidateRows).toBe(1);
    expect(outcome.cautions).toHaveLength(1);
    expect(outcome.cautions[0]).toMatchObject({
      reference: '01/2026',
      procedure: "Appel d'offres ouvert",
      category: 'Travaux',
      amountMad: 7700,
      consultationId: '984959',
    });
  });
});
