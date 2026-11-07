import type {
  TerrainJourneePayload,
  TerrainJourneeStatus,
} from '@atlas/contracts';
export type JourneeAction = 'save' | 'submit' | 'return' | 'review';
export class JourneeConflict extends Error {}
export class JourneeReferenceError extends Error {}
export function assertJourneeAction(
  status: TerrainJourneeStatus,
  version: number,
  expected: number,
  action: JourneeAction,
): TerrainJourneeStatus | 'replay' {
  if (version !== expected)
    throw new JourneeConflict(
      'Version périmée; rechargez la journée avant de réessayer',
    );
  if (
    (action === 'review' && status === 'reviewed') ||
    (action === 'submit' && status === 'submitted')
  )
    return 'replay';
  if (action === 'save' && (status === 'draft' || status === 'returned'))
    return 'draft';
  if (action === 'submit' && (status === 'draft' || status === 'returned'))
    return 'submitted';
  if (status === 'submitted' && action === 'review') return 'reviewed';
  if (status === 'submitted' && action === 'return') return 'returned';
  throw new JourneeConflict(
    'Transition interdite; les journées validées sont immuables',
  );
}
export interface JourneeReferences {
  projectExists: boolean;
  assignments: Array<{ id: string; startDate: string; endDate: string | null }>;
  bpuIds: string[];
  photoIds: string[];
}
export function assertJourneeReferences(
  p: TerrainJourneePayload,
  r: JourneeReferences,
) {
  if (!r.projectExists) throw new JourneeReferenceError('Projet introuvable');
  const seen = new Set<string>();
  for (const v of p.attendance) {
    if (!v.assignmentId) continue;
    const a = r.assignments.find((a) => a.id === v.assignmentId);
    if (
      !a ||
      a.startDate > p.date ||
      (a.endDate !== null && a.endDate < p.date)
    )
      throw new JourneeReferenceError(
        'Affectation hors projet ou hors période',
      );
    if (seen.has(a.id))
      throw new JourneeReferenceError('Affectation pointée plusieurs fois');
    seen.add(a.id);
  }
  for (const v of p.production)
    if (v.bpuLigneId && !r.bpuIds.includes(v.bpuLigneId))
      throw new JourneeReferenceError('Ligne BPU hors projet');
  for (const id of [
    ...p.photoIds,
    ...p.expenses.flatMap((e) => (e.photoId ? [e.photoId] : [])),
  ])
    if (!r.photoIds.includes(id))
      throw new JourneeReferenceError('Photo hors projet ou supprimée');
}
