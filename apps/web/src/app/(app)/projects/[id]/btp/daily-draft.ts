import type { TerrainJourneePayload } from '@atlas/contracts';

export interface LocalDailyDraft {
  id: string;
  version: number;
  payload: TerrainJourneePayload;
  savedAt: string;
}
export function dailyDraftKey(account: string, project: string, date: string) {
  return `atlas:terrain:journee:v1:${encodeURIComponent(account)}:${encodeURIComponent(project)}:${date}`;
}
export function readDailyDraft(raw: string | null): LocalDailyDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LocalDailyDraft;
    if (
      typeof v.id !== 'string' ||
      !Number.isInteger(v.version) ||
      v.version < 0 ||
      typeof v.savedAt !== 'string' ||
      !v.payload
    )
      return null;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v.payload.date) ||
      typeof v.payload.zone !== 'string' ||
      typeof v.payload.summary !== 'string'
    )
      return null;
    for (const key of [
      'attendance',
      'production',
      'equipment',
      'materials',
      'expenses',
      'blockers',
    ] as const) {
      if (
        !Array.isArray(v.payload[key]) ||
        v.payload[key].some(
          (row) =>
            !row ||
            typeof row.id !== 'string' ||
            Object.values(row).some(
              (value) =>
                value !== null &&
                !['string', 'number', 'boolean'].includes(typeof value),
            ),
        )
      )
        return null;
    }
    if (
      !Array.isArray(v.payload.photoIds) ||
      v.payload.photoIds.some((id) => typeof id !== 'string')
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
export function recoveryIsStale(
  local: LocalDailyDraft,
  server?: { id: string; version: number },
) {
  return (
    !!server && (local.id !== server.id || local.version !== server.version)
  );
}
export function emptyDaily(date: string): TerrainJourneePayload {
  return {
    date,
    zone: '',
    summary: '',
    attendance: [],
    production: [],
    equipment: [],
    materials: [],
    expenses: [],
    blockers: [],
    photoIds: [],
  };
}
