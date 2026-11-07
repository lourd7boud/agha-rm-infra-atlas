import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 90_000;
const SUPPORTED = new Set([
  'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'ods', 'csv',
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'rtf',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'potx', 'odp',
  'tif', 'tiff',
]);

export class UnsupportedPreviewError extends Error {}
export class PreviewTooLargeError extends Error {}
export class PreviewConversionError extends Error {}

export function previewExtension(filename) {
  const extension = extname(filename).slice(1).toLowerCase();
  return SUPPORTED.has(extension) ? extension : null;
}

function killProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function runLibreOffice({ inputPath, outputDir, profileDir, root }, signal) {
  if (signal?.aborted) {
    return Promise.reject(new PreviewConversionError('conversion cancelled'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      'libreoffice',
      [
        '--headless', '--invisible', '--nologo', '--nodefault', '--norestore',
        '--nofirststartwizard', '--safe-mode',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to', 'pdf', '--outdir', outputDir, inputPath,
      ],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          HOME: profileDir,
          TMPDIR: root,
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
        },
      },
    );
    let stderr = '';
    const onAbort = () => {
      killProcessGroup(child);
      reject(new PreviewConversionError('conversion cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    const timer = setTimeout(() => {
      killProcessGroup(child);
      reject(new PreviewConversionError('conversion timeout'));
    }, CONVERSION_TIMEOUT_MS);
    timer.unref();
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new PreviewConversionError(`converter unavailable: ${error.message}`));
    });
    child.once('exit', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new PreviewConversionError(`converter exit ${code ?? exitSignal}: ${stderr}`));
    });
  });
}

export async function convertOfficeToPdf(
  bytes,
  filename,
  runner = runLibreOffice,
  signal,
) {
  const extension = previewExtension(filename);
  if (!extension) throw new UnsupportedPreviewError('unsupported format');
  if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
    throw new PreviewTooLargeError('invalid input size');
  }

  const root = await mkdtemp(join(tmpdir(), 'atlas-preview-'));
  const outputDir = join(root, 'output');
  const profileDir = join(root, 'profile');
  const inputPath = join(root, `document.${extension}`);
  try {
    await Promise.all([mkdir(outputDir), mkdir(profileDir), writeFile(inputPath, bytes)]);
    await runner({ inputPath, outputDir, profileDir, root }, signal);
    const outputName = (await readdir(outputDir)).find((name) => /\.pdf$/i.test(name));
    if (!outputName) throw new PreviewConversionError('converter produced no PDF');
    const outputPath = join(outputDir, outputName);
    const info = await stat(outputPath);
    if (info.size <= 4 || info.size > MAX_OUTPUT_BYTES) {
      throw new PreviewTooLargeError('invalid output size');
    }
    const pdf = await readFile(outputPath);
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new PreviewConversionError('invalid PDF output');
    }
    return pdf;
  } catch (error) {
    if (
      error instanceof UnsupportedPreviewError ||
      error instanceof PreviewTooLargeError ||
      error instanceof PreviewConversionError
    ) throw error;
    throw new PreviewConversionError('conversion failed', { cause: error });
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
