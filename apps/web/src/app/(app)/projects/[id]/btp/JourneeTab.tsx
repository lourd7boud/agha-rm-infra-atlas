import { apiGet } from '@/lib/api';
import type {
  Asset,
  Bordereau,
  BtpProjectDetail,
  TerrainCrewMember,
} from '@/lib/btp';
import { dailyIdentity, dailyRecords } from './daily-actions';
import { DailyEditor } from './DailyEditor';

export async function JourneeTab({
  project,
  date,
}: {
  project: BtpProjectDetail;
  date?: string;
}) {
  const [identity, records, crew, bordereau, photos] = await Promise.all([
    dailyIdentity(),
    dailyRecords(project.id).catch(() => null),
    apiGet<{ crew: TerrainCrewMember[] }>(
      `/btp/projects/${project.id}/terrain/pointage`,
    ).catch(() => null),
    apiGet<Bordereau>(`/btp/projects/${project.id}/bordereau`).catch(
      () => null,
    ),
    apiGet<Asset[]>(`/btp/projects/${project.id}/assets?type=photo`).catch(
      () => null,
    ),
  ]);
  return (
    <DailyEditor
      initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined}
      projectId={project.id}
      accountScope={identity.accountScope}
      canReview={identity.canReview}
      initialRecords={records ?? []}
      journalUnavailable={records === null}
      crew={crew?.crew ?? []}
      bpu={(bordereau?.lignes ?? [])
        .filter((l) => !!l.id)
        .map((l) => ({
          id: l.id!,
          label: `${l.numero} — ${l.designation}`,
          unite: l.unite,
        }))}
      photos={(photos ?? []).map((p) => ({
        id: p.id,
        label: p.originalName ?? p.fileName ?? p.id,
      }))}
      referenceWarning={!crew || !bordereau || !photos}
    />
  );
}
