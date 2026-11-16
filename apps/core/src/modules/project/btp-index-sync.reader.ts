import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const exec = promisify(execFile);
const reader = join(__dirname, 'btp-ministry-table.py');
const layout = z.object({
  covers: z.array(z.object({ num: z.number(), text: z.string() })).length(2),
  globalHeadings: z.array(z.string()).length(2).optional(),
  rows: z.array(z.object({
    page: z.number().int().min(1).max(8),
    code: z.string().regex(/^[A-Za-z][A-Za-z0-9/]*$/),
    values: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  })).length(185).refine((rows) => new Set(rows.map(({ code }) => code)).size === rows.length),
});

export class BulletinLayoutError extends Error {}
export type OfficialIndexTable = z.infer<typeof layout>;

export async function readOfficialIndexTable(bytes: Buffer): Promise<OfficialIndexTable> {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-ministry-index-'));
  try {
    const source = join(folder, 'bulletin.pdf');
    await writeFile(source, bytes);
    const { stdout } = await exec('python3', [reader, source], { timeout: 240_000, maxBuffer: 256 * 1024 });
    const response: unknown = JSON.parse(stdout);
    const table = layout.safeParse(response);
    if (table.success) return table.data;
    const failure = z.object({ failure: z.string() }).safeParse(response);
    throw new BulletinLayoutError(failure.success ? failure.data.failure.slice(0, 350) : 'Matrice des index incomplète.');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
