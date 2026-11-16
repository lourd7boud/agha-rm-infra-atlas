import { describe, expect, it } from 'vitest';
import { buildSamirReview } from './samir-review';

const source = 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=1058286&orgAcronyme=o8p';
const record = {
  sourceUrl: source,
  deadlineAt: new Date('2026-12-03T10:00:00Z'),
  estimationMad: 600000,
  cautionProvisoireMad: 12000,
  raw: { detail: { url: source, fetchedAt: '2026-11-11T22:52:10.344Z', deadline: 'Jeu 03 Dec 2026 10:00', cautionProvisoireMad: 12000 } },
};
const archived = { state: 'available', cachedAt: '2026-11-10T22:45:13.155Z', filename: 'DAO.zip' } as const;

describe('Samir phase-one evidence review', () => {
  it('confirms only a dated source-matched revision when the archive is available', () => {
    const revision = { version: 1, officialIdentity: '1058286/o8p', checkedAt: '2026-11-13T20:00:00Z',
      state: 'unchanged', previousArchiveSha256: 'a'.repeat(64), sourceArchiveSha256: 'a'.repeat(64),
      documentsIdentical: true, changedFiles: [], addedFiles: [], removedFiles: [] };
    const now = new Date('2026-11-13T21:00:00Z');
    const checked = { ...record, raw: { ...record.raw, dossierRevision: revision } };
    expect(buildSamirReview(checked, { ...archived, integrity: 'matched' }, now).documents.currentRevision).toBe('confirmed_as_of');
    for (const integrity of ['mismatch', 'unavailable', undefined] as const) {
      expect(buildSamirReview(checked, { ...archived, integrity }, now).documents.currentRevision).toBe('unverified');
    }
    expect(buildSamirReview(checked, { state: 'not_cached' }, now).documents.currentRevision).toBe('unverified');
    const matchedArchive = { ...archived, integrity: 'matched' } as const;
    expect(buildSamirReview({ ...checked, raw: { ...checked.raw, dossierRevision: { ...revision, officialIdentity: '1/x' } } }, matchedArchive, now)
      .documents.currentRevision).toBe('unverified');
    expect(buildSamirReview({ ...checked, raw: { ...checked.raw, dossierRevision: { ...revision, checkedAt: '2026-11-14T20:00:00Z' } } }, matchedArchive, now)
      .documents.currentRevision).toBe('unverified');
  });
  it('keeps the dated comparison while flagging a separate published complement for verification', () => {
    const revision = { version: 1, officialIdentity: '1058286/o8p', checkedAt: '2026-11-13T20:00:00Z',
      state: 'unchanged', previousArchiveSha256: 'a'.repeat(64), sourceArchiveSha256: 'a'.repeat(64),
      documentsIdentical: true, changedFiles: [], addedFiles: [], removedFiles: [] };
    const detail = { ...record.raw.detail, dceComplement: 'listed', fetchedAt: '2026-11-13T20:30:00Z' };
    const checked = { ...record, raw: { detail, dossierRevision: revision } };
    const now = new Date('2026-11-13T21:00:00Z');
    expect(buildSamirReview(checked, { ...archived, integrity: 'matched' }, now).documents).toMatchObject({
      currentRevision: 'unverified', revision, complement: { state: 'listed', observedAt: detail.fetchedAt },
    });
    const unrelated = { ...checked, raw: { ...checked.raw, detail: { ...detail, url: source.replace('1058286','654321') } } };
    expect(buildSamirReview(unrelated, archived, now).documents).not.toHaveProperty('complement');
  });
  it('confirms a matching saved notice and distinguishes the archive from current official revision', () => {
    const result = buildSamirReview(record, archived);
    expect(result).toMatchObject({
      source: { identity: '1058286/o8p', state: 'matched_snapshot', observedAt: '2026-11-11T22:52:10.344Z' },
      checks: { deadline: 'matched', caution: 'matched', estimate: 'unverified' },
      documents: { state: 'available', currentRevision: 'unverified', cachedAt: archived.cachedAt },
    });
  });

  it('withholds field comparisons when an archived detail belongs to a different official ID', () => {
    const result = buildSamirReview({
      ...record, raw: { detail: { ...record.raw.detail, url: source.replace('1058286', '1055984') } },
    }, { state: 'not_cached' });
    expect(result.source).toMatchObject({ state: 'mismatched_snapshot', observedAt: null });
    expect(result.checks).toEqual({ deadline: 'unverified', caution: 'unverified', estimate: 'unverified' });
    expect(result.documents.state).toBe('not_cached');
  });

  it('flags a published conflicting deadline and does not accept a lookalike domain', () => {
    const conflict = buildSamirReview({ ...record, deadlineAt: new Date('2026-12-02T10:00:00Z') }, archived);
    expect(conflict.checks.deadline).toBe('conflict');
    expect(buildSamirReview({ ...record, sourceUrl: source.replace('gov.ma', 'gov.ma.example.org') }, archived).source.state)
      .toBe('no_official_source');
  });
});
