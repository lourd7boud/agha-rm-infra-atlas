import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { zipSync } from 'fflate';

const execFileAsync = promisify(execFile);
const logger = new Logger('DossierArchive');

/**
 * The DCE arrives as an ARCHIVE. Historically ATLAS only handled ZIP (fflate),
 * so RAR dossiers — common for older buyers — failed silently at every stage
 * (text, bordereau, vision). This module normalizes ANY supported archive to a
 * ZIP up front, so every downstream ZIP-only reader keeps working unchanged.
 */
export type ArchiveKind = 'zip' | 'rar' | 'unknown';

/** Timeout for the external RAR extractor — a pathological archive must not hang
 *  a whole extraction batch. */
const RAR_EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;
/** Skip any single unpacked member above this (memory guard, mirrors MAX_PDF_BYTES). */
const MAX_MEMBER_BYTES = 60 * 1024 * 1024;

/** Magic-byte sniff. ZIP: "PK\x03\x04" (also \x05\x06 empty / \x07\x08 spanned).
 *  RAR: "Rar!\x1a\x07\x00" (v4) or "Rar!\x1a\x07\x01\x00" (v5). */
export function detectArchive(bytes: Uint8Array): ArchiveKind {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  ) {
    return 'zip';
  }
  if (
    bytes.length >= 7 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21 &&
    bytes[4] === 0x1a &&
    bytes[5] === 0x07
  ) {
    return 'rar';
  }
  return 'unknown';
}

/** Recursively collects every file under `dir` as {relative POSIX path: bytes},
 *  skipping oversized members. Directories are implicit in the ZIP paths. */
async function collectFiles(
  dir: string,
  base = '',
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(out, await collectFiles(abs, rel));
    } else if (entry.isFile()) {
      const buf = await readFile(abs);
      if (buf.length > 0 && buf.length <= MAX_MEMBER_BYTES) {
        out[rel] = new Uint8Array(buf);
      }
    }
  }
  return out;
}

/**
 * Extracts a RAR archive to a temp dir with the `unar` CLI, then re-zips its
 * files in memory. RAR — unlike ZIP's central directory — is not streamable, so
 * this is the one place we touch disk; the temp dir is always swept. Throws when
 * `unar` is missing or the archive is unreadable, so the caller can fall back.
 */
export async function unpackRarToZip(bytes: Uint8Array): Promise<Uint8Array> {
  const stamp = `${process.pid}-${(globalThis as { __arcSeq?: number }).__arcSeq ?? 0}`;
  (globalThis as { __arcSeq?: number }).__arcSeq =
    ((globalThis as { __arcSeq?: number }).__arcSeq ?? 0) + 1;
  const dir = await mkdtemp(join(tmpdir(), `atlas-rar-${stamp}-`));
  const inPath = join(dir, 'in.rar');
  const outDir = join(dir, 'out');
  try {
    await writeFile(inPath, bytes);
    // -quiet: no chatter; -force-overwrite: deterministic; -output-directory: our
    // swept temp. `unar` handles RAR4 + RAR5 + solid/split legacy variants.
    await execFileAsync(
      'unar',
      ['-quiet', '-force-overwrite', '-output-directory', outDir, inPath],
      { timeout: RAR_EXTRACT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    const files = await collectFiles(outDir);
    if (Object.keys(files).length === 0) {
      throw new Error('RAR unpacked to zero files');
    }
    // zipSync with no compression (level 0) — the members are already compressed
    // originals (PDF/DOCX/XLSX) and we only need a ZIP CONTAINER for downstream
    // fflate readers; recompressing would waste CPU for no size gain.
    return zipSync(files, { level: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Normalizes any supported archive to ZIP bytes. ZIP passes through untouched;
 * RAR is unpacked + re-zipped; anything else passes through so the existing
 * unzip attempt (and its error handling) stays the source of truth. A RAR that
 * fails to unpack degrades to the raw bytes (downstream will read nothing rather
 * than crash the batch), with a warning so a missing `unar` binary is visible.
 */
export async function normalizeArchiveToZip(bytes: Uint8Array): Promise<Uint8Array> {
  if (detectArchive(bytes) !== 'rar') return bytes;
  try {
    return await unpackRarToZip(bytes);
  } catch (err) {
    logger.warn(`RAR normalization failed (unar missing/unreadable): ${(err as Error).message}`);
    return bytes;
  }
}
