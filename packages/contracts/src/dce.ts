export type DceFileKind =
  | 'pdf'
  | 'excel'
  | 'word'
  | 'presentation'
  | 'image'
  | 'text'
  | 'other';

const EXCEL = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv']);
const WORD = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'rtf']);
const PRESENTATION = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
const TEXT = new Set(['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'log']);
const PREVIEW = new Set([...EXCEL, ...WORD, ...PRESENTATION, 'tif', 'tiff']);
const RAW_INLINE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'txt', 'md', 'log']);

function extension(filename: string): string {
  const clean = filename.split(/[?#]/, 1)[0] ?? filename;
  const leaf = clean.replace(/\\/g, '/').split('/').pop() ?? clean;
  const dot = leaf.lastIndexOf('.');
  return dot < 0 ? '' : leaf.slice(dot + 1).toLowerCase();
}

export function classifyDceFile(filename: string): DceFileKind {
  const ext = extension(filename);
  if (ext === 'pdf') return 'pdf';
  if (EXCEL.has(ext)) return 'excel';
  if (WORD.has(ext)) return 'word';
  if (PRESENTATION.has(ext)) return 'presentation';
  if (IMAGE.has(ext)) return 'image';
  if (TEXT.has(ext)) return 'text';
  return 'other';
}

export function isDcePreviewExtension(value: string): boolean {
  return PREVIEW.has(value.replace(/^\./, '').toLowerCase());
}

export function isDceRawInlineSafe(filename: string): boolean {
  return RAW_INLINE.has(extension(filename));
}

export function mimeForDceFile(filename: string): string {
  const ext = extension(filename);
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
  };
  return known[ext] ?? 'application/octet-stream';
}
