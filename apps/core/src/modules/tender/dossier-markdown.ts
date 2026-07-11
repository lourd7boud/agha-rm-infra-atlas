/**
 * Turns the extracted DCE text (produced by extractDossierText, whose per-file
 * blocks are delimited by "===== filename =====" and whose XLSX/bordereau rows
 * are already pipe-separated "cell | cell | cell") into clean Markdown that the
 * chat agent reads best: each document becomes a "## filename" section, and a
 * run of pipe-rows becomes a GFM table (header separator inserted) so the
 * bordereau des prix renders as a real price table.
 *
 * This is deliberately a light, dependency-free transform of text ATLAS already
 * extracts (via pdf-parse + OOXML parsers + the poppler→Gemini-vision OCR path
 * for scans) — NOT a heavyweight re-conversion. It preserves the tuned document
 * priority/budget of extractDossierText while giving the LLM Markdown structure.
 */

/** Full-document Markdown budget persisted per tender (chat re-bounds it). */
export const DOSSIER_MARKDOWN_CHARS = 48_000;

const FILE_HEADER = /^=====\s*(.+?)\s*=====$/;
/** A "table-ish" line: at least two " | "-separated non-empty cells. */
const PIPE_ROW = /^\s*[^|]+\s\|\s.+$/;

function cellsOf(line: string): string[] {
  return line
    .trim()
    .split('|')
    .map((c) => c.trim());
}

/** Emits a GFM table for a block of pipe-rows, padding/truncating each row to
 *  the widest column count so the table stays well-formed. */
function pipeBlockToGfm(rows: readonly string[]): string {
  const grid = rows.map(cellsOf);
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (cols < 2) return rows.join('\n');
  const pad = (r: string[]): string =>
    `| ${Array.from({ length: cols }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
  const header = pad(grid[0]!);
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = grid.slice(1).map(pad);
  return [header, sep, ...body].join('\n');
}

export function toDossierMarkdown(dossierText: string): string {
  if (!dossierText.trim()) return '';
  const lines = dossierText.split('\n');
  const out: string[] = [];
  let pipeRun: string[] = [];

  const flush = (): void => {
    if (pipeRun.length === 0) return;
    // A single stray pipe-row isn't a table; keep it verbatim.
    out.push(pipeRun.length >= 2 ? pipeBlockToGfm(pipeRun) : pipeRun.join('\n'));
    pipeRun = [];
  };

  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      out.push(`\n## ${header[1]}`);
      continue;
    }
    if (PIPE_ROW.test(line)) {
      pipeRun.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
