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
  });
});
