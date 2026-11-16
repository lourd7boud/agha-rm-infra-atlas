import { readFileSync } from 'node:fs';

function inspectRun(run) {
  if (run.audit?.version !== 1 || !Array.isArray(run.audit.pages)) {
    throw new Error('Expected the JSON returned by GET /api/watch/runs/:id/audit');
  }
  const source = new Set();
  const parsed = new Set();
  const repeated = new Map();
  const unparsed = [];
  const unavailablePages = [];
  let unidentified = 0;
  for (const page of run.audit.pages) {
    const onPage = new Set(page.parsed);
    if (page.sourceRows === null) unavailablePages.push(page.page);
    for (const id of page.sourceRows ?? []) {
      if (id === null) { unidentified += 1; continue; }
      if (source.has(id)) repeated.set(id, (repeated.get(id) ?? 1) + 1);
      source.add(id);
      if (!onPage.has(id)) unparsed.push({ page: page.page, id });
    }
    for (const id of onPage) parsed.add(id);
  }
  return { source, parsed, repeated: Object.fromEntries(repeated), unparsed, unidentified, unavailablePages };
}

const difference = (left, right) => [...left].filter((id) => !right.has(id)).sort();

try {
  const [runFile, baselineFile, catalogueFile] = process.argv.slice(2);
  if (!runFile) throw new Error('Usage: node compare-watch-audits.mjs run.json [independent-source.json|-] [catalogue-ids.json]');
  const run = JSON.parse(readFileSync(runFile, 'utf8'));
  const report = inspectRun(run);
  const declaredValues = [...new Set(run.audit.pages.flatMap((page) => page.declared === null ? [] : [page.declared]))];
  let comparison;
  let baselineIdentities;
  if (baselineFile && baselineFile !== '-') {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    if (baseline.scopeHash !== run.audit.scopeHash || !Array.isArray(baseline.identities) ||
        !baseline.identities.every((id) => typeof id === 'string' && /^\d{1,20}\/[a-z\d_]{1,40}$/i.test(id))) {
      throw new Error('Baseline must contain validated identities for the same scopeHash');
    }
    const reference = new Set(baseline.identities);
    baselineIdentities = reference;
    comparison = {
      observedFrom: baseline.observedFrom ?? null,
      observedAt: baseline.observedAt ?? null,
      baselineComplete: baseline.complete ?? null,
      baselineInterruption: baseline.interruption ?? null,
      baselineUnique: reference.size,
      onlyInBaseline: difference(reference, report.source),
      onlyInRun: difference(report.source, reference),
    };
  }
  let catalogue;
  if (catalogueFile) {
    const snapshot = JSON.parse(readFileSync(catalogueFile, 'utf8'));
    const full = snapshot?.coverage === 'full' && !Array.isArray(snapshot);
    const identities = full ? snapshot.identities : snapshot;
    if (!Array.isArray(identities) || !identities.every((id) => typeof id === 'string')) {
      throw new Error('Catalogue must be an identity array or { coverage: "full", identities: [...] }');
    }
    const persisted = new Set(identities);
    const union = full && baselineIdentities
      ? new Set([...report.source, ...report.parsed, ...baselineIdentities])
      : null;
    catalogue = {
      coverage: full ? 'full' : 'unspecified',
      observedButMissing: difference(report.source, persisted),
      parsedButMissing: difference(report.parsed, persisted),
      baselineButMissing: full && baselineIdentities ? difference(baselineIdentities, persisted) : null,
      unionButMissing: union ? difference(union, persisted) : null,
    };
  }
  console.log(JSON.stringify({
    id: run.id, startedAt: run.startedAt, finishedAt: run.finishedAt,
    status: run.summary?.status, stopReason: run.summary?.stopReason,
    declared: run.summary?.portalTotal ?? null, declaredValues, pages: run.audit.pages.length,
    truncated: run.audit.truncated, sourceUnique: report.source.size, parsedUnique: report.parsed.size,
    unidentified: report.unidentified, unavailablePages: report.unavailablePages,
    repeated: report.repeated, unparsed: report.unparsed,
    parsedWithoutCardIdentity: difference(report.parsed, report.source), comparison, catalogue,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
