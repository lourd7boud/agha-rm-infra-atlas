import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { load } from 'cheerio';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { revisionIndexImports, revisionIndexes } from '../../db/schema';
import type { ObjectStorage } from '../vault/storage';
import { readBoundedResponse } from '../tender/dossier-archive-safety';
import { runDossierFileOcr } from '../tender/dossier-file-ocr';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';
import { parseIndexBulletin } from './btp-index-bulletin.domain';
import type { Actor } from './btp-registres.repository';
import { discoverMonthlyBulletins, shiftIndexMonth, validateMonthlyBulletin } from './btp-index-sync.domain';
import { BulletinLayoutError, readOfficialIndexTable } from './btp-index-sync.reader';

export const MINISTRY_INDEX_URL = 'https://www.equipement.gov.ma/Ingenierie/Pages/Revision-des-prix-baremes-indexation.aspx';
const ORIGIN = new URL(MINISTRY_INDEX_URL).origin;
const MAX_PDF = 25 * 1024 * 1024;
const LEASE_MS = 6 * 60_000;
const SYNC_INTERVAL_MS = 15 * 60_000;
const SYSTEM_ACTOR: Actor = { sub: 'system:btp-index-sync', name: 'Synchronisation ministère' };
const status = z.enum(['provisoire', 'definitif']);
export const applyIndexImportSchema = z.strictObject({
  reference: z.string().trim().min(1).max(300),
  publishedOn: z.iso.date(),
  publicationEvidence: z.string().trim().min(1).max(1_000),
  months: z.array(z.strictObject({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    status,
    indexValues: z.record(z.string().trim().min(1).max(80), z.number().positive().max(1_000_000_000)),
  }).refine((row) => Object.keys(row.indexValues).length > 0 && Object.keys(row.indexValues).length <= 500)).min(1).max(120),
}).refine((body) => new Set(body.months.map(({ month }) => month)).size === body.months.length, { message: 'Mois en double.' });
export type ApplyIndexImport = z.infer<typeof applyIndexImportSchema>;
type ImportRow = typeof revisionIndexImports.$inferSelect;
type Dependencies = {
  fetch?: typeof fetch;
  ocr?: typeof runDossierFileOcr;
  readOfficial?: typeof readOfficialIndexTable;
  now?: () => Date;
};

function officialUrl(value: string, base = MINISTRY_INDEX_URL) {
  const url = new URL(value, base);
  if (url.origin !== ORIGIN || url.username || url.password) throw new BadRequestException('Source extérieure au ministère.');
  url.hash = '';
  return url.toString();
}

export function discoverIndexSources(html: string): { url: string; label: string }[] {
  const $ = load(html);
  const sources = new Map<string, { url: string; label: string }>();
  $('a[href]').each((_i, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    try {
      const url = officialUrl(href);
      if (!/\.pdf$/i.test(new URL(url).pathname) || !/bar[eè]me/i.test(decodeURIComponent(new URL(url).pathname))) return;
      const label = $(anchor).text().replace(/\s+/g, ' ').trim() || decodeURIComponent(new URL(url).pathname.split('/').at(-1)!);
      if (!sources.has(url) || !/dernier/i.test(sources.get(url)!.label)) {
        sources.set(url, { url, label: label.slice(0, 300) });
      }
    } catch { /* External and malformed links are not bulletin sources. */ }
  });
  return [...sources.values()];
}

function normalizeApply(input: ApplyIndexImport) {
  return {
    reference: input.reference.trim(), publishedOn: input.publishedOn, publicationEvidence: input.publicationEvidence.trim(),
    months: [...input.months].sort((a, b) => a.month.localeCompare(b.month)).map((month) => ({
      ...month, indexValues: Object.fromEntries(Object.entries(month.indexValues).sort(([a], [b]) => a.localeCompare(b))),
    })),
  };
}

export class BtpIndexImportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly fetchImpl: typeof fetch;
  private readonly ocr: typeof runDossierFileOcr;
  private readonly readOfficial: typeof readOfficialIndexTable;
  private readonly now: () => Date;
  private readonly logger = new Logger(BtpIndexImportService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;

  constructor(private readonly db: Db | null, private readonly storage: ObjectStorage, dependencies: Dependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.ocr = dependencies.ocr ?? runDossierFileOcr;
    this.readOfficial = dependencies.readOfficial ?? readOfficialIndexTable;
    this.now = dependencies.now ?? (() => new Date());
  }

  onApplicationBootstrap() {
    const enabled = process.env.BTP_INDEX_SYNC_ENABLED ?? process.env.WATCH_WORKER_ENABLED;
    if (this.db && enabled === 'true') this.schedule(1_000);
  }

  onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    this.timer = setTimeout(async () => {
      try {
        await this.synchronize();
      } catch (error) {
        this.logger.error(`Synchronisation des index indisponible : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      } finally {
        if (!this.stopping) this.schedule(SYNC_INTERVAL_MS);
      }
    }, delay);
    this.timer.unref();
  }

  private database() {
    if (!this.db) throw new ServiceUnavailableException('Le registre nécessite la base de données.');
    return this.db;
  }

  private async download(url: string, cap: number, signal: AbortSignal, allowedTargets?: Set<string>, modifiedSince?: string) {
    let current = officialUrl(url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (allowedTargets && !allowedTargets.has(current)) throw new BadRequestException('La redirection ne correspond pas à un bulletin découvert.');
      const response = await this.fetchImpl(current, { redirect: 'manual', signal, headers: {
        'User-Agent': 'ATLAS-Index-Import/1.0',
        'Accept-Encoding': 'identity',
        ...(modifiedSince ? { 'If-Modified-Since': modifiedSince } : {}),
      } });
      if (response.status === 304 && modifiedSince) return null;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new ServiceUnavailableException('Redirection du ministère invalide.');
        current = officialUrl(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ServiceUnavailableException('Le ministère n’a pas retourné le document demandé.');
      }
      return { bytes: await readBoundedResponse(response, cap), url: current, lastModified: response.headers.get('last-modified') };
    }
    throw new ServiceUnavailableException('Document inaccessible.');
  }

  async sources() {
    const page = await this.download(MINISTRY_INDEX_URL, 2 * 1024 * 1024, AbortSignal.timeout(15_000));
    return discoverIndexSources(page!.bytes.toString('utf8'));
  }

  private project(row: ImportRow) {
    return {
      id: row.id, previousImportId: row.previousImportId, sourceUrl: row.sourceUrl, filename: row.filename, sha256: row.sha256,
      observedAt: row.observedAt.toISOString(), sourceLastModified: row.sourceLastModified,
      documentDate: row.documentDate, reference: row.reference, status: row.status,
      automatic: row.createdBy === SYSTEM_ACTOR.sub,
      issues: row.issues as string[], months: row.months, ocrPages: row.ocrPages,
      ...(row.failure ? { failure: row.failure } : {}),
      retryAvailable: row.status === 'failed' || (row.status === 'extracting' && (!row.leaseExpiresAt || row.leaseExpiresAt <= this.now())),
      appliedAt: row.appliedAt?.toISOString() ?? null,
    };
  }

  private async row(id: string) {
    const [row] = await this.database().select().from(revisionIndexImports).where(eq(revisionIndexImports.id, id));
    if (!row) throw new NotFoundException('Import introuvable.');
    return row;
  }

  async list() {
    const rows = await this.database().select().from(revisionIndexImports).orderBy(desc(revisionIndexImports.observedAt)).limit(30);
    return rows.map((row) => this.project(row));
  }

  async get(id: string) { return this.project(await this.row(id)); }

  async start(sourceUrl: string, actor: Actor) {
    const url = officialUrl(sourceUrl);
    const discovered = new Set((await this.sources()).map((entry) => entry.url));
    if (!discovered.has(url)) {
      throw new BadRequestException('Choisir un bulletin trouvé sur la page du ministère.');
    }
    const file = await this.download(url, MAX_PDF, AbortSignal.timeout(45_000), discovered);
    const { row, claimed } = await this.capture(file!, actor);
    if (claimed) this.launch(row, file!.bytes);
    return this.project(row);
  }

  private async capture(file: { bytes: Buffer; url: string; lastModified: string | null }, actor: Actor) {
    const db = this.database();
    if (file.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new BadRequestException('Le fichier reçu n’est pas un PDF.');
    const sha = createHash('sha256').update(file.bytes).digest('hex');
    const key = `revision-indexes/${sha}.pdf`;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'index-import:' + sha}))`);
      const [existing] = await tx.select().from(revisionIndexImports).where(and(
        eq(revisionIndexImports.sha256, sha), eq(revisionIndexImports.sourceUrl, file.url),
        isNull(revisionIndexImports.previousImportId),
        actor.sub === SYSTEM_ACTOR.sub ? eq(revisionIndexImports.createdBy, SYSTEM_ACTOR.sub)
          : or(isNull(revisionIndexImports.createdBy), ne(revisionIndexImports.createdBy, SYSTEM_ACTOR.sub)),
      )).orderBy(desc(revisionIndexImports.observedAt)).limit(1);
      if (existing) {
        if (existing.status === 'failed' && actor.sub === SYSTEM_ACTOR.sub && !existing.sourceLastModified && file.lastModified) {
          const [refreshed] = await tx.update(revisionIndexImports).set({
            sourceLastModified: file.lastModified, observedAt: this.now(),
          }).where(eq(revisionIndexImports.id, existing.id)).returning();
          return { row: refreshed!, claimed: false };
        }
        return { row: existing, claimed: false };
      }
      await this.storage.put(key, file.bytes, 'application/pdf');
      const token = randomUUID();
      const now = this.now();
      const [created] = await tx.insert(revisionIndexImports).values({
        sourceUrl: file.url, filename: decodeURIComponent(new URL(file.url).pathname.split('/').at(-1)!).slice(0, 240),
        sha256: sha, storageKey: key, observedAt: now, sourceLastModified: file.lastModified,
        status: 'extracting', leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), createdBy: actor.sub,
      }).returning();
      return { row: created!, claimed: true };
    });
  }

  private launch(row: ImportRow, bytes?: Buffer) {
    const task = this.extract(row, bytes);
    void task.catch((error) => this.logger.error('Index extraction persistence failed', error instanceof Error ? error.message : 'unknown'));
  }

  async file(id: string) {
    const row = await this.row(id);
    const object = await this.storage.getObject(row.storageKey, AbortSignal.timeout(15_000));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_PDF) { object.body.destroy(); throw new ServiceUnavailableException('PDF conservé trop volumineux.'); }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new ConflictException('L’empreinte du PDF conservé diffère de celle de l’import.');
    return { bytes, filename: row.filename };
  }

  private async reclaim(id: string) {
    return this.database().transaction(async (tx) => {
      const [current] = await tx.select().from(revisionIndexImports).where(eq(revisionIndexImports.id, id)).for('update');
      if (!current) throw new NotFoundException('Import introuvable.');
      if (current.status === 'applied') throw new ConflictException('Ce bulletin a été enregistré. Son résultat est conservé.');
      if (current.status === 'review' || (current.leaseExpiresAt && current.leaseExpiresAt > this.now())) return { row: current, claimed: false };
      const [updated] = await tx.update(revisionIndexImports).set({
        status: 'extracting', leaseToken: randomUUID(), leaseExpiresAt: new Date(this.now().getTime() + LEASE_MS),
        failure: null, updatedAt: this.now(),
      }).where(eq(revisionIndexImports.id, id)).returning();
      return { row: updated!, claimed: true };
    });
  }

  async retry(id: string) {
    const { row, claimed } = await this.reclaim(id);
    if (claimed && row.createdBy === SYSTEM_ACTOR.sub) {
      const source = discoverMonthlyBulletins([{ url: row.sourceUrl, label: row.filename }])[0];
      if (source) {
        void this.extractAutomatic(row, source.month).catch((error) => {
          this.logger.error(`Échec de la relance du barème ${source.month}`, error);
        });
      }
    } else if (claimed) this.launch(row);
    return this.project(row);
  }

  async review(id: string, actor: Actor) {
    const row = await this.database().transaction(async (tx) => {
      const [previous] = await tx.select().from(revisionIndexImports).where(eq(revisionIndexImports.id, id)).for('update');
      if (!previous) throw new NotFoundException('Import introuvable.');
      if (previous.status !== 'applied' || !previous.appliedDigest || !/^[a-f0-9]{64}$/.test(previous.sha256)) {
        throw new ConflictException('Choisir une version enregistrée pour ouvrir une correction.');
      }
      const [existing] = await tx.select().from(revisionIndexImports).where(and(
        eq(revisionIndexImports.previousImportId, id), eq(revisionIndexImports.status, 'review'),
      )).orderBy(desc(revisionIndexImports.updatedAt)).limit(1);
      if (existing) return existing;
      const reviewedMonths = applyIndexImportSchema.safeParse(previous.appliedRequest);
      const reviewedByMonth = new Map(reviewedMonths.success
        ? reviewedMonths.data.months.map((month) => [month.month, month]) : []);
      const originalMonths = previous.months as { month: string; status: string | null; values: Record<string, number>; evidence: unknown[] }[];
      const months = originalMonths.map((month) => {
        const reviewed = reviewedByMonth.get(month.month);
        reviewedByMonth.delete(month.month);
        return reviewed ? { ...month, status: reviewed.status, values: reviewed.indexValues } : month;
      });
      for (const reviewed of reviewedByMonth.values()) months.push({
        month: reviewed.month, status: reviewed.status, values: reviewed.indexValues, evidence: [],
      });
      const [created] = await tx.insert(revisionIndexImports).values({
        previousImportId: id, sourceUrl: previous.sourceUrl, filename: previous.filename, sha256: previous.sha256,
        storageKey: previous.storageKey, observedAt: previous.observedAt, sourceLastModified: previous.sourceLastModified,
        documentDate: previous.documentDate, reference: previous.reference, status: 'review',
        months, ocrPages: previous.ocrPages, issues: previous.issues, createdBy: actor.sub, updatedAt: this.now(),
      }).returning();
      return created!;
    });
    return this.project(row);
  }

  private async extract(row: ImportRow, bytes?: Buffer) {
    const db = this.database();
    try {
      const data = bytes ?? (await this.file(row.id)).bytes;
      const ocr = await this.ocr(data, row.filename, { rotatePages: true });
      if (ocr.failureCode || ocr.coverage !== 'complete') throw new Error(ocr.failureCode ?? 'Lecture du bulletin incomplète.');
      const pages = ocr.pages.map(({ num, text }) => ({ num, text }));
      const parsed = parseIndexBulletin(pages);
      const [updated] = await db.update(revisionIndexImports).set({
        status: 'review', reference: parsed.reference, documentDate: parsed.documentDate,
        months: parsed.months, issues: parsed.issues, ocrPages: pages,
        leaseToken: null, leaseExpiresAt: null, updatedAt: this.now(),
      }).where(and(eq(revisionIndexImports.id, row.id), eq(revisionIndexImports.leaseToken, row.leaseToken!))).returning({ id: revisionIndexImports.id });
      if (!updated) this.logger.log('Discarded superseded index extraction.');
    } catch (error) {
      const failure = error instanceof Error && /^ocr_[a-z_]+$/.test(error.message) ? error.message : 'Lecture du PDF impossible ou incomplète. Réessayez.';
      await db.update(revisionIndexImports).set({
        status: 'failed', failure, leaseToken: null, leaseExpiresAt: null, updatedAt: this.now(),
      }).where(and(eq(revisionIndexImports.id, row.id), eq(revisionIndexImports.leaseToken, row.leaseToken!)));
    }
  }

  /** The normal process runs in the worker. Every approved publication uses the same registry transaction as a manual import. */
  async synchronize() {
    const db = this.database();
    const sources = await this.sources();
    const monthly = discoverMonthlyBulletins(sources);
    const latest = monthly.at(-1)?.month;
    if (!latest) throw new Error('Aucun bulletin mensuel reconnu sur la page du ministère.');
    const allowed = new Set(sources.map(({ url }) => url));
    const [lastFinal] = await db.select({ month: revisionIndexes.monthDate, publishedOn: revisionIndexes.publishedOn })
      .from(revisionIndexes).where(eq(revisionIndexes.status, 'definitif')).orderBy(desc(revisionIndexes.monthDate)).limit(1);
    const backlog = await db.select({ url: revisionIndexImports.sourceUrl }).from(revisionIndexImports)
      .where(and(eq(revisionIndexImports.createdBy, SYSTEM_ACTOR.sub), isNull(revisionIndexImports.appliedAt)));
    const unresolved = new Set(backlog.map(({ url }) => url));
    const floor = lastFinal ? shiftIndexMonth(lastFinal.month.toISOString().slice(0, 7), lastFinal.publishedOn ? -2 : 1)
      : shiftIndexMonth(latest, -6);
    const results: { month: string; status: string }[] = [];

    for (const source of monthly.filter(({ month, url }) => month >= floor || unresolved.has(url))) {
      if (this.stopping) break;
      try {
        const state = await this.syncSource(source, allowed);
        results.push({ month: source.month, status: state });
      } catch (error) {
        this.logger.warn(`${source.month} · ${error instanceof Error ? error.message : 'Échec de synchronisation'}`);
        results.push({ month: source.month, status: 'failed' });
      }
    }
    return results;
  }

  private async syncSource(source: { url: string; month: string }, allowed: Set<string>) {
    const [previous] = await this.database().select().from(revisionIndexImports).where(and(
      eq(revisionIndexImports.sourceUrl, source.url), isNull(revisionIndexImports.previousImportId),
      eq(revisionIndexImports.createdBy, SYSTEM_ACTOR.sub),
    )).orderBy(desc(revisionIndexImports.observedAt)).limit(1);
    const conditional = previous?.status === 'applied' || previous?.status === 'review'
      ? previous.sourceLastModified ?? undefined : undefined;
    const file = await this.download(source.url, MAX_PDF, AbortSignal.timeout(45_000), allowed, conditional);
    if (!file && !previous) throw new Error('Le ministère a retourné une réponse sans document.');
    const { row, claimed } = file ? await this.capture(file, SYSTEM_ACTOR) : { row: previous!, claimed: false };
    if (claimed) return this.extractAutomatic(row, source.month, file?.bytes);
    if (row.status === 'applied') return 'unchanged';
    if (row.status === 'review') return this.applyAutomatic(row, source.month);
    if (row.leaseExpiresAt && row.leaseExpiresAt > this.now()) return 'extracting';
    const retry = await this.reclaim(row.id);
    if (retry.claimed) return this.extractAutomatic(retry.row, source.month, file?.bytes);
    return retry.row.status;
  }

  private async extractAutomatic(row: ImportRow, month: string, bytes?: Buffer) {
    const lease = and(eq(revisionIndexImports.id, row.id), eq(revisionIndexImports.leaseToken, row.leaseToken!));
    let updated: ImportRow | undefined;
    try {
      const table = await this.readOfficial(bytes ?? (await this.file(row.id)).bytes);
      const issue = validateMonthlyBulletin(month, table.covers, row.sourceLastModified, row.observedAt, table.globalHeadings);
      const months = issue.months.map((period, index) => {
        const evidence = table.rows.map(({ page, code, values }) => ({
          page, code, value: values[index]!, line: `${code} ${values.join(' ')}`,
        }));
        return { ...period, values: Object.fromEntries(evidence.map(({ code, value }) => [code, value])), evidence };
      });
      [updated] = await this.database().update(revisionIndexImports).set({
        status: 'review', reference: issue.reference, months, issues: [], ocrPages: [
          ...table.covers, ...(table.globalHeadings ?? []).map((heading, i) => ({ num: 7 + i, text: heading })),
        ],
        leaseToken: null, leaseExpiresAt: null, updatedAt: this.now(),
      }).where(lease).returning();
    } catch (error) {
      const message = error instanceof BulletinLayoutError ? error.message
        : error instanceof Error ? error.message.slice(0, 350) : 'Lecture automatique impossible.';
      await this.database().update(revisionIndexImports).set({
        status: 'failed', failure: message, leaseToken: null, leaseExpiresAt: null, updatedAt: this.now(),
      }).where(lease);
      this.logger.warn(`${month} · ${message}`);
      return 'failed';
    }
    return updated ? this.applyAutomatic(updated, month) : 'extracting';
  }

  private async applyAutomatic(row: ImportRow, month: string) {
    const pages = row.ocrPages as { num: number; text: string }[];
    const bulletin = validateMonthlyBulletin(month, pages.filter(({ num }) => num < 7), row.sourceLastModified, row.observedAt,
      pages.filter(({ num }) => num >= 7).map(({ text }) => text));
    const proposal = row.months as { month: string; values: Record<string, number> }[];
    const input = {
      ...bulletin, months: bulletin.months.map((period) => ({
        ...period, indexValues: proposal.find((entry) => entry.month === period.month)!.values,
      })),
    };
    await this.apply(row.id, input, SYSTEM_ACTOR, true);
    this.logger.log(`${month} · ${bulletin.reference} synchronisé`);
    return 'applied';
  }

  async apply(id: string, input: ApplyIndexImport, actor: Actor, automatic = false) {
    const request = normalizeApply(applyIndexImportSchema.parse(input));
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    return this.database().transaction(async (tx) => {
      const [row] = await tx.select().from(revisionIndexImports).where(eq(revisionIndexImports.id, id)).for('update');
      if (!row) throw new NotFoundException('Import introuvable.');
      if (automatic !== (row.createdBy === SYSTEM_ACTOR.sub)) {
        throw new ConflictException('Ce bulletin est traité dans un autre mode d’import.');
      }
      if (row.status === 'applied') {
        if (row.appliedDigest !== digest) throw new ConflictException('Cet import est déjà enregistré avec un autre contenu. Conserver ce résultat et ouvrir une nouvelle révision.');
        return row.appliedResult;
      }
      if (row.status !== 'review') throw new ConflictException('Attendre la lecture du bulletin avant de revoir les valeurs.');
      const observedDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Casablanca' }).format(row.observedAt);
      if (request.publishedOn > observedDay) throw new BadRequestException('La publication confirmée ne peut pas être postérieure à l’observation du bulletin.');
      const registers = new DrizzleBtpRegistresRepository(this.database());
      const rows = await registers.upsertIndexMonthsTx(tx, request.months.map(({ month, status, indexValues }) => ({
        monthDate: new Date(`${month}-01T00:00:00Z`), indexValues, status, source: request.reference,
        publishedOn: request.publishedOn, notes: `Import ${id} · ${row.sourceUrl} · SHA256 ${row.sha256} · ${request.publicationEvidence}`.slice(0, 1_000),
      })), actor, automatic);
      const now = this.now();
      const result = { id, status: 'applied' as const, appliedAt: now.toISOString(), months: rows.map(({ monthDate }) => monthDate.toISOString().slice(0, 7)) };
      await tx.update(revisionIndexImports).set({
        status: 'applied', appliedDigest: digest, appliedRequest: request, appliedResult: result,
        reference: request.reference, appliedAt: now, updatedAt: now,
      }).where(eq(revisionIndexImports.id, id));
      return result;
    });
  }
}
