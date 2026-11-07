import { describe, expect, it } from 'vitest';
import {
  dailyDraftKey,
  emptyDaily,
  readDailyDraft,
  recoveryIsStale,
} from './daily-draft';

const draft = {
  id: 'retained-client-id',
  version: 3,
  payload: emptyDaily('2026-10-27'),
  savedAt: '2026-10-27T10:00:00Z',
};
describe('daily local recovery', () => {
  it('isolates drafts by account, project and working day', () => {
    const key = dailyDraftKey('account-a', 'project-a', '2026-10-27');
    expect(key).not.toBe(dailyDraftKey('account-b', 'project-a', '2026-10-27'));
    expect(key).not.toBe(dailyDraftKey('account-a', 'project-b', '2026-10-27'));
    expect(key).not.toBe(dailyDraftKey('account-a', 'project-a', '2026-10-28'));
    expect(dailyDraftKey('a:b', 'c', '2026-10-27')).not.toBe(
      dailyDraftKey('a', 'b:c', '2026-10-27'),
    );
  });
  it('recovers incomplete input without allocating a new id or version', () => {
    const incomplete = {
      ...draft,
      payload: {
        ...draft.payload,
        zone: 'Bloc A',
        summary: '',
        materials: [
          {
            id: 'line-id',
            kind: 'receipt',
            article: 'Ciment',
            unite: '',
            quantite: '',
            prixUnitaireMad: null,
            fournisseur: null,
            bonLivraison: null,
            note: null,
          },
        ],
      },
    };
    expect(readDailyDraft(JSON.stringify(incomplete))).toEqual(incomplete);
  });
  it('rejects corrupt storage and nonprimitive row values safely', () => {
    expect(readDailyDraft('{')).toBeNull();
    expect(
      readDailyDraft(JSON.stringify({ ...draft, payload: null })),
    ).toBeNull();
    expect(
      readDailyDraft(JSON.stringify({ ...draft, version: -1 })),
    ).toBeNull();
    expect(
      readDailyDraft(
        JSON.stringify({
          ...draft,
          payload: {
            ...draft.payload,
            expenses: [{ id: 'x', label: { bad: true } }],
          },
        }),
      ),
    ).toBeNull();
  });
  it('requires comparison after concurrent edit or different record for the same day', () => {
    expect(recoveryIsStale(draft, { id: draft.id, version: 4 })).toBe(true);
    expect(recoveryIsStale(draft, { id: 'other-record', version: 3 })).toBe(
      true,
    );
    expect(recoveryIsStale(draft, { id: draft.id, version: 3 })).toBe(false);
  });
  it('does not assume presence or assign unknown prices to zero', () => {
    expect(emptyDaily('2026-10-27').attendance).toEqual([]);
    expect(emptyDaily('2026-10-27').expenses).toEqual([]);
  });
});
