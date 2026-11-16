import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

function capture(secondId: string) {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-baseline-'));
  const source = join(folder, 'listing.html');
  const output = join(folder, 'evidence.json');
  const link = (id: string) => `https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&amp;refConsultation=${id}&amp;orgAcronyme=org`;
  try {
    writeFileSync(source, `<div id="x_resultSearch_panelElementsFound">
      <span id="x_resultSearch_nombreElement">1</span><span id="x_resultSearch_nombrePageTop">1</span>
      <input id="x_resultSearch_numPageTop" value="1">
      <div class="contentColumn"><div class="tender_item">
        <a href="${link('123')}">Détails</a><a href="${link(secondId)}&amp;retraits">Dossier</a>
      </div></div></div>`);
    execFileSync(process.execPath, ['--import', 'tsx', resolve('scripts/capture-watch-baseline.ts'), output, source], {
      env: { ...process.env, WATCH_PMMP_URL: 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseAdvancedSearch' },
      stdio: 'pipe',
    });
    return JSON.parse(readFileSync(output, 'utf8'));
  } finally {
    rmSync(source, { force: true });
    rmSync(output, { force: true });
    rmdirSync(folder);
  }
}

test('two links to the same official consultation in one card are one source identity', () => {
  const result = capture('123');
  expect(result.identities).toEqual(['123/org']);
  expect(result.invalidLinks).toBe(0);
  expect(result.pageObservations[0].identities).toEqual(['123/org']);
});

test('conflicting official identities in one card do not become accepted source evidence', () => {
  expect(() => capture('124')).toThrow();
});
