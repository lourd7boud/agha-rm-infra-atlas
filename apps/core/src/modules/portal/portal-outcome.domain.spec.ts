import { describe, expect, it } from 'vitest';
import {
  canonicalReferenceKey,
  computeSubmissionOutcomes,
  OUR_COMPANY_NAME,
  type OutcomeWinner,
} from './portal-outcome.domain';
import type { PortalSubmissionRecord } from './portal.repository';

/** A minimal submission record; only reference + withdrawnAt drive the verdict. */
function submission(
  reference: string,
  overrides: Partial<PortalSubmissionRecord> = {},
): PortalSubmissionRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: reference,
    reference,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** A published winner row keyed by référence. */
function winner(
  reference: string,
  bidderName: string,
  amountMad?: number,
): OutcomeWinner {
  return { reference, bidderName, ...(amountMad ? { amountMad } : {}) };
}

describe('canonicalReferenceKey', () => {
  it('folds case, spacing and punctuation in a short market code', () => {
    // Arrange / Act / Assert — the two sides reach the same join key.
    expect(canonicalReferenceKey('62/2025/DP A/IF')).toBe(
      canonicalReferenceKey('62 / 2025 / dp a / if'),
    );
    expect(canonicalReferenceKey('62/2025/DP A/IF')).toBe('62 2025 dp a if');
  });
});

describe('computeSubmissionOutcomes', () => {
  it('marks a submission gagne when WE are the published winner', () => {
    // Arrange — the winner is our own company (with a legal-form suffix).
    const submissions = [submission('62/2025/DP A/IF')];
    const winners = [
      winner('62/2025/DP A/IF', `${OUR_COMPANY_NAME} SARL`, 1_177_913.89),
    ];

    // Act
    const [result] = computeSubmissionOutcomes(submissions, winners);

    // Assert
    expect(result?.outcome).toBe('gagne');
    expect(result?.winnerName).toBe(`${OUR_COMPANY_NAME} SARL`);
    expect(result?.winnerAmountMad).toBe(1_177_913.89);
  });

  it('marks a submission perdu when a different company won', () => {
    // Arrange — a competitor is the attributaire for our market.
    const submissions = [submission('03/2026/AUAM')];
    const winners = [winner('03/2026/AUAM', 'ENTREPRISE CONCURRENTE', 980_000)];

    // Act
    const [result] = computeSubmissionOutcomes(submissions, winners);

    // Assert
    expect(result?.outcome).toBe('perdu');
    expect(result?.winnerName).toBe('ENTREPRISE CONCURRENTE');
    expect(result?.winnerAmountMad).toBe(980_000);
  });

  it('marks a submission en_attente when no winner is published yet', () => {
    // Arrange — the winners list has no row for this référence.
    const submissions = [submission('01/2026')];
    const winners: OutcomeWinner[] = [
      winner('99/2099/OTHER', 'AUTRE ENTREPRISE'),
    ];

    // Act
    const [result] = computeSubmissionOutcomes(submissions, winners);

    // Assert — no attribution, no winner fields.
    expect(result?.outcome).toBe('en_attente');
    expect(result?.winnerName).toBeUndefined();
    expect(result?.winnerAmountMad).toBeUndefined();
  });

  it('marks a submission retire when withdrawnAt is set, ignoring any winner', () => {
    // Arrange — we withdrew, even though a competitor is the published winner.
    const submissions = [
      submission('62/2025/DP A/IF', {
        withdrawnAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ];
    const winners = [winner('62/2025/DP A/IF', 'ENTREPRISE CONCURRENTE')];

    // Act
    const [result] = computeSubmissionOutcomes(submissions, winners);

    // Assert — withdrawal wins; no winner attribution is attached.
    expect(result?.outcome).toBe('retire');
    expect(result?.winnerName).toBeUndefined();
  });

  it('joins on the canonical référence despite case/space/punct drift', () => {
    // Arrange — our listing and the public notice spell the code differently.
    const submissions = [submission('62/2025/DP A/IF')];
    const winners = [winner('62 / 2025 / dp a / if', OUR_COMPANY_NAME)];

    // Act
    const [result] = computeSubmissionOutcomes(submissions, winners);

    // Assert — the fold lets the two sides meet → gagne.
    expect(result?.outcome).toBe('gagne');
  });

  it('returns one verdict per submission, preserving input order', () => {
    // Arrange — three markets, three distinct outcomes.
    const submissions = [
      submission('A/1'),
      submission('B/2'),
      submission('C/3', { withdrawnAt: new Date('2026-03-01T00:00:00Z') }),
    ];
    const winners = [
      winner('A/1', OUR_COMPANY_NAME),
      winner('B/2', 'ENTREPRISE CONCURRENTE'),
    ];

    // Act
    const outcomes = computeSubmissionOutcomes(submissions, winners);

    // Assert
    expect(outcomes.map((o) => o.outcome)).toEqual([
      'gagne',
      'perdu',
      'retire',
    ]);
  });
});
