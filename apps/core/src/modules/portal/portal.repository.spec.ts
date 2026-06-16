import { describe, expect, it } from 'vitest';
import { InMemoryPortalRepository } from './portal.repository';

const DEADLINE = new Date('2026-07-01T10:00:00Z');

describe('InMemoryPortalRepository.upsertSubmission', () => {
  it('inserts a new soumission and reports the action', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act
    const action = await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      objet: 'travaux VRD',
      organisme: 'ORMVAH',
    });

    // Assert
    expect(action).toBe('inserted');
    expect(await repo.listSubmissions(10)).toHaveLength(1);
  });

  it('re-upserts the same (reference, deadline) without duplicating the row', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      objet: 'travaux VRD',
    });

    // Act
    const action = await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      objet: 'travaux VRD',
    });

    // Assert
    expect(action).toBe('updated');
    expect(await repo.listSubmissions(10)).toHaveLength(1);
  });

  it('back-fills the consultation id a thin listing row lacked', async () => {
    // Arrange: the listing row carried no internal consultation id.
    const repo = new InMemoryPortalRepository();
    await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      objet: 'travaux VRD',
    });

    // Act: a detail crawl supplies the consultation id for the same key.
    const action = await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      consultationId: '849321',
    });

    // Assert: enriched in place, no duplicate row.
    expect(action).toBe('updated');
    const [row] = await repo.listSubmissions(10);
    expect(row?.consultationId).toBe('849321');
    expect(row?.objet).toBe('travaux VRD');
  });

  it('never erases a known field with an incoming null', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await repo.upsertSubmission({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      objet: 'travaux VRD',
      organisme: 'ORMVAH',
      consultationId: '849321',
    });

    // Act: a sparse re-crawl omits objet/organisme/consultationId.
    await repo.upsertSubmission({ reference: 'AO-12/2026', deadlineAt: DEADLINE });

    // Assert: prior values survive.
    const [row] = await repo.listSubmissions(10);
    expect(row?.objet).toBe('travaux VRD');
    expect(row?.organisme).toBe('ORMVAH');
    expect(row?.consultationId).toBe('849321');
  });
});

describe('InMemoryPortalRepository.upsertCaution', () => {
  it('inserts a new caution and reports the action', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();

    // Act
    const action = await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
      bankName: 'BMCE',
      statut: 'demandée',
    });

    // Assert
    expect(action).toBe('inserted');
    expect(await repo.listCautions(10)).toHaveLength(1);
  });

  it('re-upserts the same (reference, deadline, amount) without duplicating the row', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
    });

    // Act
    const action = await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
    });

    // Assert
    expect(action).toBe('updated');
    expect(await repo.listCautions(10)).toHaveLength(1);
  });

  it('treats a different amount as a distinct caution', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
    });

    // Act: same ref + deadline, different amount → new row.
    const action = await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 75_000,
    });

    // Assert
    expect(action).toBe('inserted');
    expect(await repo.listCautions(10)).toHaveLength(2);
  });

  it('never erases a known field with an incoming null', async () => {
    // Arrange
    const repo = new InMemoryPortalRepository();
    await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
      bankName: 'BMCE',
      statut: 'demandée',
    });

    // Act: a sparse re-crawl omits bankName/statut.
    await repo.upsertCaution({
      reference: 'AO-12/2026',
      deadlineAt: DEADLINE,
      amountMad: 50_000,
    });

    // Assert: prior values survive.
    const [row] = await repo.listCautions(10);
    expect(row?.bankName).toBe('BMCE');
    expect(row?.statut).toBe('demandée');
  });
});
