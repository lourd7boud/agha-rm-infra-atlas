import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Legacy Office binaries are converted with tiny CLI tools (installed in the
 *  image): antiword (.doc), xls2csv (.xls), catppt (.ppt), unrtf (.rtf). This is
 *  the "never fail on any format" net for buyers who still ship pre-2007 Office
 *  files — modern OOXML (.docx/.xlsx) and OpenDocument are parsed natively in
 *  dossier-text.ts; this module only handles what those can't. */

/** Extracts text from a legacy Office binary; '' when unsupported or on any
 *  failure (a missing tool, a corrupt file) — never throws, so one bad entry
 *  cannot abort the dossier. */
export type BinaryDocExtractor = (bytes: Uint8Array, name: string) => Promise<string>;

const BINARY_EXT = /\.(doc|xls|ppt|rtf)$/i;
/** Per-conversion wall-clock cap and output ceiling (memory guard). */
const CONVERT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function toolFor(ext: string, file: string): { tool: string; args: string[] } {
  switch (ext) {
    case 'doc':
      return { tool: 'antiword', args: [file] };
    case 'xls':
      return { tool: 'xls2csv', args: [file] };
    case 'ppt':
      return { tool: 'catppt', args: [file] };
    case 'rtf':
      return { tool: 'unrtf', args: ['--text', '--nopict', file] };
    default:
      return { tool: '', args: [] };
  }
}

export const defaultBinaryExtractor: BinaryDocExtractor = async (bytes, name) => {
  const ext = BINARY_EXT.exec(name)?.[1]?.toLowerCase();
  if (!ext) return '';
  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'dce-bin-'));
    const file = join(dir, `doc.${ext}`);
    await writeFile(file, bytes);
    const { tool, args } = toolFor(ext, file);
    if (!tool) return '';
    const { stdout } = await exec(tool, args, {
      timeout: CONVERT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: 'utf8',
    });
    return stdout;
  } catch {
    // Missing tool, corrupt file, timeout — degrade to "no text", never abort.
    return '';
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/** No-op used by unit tests and any caller without the CLI tools available. */
export const noopBinaryExtractor: BinaryDocExtractor = async () => '';
