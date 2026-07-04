import { z } from 'zod';

/**
 * Read-side view of the published portal metadata block that the watch detail
 * crawler harvests into raw.detail (see watch/detail.crawler.ts buildDetailMeta).
 * This is the datao-parity "fiche du portail" — the fields the consultation
 * detail page publishes openly, so they render WITHOUT any LLM. The API projects
 * it onto InventoryItem.portalDetail; the web drawer renders it with a "Portail"
 * provenance badge, distinct from the DCE ("DCE") and AI ("IA") sources.
 */

const portalContactSchema = z
  .object({
    nom: z.string().nullish(),
    email: z.string().nullish(),
    telephone: z.string().nullish(),
    telecopieur: z.string().nullish(),
  })
  .partial();

const portalVisiteSchema = z.object({
  date: z.string().nullish(),
  adresse: z.string().nullish(),
});

/** Lenient: tolerate older/partial detail blocks (nullish everywhere) so a v1
 *  stub or a page that omits a field never fails the whole projection. */
const portalDetailSchema = z.object({
  v: z.number().nullish(),
  fetchedAt: z.string().nullish(),
  buyerEntity: z.string().nullish(),
  typeAnnonce: z.string().nullish(),
  typeProcedure: z.string().nullish(),
  modePassation: z.string().nullish(),
  location: z.string().nullish(),
  deadline: z.string().nullish(),
  estimationMad: z.number().nullish(),
  cautionProvisoireMad: z.number().nullish(),
  domainesActivite: z.string().nullish(),
  adresseRetrait: z.string().nullish(),
  adresseDepot: z.string().nullish(),
  lieuOuverturePlis: z.string().nullish(),
  prixAcquisitionPlansMad: z.number().nullish(),
  reserveAuxPme: z.boolean().nullish(),
  qualifications: z.string().nullish(),
  agrements: z.string().nullish(),
  prospectus: z.string().nullish(),
  reunion: z.string().nullish(),
  variante: z.boolean().nullish(),
  lotCount: z.number().nullish(),
  visites: z.array(portalVisiteSchema).default([]),
  contact: portalContactSchema.nullish(),
});

export type PortalDetail = z.infer<typeof portalDetailSchema>;

/** Parse raw.detail into a typed PortalDetail, or null when absent/invalid. */
export function readPortalDetail(
  raw: Record<string, unknown> | null | undefined,
): PortalDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const detail = (raw as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object') return null;
  const parsed = portalDetailSchema.safeParse(detail);
  return parsed.success ? parsed.data : null;
}
