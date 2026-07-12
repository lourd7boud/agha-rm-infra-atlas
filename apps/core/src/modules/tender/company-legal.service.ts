import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';
import {
  COMPTA_REPOSITORY,
  type ComptaRepository,
  type ProfilRecord,
} from '../compta/compta.repository';
import {
  COMPTA_REGISTRES_REPOSITORY,
  type ComptaRegistresRepository,
  type LegalDocumentRecord,
} from '../compta/compta-registres.repository';
import {
  readCachedLegalDocText,
  extractAndCacheLegalDocText,
} from './legal-doc-text';
import { TtlCache } from '../../lib/ttl-cache';

/** Overall budget for the company legal block in the chat context. */
export const MAX_LEGAL_CONTEXT_CHARS = 30_000;
/** The legal dossier is company-wide (shared by every tender), so cache it. */
const LEGAL_CTX_TTL_MS = 10 * 60 * 1000;

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '—';
}

export interface LegalDocWithText {
  record: LegalDocumentRecord;
  text: string;
}

/**
 * Pure renderer: the company's legal IDENTITY (raison sociale, RC, IF, ICE, TP,
 * CNSS, gérant, siège — the exact identifiers the agent needs to fill a tender's
 * administrative dossier) + every legal DOCUMENT in the coffre with its metadata
 * AND full extracted content (not just titles). Source of truth: /compta/legal.
 */
export function buildCompanyLegalMarkdown(
  profil: ProfilRecord,
  docs: readonly LegalDocWithText[],
  now: Date,
): string {
  const lines: string[] = [
    '=== IDENTITÉ LÉGALE — AGHA RM INFRA (source officielle: /compta/legal) ===',
    `Raison sociale: ${profil.raisonSociale} (${profil.formeJuridique})`,
  ];
  if (profil.registreCommerce) lines.push(`Registre de commerce (RC): ${profil.registreCommerce}`);
  if (profil.identifiantFiscal) lines.push(`Identifiant fiscal (IF): ${profil.identifiantFiscal}`);
  if (profil.ice) lines.push(`ICE: ${profil.ice}`);
  if (profil.taxeProfessionnelle) lines.push(`Taxe professionnelle (TP): ${profil.taxeProfessionnelle}`);
  if (profil.cnssAffiliation) lines.push(`Affiliation CNSS: ${profil.cnssAffiliation}`);
  if (profil.gerant) lines.push(`Gérant: ${profil.gerant}`);
  const siege = [profil.adresse, profil.ville].filter(Boolean).join(', ');
  if (siege) lines.push(`Siège social: ${siege}`);
  if (profil.capitalSocial != null) {
    lines.push(`Capital social: ${profil.capitalSocial.toLocaleString('fr-MA')} MAD`);
  }

  lines.push(
    `\n=== DOCUMENTS LÉGAUX DE L'ENTREPRISE (coffre /compta/legal — ${docs.length} document(s), contenu intégral) ===`,
  );
  const today = isoDate(now);
  let used = 0;
  for (const { record: d, text } of docs) {
    const meta: string[] = [`type: ${d.type}`];
    if (d.dateEmission) meta.push(`émis: ${isoDate(d.dateEmission)}`);
    if (d.dateExpiration) {
      const exp = isoDate(d.dateExpiration);
      meta.push(`expire: ${exp}${exp < today ? ' [EXPIRÉ]' : ''}`);
    }
    if (d.note) meta.push(`note: ${d.note}`);
    const header = `\n## ${d.titre} (${meta.join(' · ')})`;
    lines.push(header);
    used += header.length;
    if (used >= MAX_LEGAL_CONTEXT_CHARS) {
      lines.push('… (documents suivants tronqués — budget atteint)');
      break;
    }
    if (text) {
      const room = MAX_LEGAL_CONTEXT_CHARS - used;
      const slice = text.length > room ? text.slice(0, room) : text;
      lines.push(slice);
      used += slice.length;
    } else {
      lines.push('(contenu non textuel — probablement un scan/image; voir métadonnées ci-dessus)');
    }
  }
  return lines.join('\n');
}

/**
 * Serves the company legal context (identity + documents with full content) for
 * the chat agent. Reads from the NEW location /compta/legal (compta module), not
 * the deprecated vault. Documents' text is extracted CHEAPLY (pdf-parse + OOXML,
 * no OCR — attestations DGI/CNSS/TP ship as digital PDFs) and cached per-document
 * in MinIO; the assembled block is TTL-cached (company-wide, shared by all
 * tenders). Fully null-tolerant so the chat omits the block when compta is absent.
 */
@Injectable()
export class CompanyLegalService {
  private readonly logger = new Logger('CompanyLegal');
  private readonly cache = new TtlCache<string>();

  constructor(
    @Optional() @Inject(COMPTA_REPOSITORY) private readonly compta: ComptaRepository | null = null,
    @Optional()
    @Inject(COMPTA_REGISTRES_REPOSITORY)
    private readonly registres: ComptaRegistresRepository | null = null,
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null = null,
  ) {}

  async getLegalContextMarkdown(): Promise<string | null> {
    if (!this.compta || !this.registres) return null;
    try {
      return await this.cache.getOrCompute('legal', LEGAL_CTX_TTL_MS, () => this.build());
    } catch (e) {
      this.logger.warn(`legal context build failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async build(): Promise<string> {
    const [profil, docs] = await Promise.all([
      this.compta!.getProfil(),
      this.registres!.listDocuments(),
    ]);
    const withText: LegalDocWithText[] = [];
    for (const record of docs) {
      withText.push({ record, text: await this.getDocText(record) });
    }
    return buildCompanyLegalMarkdown(profil, withText, new Date());
  }

  /**
   * Full text of one legal document. Serves the per-doc MinIO cache — written by
   * the OCR-on-upload path (compta controller) and the re-index — so SCANNED docs
   * are already readable here. On a cache miss, extracts CHEAPLY (no OCR on the
   * chat request path) and caches; scans not yet OCR'd contribute only metadata.
   */
  private async getDocText(doc: LegalDocumentRecord): Promise<string> {
    if (!this.storage || !doc.storageKey) return '';
    const cached = await readCachedLegalDocText(this.storage, doc.id);
    if (cached !== null) return cached;
    try {
      const bytes = await this.streamToBytes(await this.getObjectStream(doc.storageKey));
      return await extractAndCacheLegalDocText(
        this.storage,
        doc.id,
        bytes,
        doc.fileName ?? 'doc.pdf',
        false,
      );
    } catch (e) {
      this.logger.warn(`legal doc text failed (${doc.id}): ${(e as Error).message}`);
      return '';
    }
  }

  private async getObjectStream(key: string): Promise<AsyncIterable<Buffer | Uint8Array>> {
    const obj = await this.storage!.getObject(key);
    return obj.body as AsyncIterable<Buffer | Uint8Array>;
  }

  private async streamToBytes(body: AsyncIterable<Buffer | Uint8Array>): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return new Uint8Array(Buffer.concat(chunks));
  }
}
