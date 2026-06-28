/* One-off probe: for a tender id, download its DCE (same path as the service —
 * parsePortalRef(sourceUrl) → downloadDce) and show what the text extractor pulls
 * from each file, plus the raw LLM extraction output. Diagnoses empty-BPU runs. */
import { unzipSync } from 'fflate';
import {
  downloadDce,
  dceIdentityFromEnv,
  parsePortalRef,
} from '../src/modules/watch/dossier.crawler';
import { extractDossierText } from '../src/modules/tender/dossier-text';
import { pdfParseExtract } from '../src/modules/tender/pdf-ocr';
import { getDb } from '../src/db/client';
import { DrizzleTenderRepository } from '../src/modules/tender/tender.repository';

async function main(): Promise<void> {
  const id = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!id || !databaseUrl) {
    console.error('usage: DATABASE_URL=… probe-xlsx.ts <tenderId>');
    process.exit(2);
  }
  const repo = new DrizzleTenderRepository(getDb(databaseUrl));
  const all = await repo.findAll();
  const tender = all.find((t) => t.id === id);
  if (!tender) {
    console.error('tender not found');
    process.exit(1);
  }
  console.log(`ref=${tender.reference}  sourceUrl=${tender.sourceUrl ?? '(none)'}`);
  const ref = parsePortalRef(tender.sourceUrl);
  if (!ref) {
    console.error('no portal ref from sourceUrl');
    process.exit(1);
  }
  const dossier = await downloadDce(ref, dceIdentityFromEnv());
  console.log(`DCE bytes: ${dossier.bytes.length}`);
  const entries = unzipSync(dossier.bytes);
  console.log('--- zip entries ---');
  for (const [name, bytes] of Object.entries(entries)) {
    console.log(`  ${name}  (${bytes.length} bytes)`);
  }
  const { text, files } = await extractDossierText(dossier.bytes, pdfParseExtract);
  console.log(`--- extracted files (name → chars) | total text ${text.length} ---`);
  for (const f of files) console.log(`  ${f.name} → ${f.chars}`);
  const xlsx = files.find((f) => /\.xlsx$/i.test(f.name));
  if (xlsx) {
    const idx = text.indexOf(`===== ${xlsx.name} =====`);
    console.log('--- xlsx-derived text (first 800 chars) ---');
    console.log(text.slice(idx, idx + 800));
  }

  // Replay the EXACT extraction LLM call and print the raw output.
  const { createLlmClientFromEnv } = await import('../src/modules/brain/llm.client');
  const { DOSSIER_EXTRACTION_SYSTEM_PROMPT, buildDossierExtractionPrompt, DOSSIER_RESPONSE_SCHEMA } =
    await import('../src/modules/tender/dossier-extraction');
  const llm = createLlmClientFromEnv();
  if (!llm) {
    console.log('(no LLM configured)');
    return;
  }
  const completion = await llm.complete({
    tier: 'T1',
    system: DOSSIER_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildDossierExtractionPrompt(text, { reference: tender.reference, objet: tender.objet }),
    prefill: '{',
    maxTokens: 8000,
    responseSchema: DOSSIER_RESPONSE_SCHEMA,
  });
  console.log(`--- RAW LLM completion (model=${completion.model}, len=${completion.text.length}) ---`);
  console.log('HEAD:', completion.text.slice(0, 700));
  console.log('TAIL:', completion.text.slice(-500));
}

main().catch((e: unknown) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
