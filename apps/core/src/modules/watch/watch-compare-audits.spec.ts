import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function compare(catalogue: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-watch-compare-'));
  try {
    const run = join(dir, 'run.json');
    const baseline = join(dir, 'baseline.json');
    const inventory = join(dir, 'inventory.json');
    writeFileSync(run, JSON.stringify({
      id: '1', audit: { version: 1, scopeHash: 'same', pages: [
        { page: 1, sourceRows: ['123/org'], parsed: ['123/org'], declared: 1 },
      ] },
    }));
    writeFileSync(baseline, JSON.stringify({
      scopeHash: 'same', complete: true, identities: ['123/org', '124/org'],
    }));
    writeFileSync(inventory, JSON.stringify(catalogue));
    return JSON.parse(execFileSync(process.execPath, [
      resolve('scripts/compare-watch-audits.mjs'), run, baseline, inventory,
    ], { encoding: 'utf8' }));
  } finally {
    rmSync(join(dir, 'run.json'), { force: true });
    rmSync(join(dir, 'baseline.json'), { force: true });
    rmSync(join(dir, 'inventory.json'), { force: true });
    rmdirSync(dir);
  }
}

describe('watch audit catalogue scope', () => {
  it('reports missing baseline-only identities against a full catalogue snapshot', () => {
    const result = compare({ coverage: 'full', identities: ['123/org'] });
    expect(result.comparison.onlyInBaseline).toEqual(['124/org']);
    expect(result.catalogue).toMatchObject({
      coverage: 'full', observedButMissing: [], baselineButMissing: ['124/org'], unionButMissing: ['124/org'],
    });
  });

  it('keeps coverage unknown with a legacy list potentially filtered to the run', () => {
    const result = compare(['123/org']);
    expect(result.catalogue).toMatchObject({
      coverage: 'unspecified', observedButMissing: [], baselineButMissing: null, unionButMissing: null,
    });
  });
});
