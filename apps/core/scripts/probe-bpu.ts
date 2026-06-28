/* Diagnose where a tender's BPU really lives vs what the vision path sends.
 * For each PDF in the DCE: page count (pdfinfo), text-layer size (pdftotext →
 * digital vs scanned), and which pages mention the bordereau. Then show what
 * buildVisionInput actually renders, exposing pages the LLM never saw. */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import {
  downloadDce,
  dceIdentityFromEnv,
  parsePortalRef,
} from '../src/modules/watch/dossier.crawler';
import { buildVisionInput, VISION_MAX_PAGES, VISION_PER_DOC_PAGES } from '../src/modules/tender/dossier-vision';
import { pdfParseExtract } from '../src/modules/tender/pdf-ocr';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';

const exec = promisify(execFile);
const KW = /(bordereau|d[ée]tail estimatif|d[ée]signation|prix unitaire|quantit[ée]|distillation|s[ée]chage)/i;

async function pdfInfo(file: string): Promise<number> {
  try {
    const { stdout } = await exec('pdfinfo', [file], { timeout: 20_000 });
    return Number(/Pages:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
  } catch {
    return 0;
  }
}
async function pageText(file: string, page: number): Promise<string> {
  try {
    const { stdout } = await exec('pdftotext', ['-layout', '-f', String(page), '-l', String(page), file, '-'], {
      timeout: 20_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const id = process.argv[2];
  const dbUrl = process.env.DATABASE_URL;
  if (!id || !dbUrl) {
    console.error('usage: DATABASE_URL=… probe-bpu.ts <tenderId>');
    process.exit(2);
  }
  const repo = new DrizzleTenderRepository(getDb(dbUrl));
  const tender = (await repo.findAll()).find((t) => t.id === id);
  if (!tender) {
    console.error('tender not found');
    process.exit(1);
  }
  const ref = parsePortalRef(tender.sourceUrl);
  if (!ref) {
    console.error('no portal ref');
    process.exit(1);
  }
  const dossier = await downloadDce(ref, dceIdentityFromEnv());
  const entries = unzipSync(dossier.bytes);
  const dir = await mkdtemp(join(tmpdir(), 'bpu-'));
  try {
    for (const [name, bytes] of Object.entries(entries)) {
      if (!/\.pdf$/i.test(name) || bytes.length === 0) continue;
      const file = join(dir, 'd.pdf');
      await writeFile(file, bytes);
      const pages = await pdfInfo(file);
      let totalChars = 0;
      const bpuPages: number[] = [];
      for (let p = 1; p <= pages; p += 1) {
        const t = await pageText(file, p);
        totalChars += t.replace(/\s+/g, '').length;
        if (KW.test(t)) bpuPages.push(p);
      }
      const kind = totalChars < 200 * Math.max(1, pages) ? 'SCANNED(no text layer)' : 'digital';
      // What buildVisionInput sees: pdf-parse text layer (its digital/scanned gate
      // is measured.length >= 200 → treat as digital, SKIP render).
      let pp = '';
      try {
        pp = await pdfParseExtract(bytes);
      } catch {
        pp = '(pdf-parse error)';
      }
      const ppLen = pp.replace(/\s+/g, ' ').trim().length;
      console.log(
        `\n### ${name}\n  pages=${pages}  pdftotextChars=${totalChars}  → ${kind}` +
          `\n  pdfParseExtract chars=${ppLen} → buildVisionInput treats as ${ppLen >= 200 ? 'DIGITAL (text kept, NOT rendered!)' : 'scanned (rendered)'}` +
          `\n  bordereau-keyword pages: ${bpuPages.length ? bpuPages.join(',') : 'NONE (text layer)'}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  const vis = await buildVisionInput(dossier.bytes);
  console.log(
    `\n=== VISION INPUT (caps: ${VISION_MAX_PAGES} total / ${VISION_PER_DOC_PAGES} per doc) ===\n  images sent: ${vis.images.length}\n  files rendered/read: ${vis.sourceFiles.join(' | ')}`,
  );
}

main().catch((e: unknown) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
