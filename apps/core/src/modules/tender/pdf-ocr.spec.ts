import { describe, expect, it, vi } from 'vitest';

// Captured outside the vi.mock factory so we can inspect calls from tests.
// vi.mock is hoisted; this binding is set on import, before pdf-ocr loads.
// Loose signature: util.promisify only inspects arity, so we just need a
// 4th-arg callback that receives (err, stdout, stderr).
const execFileSpy = vi.fn((...args: unknown[]) => {
  const cb = args[args.length - 1] as (
    err: NodeJS.ErrnoException | null,
    stdout: string,
    stderr: string,
  ) => void;
  cb(null, '', '');
});

vi.mock('node:child_process', () => ({
  execFile: (...a: unknown[]) => execFileSpy(...a),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}fake`),
  // ocrmypdf "output" the readFile receives — not parsed, just handed to pdf-parse.
  readFile: vi.fn(async () => Buffer.from('%PDF-ocred')),
  rm: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

// pdf-parse mocked so the fake OCR output doesn't have to be a real PDF.
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText(): Promise<{ text: string }> {
      return { text: 'OCRED TEXT' };
    }
    async destroy(): Promise<void> {}
  },
}));

import { ocrBytesToText, type PdfTextExtractor } from './pdf-ocr';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const TIFF_LE_MAGIC = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]);
const GARBAGE = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

describe('ocrBytesToText', () => {
  it('routes %PDF bytes through the injected PdfTextExtractor (no ocrmypdf shell)', async () => {
    execFileSpy.mockClear();
    const fake: PdfTextExtractor = vi.fn(async () => 'PDF TEXT LAYER');
    const text = await ocrBytesToText(PDF_MAGIC, fake);
    expect(text).toBe('PDF TEXT LAYER');
    expect(fake).toHaveBeenCalledTimes(1);
    // Crucially: the image-bytes shell-out path must NOT be taken for a PDF.
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it('routes JPEG bytes through ocrmypdf with -l fra+ara and a .jpg input file', async () => {
    execFileSpy.mockClear();
    const text = await ocrBytesToText(JPEG_MAGIC);
    expect(text).toBe('OCRED TEXT');
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    const [bin, args] = execFileSpy.mock.calls[0] as [string, readonly string[]];
    expect(bin).toBe('ocrmypdf');
    expect(args).toContain('-l');
    expect(args).toContain('fra+ara');
    // Input filename must end in .jpg so ocrmypdf picks the right decoder.
    const inputPath = args[args.length - 2];
    expect(inputPath?.endsWith('in.jpg')).toBe(true);
  });

  it('routes TIFF bytes through ocrmypdf with a .tif input file', async () => {
    execFileSpy.mockClear();
    await ocrBytesToText(TIFF_LE_MAGIC);
    const [, args] = execFileSpy.mock.calls[0] as [string, readonly string[]];
    const inputPath = args[args.length - 2];
    expect(inputPath?.endsWith('in.tif')).toBe(true);
  });

  it('throws on unknown magic bytes so the caller can skip rather than feed garbage', async () => {
    await expect(ocrBytesToText(GARBAGE)).rejects.toThrow(/unsupported format/);
  });
});
