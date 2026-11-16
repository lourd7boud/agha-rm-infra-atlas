import { computeDelaiInfo, type ArretTravaux } from './btp-registres.domain';

export function resolveRevisionDates(
  project: {
    ordreServiceDate: Date | null;
    executionStartDate?: Date | null;
    dateLimiteRemiseOffres: Date | null;
    typeMarche: string | null;
    modePassation: string | null;
    delaiMois: number | string | null;
    arrets: unknown;
  },
  config: { baseDate: Date | null; contractDeadline: Date | null } | null | undefined,
  extraDelaiMois = 0,
) {
  const mode = project.modePassation?.normalize('NFD').replace(/\p{M}/gu, '') ?? '';
  const negotiated = project.typeMarche === 'negocie' || /negoci/i.test(mode);
  const calendar = computeDelaiInfo({
    ordreServiceDate: project.ordreServiceDate,
    executionStartDate: project.executionStartDate,
    delaiMois: project.delaiMois == null ? null : Number(project.delaiMois),
    extraDelaiMois,
    arrets: (project.arrets ?? []) as ArretTravaux[],
    receptionProvisoire: null,
    receptionDefinitive: null,
  });
  return {
    baseDate: config?.baseDate ?? (!negotiated ? project.dateLimiteRemiseOffres : null),
    baseSource: config?.baseDate ? 'configuration' : !negotiated && project.dateLimiteRemiseOffres ? 'offres' : null,
    contractDeadline: config?.contractDeadline ?? calendar.dateFinEffective,
    deadlineSource: config?.contractDeadline ? 'configuration' : calendar.dateFinEffective ? 'calendrier' : null,
  };
}
