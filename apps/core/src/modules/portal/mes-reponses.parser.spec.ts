import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  parseMesReponses,
  parseMesReponsesDetailed,
} from './mes-reponses.parser';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/portal/fixtures/mes-reponses.html'),
  'utf8',
);

describe('parseMesReponses', () => {
  test('extracts every well-formed soumission, skipping the corrupted row', () => {
    // Arrange / Act
    const { submissions, skipped } = parseMesReponsesDetailed(FIXTURE);

    // Assert
    expect(submissions).toHaveLength(3);
    expect(skipped).toHaveLength(1);
    expect(parseMesReponses(FIXTURE)).toHaveLength(3);
  });

  test('splits the stacked référence/procédure/catégorie cell', () => {
    // Arrange
    const [first, second] = parseMesReponses(FIXTURE);

    // Act / Assert — labels are trimmed off the values.
    expect(first!.reference).toBe('01/2026');
    expect(first!.procedure).toBe('AOO ouvert');
    expect(first!.category).toBe('Travaux');
    // A référence may itself contain slashes ("62/2025/DP A/IF") — must survive intact.
    expect(second!.reference).toBe('62/2025/DP A/IF');
    expect(second!.category).toBe('Fournitures');
  });

  test('extracts objet and organisme, dropping the contexte line', () => {
    // Arrange
    const [first] = parseMesReponses(FIXTURE);

    // Act / Assert
    expect(first!.objet).toBe(
      "Travaux de construction d'un mur de soutènement RN8 PK 12+300",
    );
    expect(first!.organisme).toBe(
      "Direction Régionale de l'Équipement de Marrakech",
    );
    // The "Contexte/Programmme :" fragment must not leak into objet.
    expect(first!.objet).not.toContain('Contexte');
  });

  test('parses deadlineAt and submittedAt as UTC dates (Morocco UTC+1)', () => {
    // Arrange
    const [first] = parseMesReponses(FIXTURE);

    // Act / Assert — "06/04/2026 10:00" PMMP local (UTC+1) → 09:00 UTC.
    expect(first!.deadlineAt?.toISOString()).toBe('2026-04-06T09:00:00.000Z');
    // "Ma réponse" 02/04/2026 14:30 local → 13:30 UTC.
    expect(first!.submittedAt?.toISOString()).toBe('2026-04-02T13:30:00.000Z');
  });

  test('sets withdrawnAt only on the withdrawn row', () => {
    // Arrange
    const [first, second, third] = parseMesReponses(FIXTURE);

    // Act / Assert
    expect(first!.withdrawnAt).toBeUndefined();
    expect(third!.withdrawnAt).toBeUndefined();
    // "Retiré le : 27/11/2025 16:45" local → 15:45 UTC.
    expect(second!.withdrawnAt?.toISOString()).toBe('2025-11-27T15:45:00.000Z');
    // The withdrawn row still keeps its own deposit timestamp (26/11/2025 09:15 → 08:15 UTC).
    expect(second!.submittedAt?.toISOString()).toBe('2025-11-26T08:15:00.000Z');
  });

  test('returns no submissions on a page without the results table', () => {
    // Arrange / Act
    const outcome = parseMesReponsesDetailed(
      '<html><body>maintenance</body></html>',
    );

    // Assert
    expect(outcome.submissions).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });
});
