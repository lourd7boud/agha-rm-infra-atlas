import { chmod, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import {
  convertOfficeToPdf,
  MAX_INPUT_BYTES,
  previewExtension,
  PreviewConversionError,
  PreviewTooLargeError,
  UnsupportedPreviewError,
} from './converter.mjs';

const SOCKET_PATH = process.env.PREVIEW_WORKER_SOCKET ?? '/run/atlas-preview/worker.sock';
const MAX_ACTIVE = 2;
const MAX_WAITING = 4;

class ConversionGate {
  active = 0;
  waiters = [];

  acquire() {
    if (this.active < MAX_ACTIVE) {
      this.active += 1;
      return Promise.resolve(true);
    }
    if (this.waiters.length >= MAX_WAITING) return Promise.resolve(false);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next(true);
    else this.active -= 1;
  }
}

function json(response, status, code) {
  const body = Buffer.from(JSON.stringify({ error: code }));
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readBoundedBody(request) {
  const declared = Number(request.headers['content-length'] ?? 'NaN');
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_INPUT_BYTES) {
    throw new PreviewTooLargeError('invalid content length');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new PreviewTooLargeError('input too large');
    chunks.push(Buffer.from(chunk));
  }
  if (total !== declared) throw new PreviewConversionError('truncated input');
  return Buffer.concat(chunks, total);
}

const gate = new ConversionGate();
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://preview.local');
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ok');
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/convert') {
    json(response, 404, 'not_found');
    return;
  }
  const filename = url.searchParams.get('filename') ?? '';
  if (!previewExtension(filename)) {
    json(response, 415, 'unsupported_format');
    return;
  }
  if (!(await gate.acquire())) {
    json(response, 503, 'converter_saturated');
    return;
  }
  try {
    const bytes = await readBoundedBody(request);
    const abort = new AbortController();
    const onClosed = () => {
      if (!response.writableEnded) abort.abort();
    };
    response.once('close', onClosed);
    let pdf;
    try {
      pdf = await convertOfficeToPdf(bytes, filename, undefined, abort.signal);
    } finally {
      response.off('close', onClosed);
    }
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    });
    response.end(pdf);
  } catch (error) {
    if (error instanceof UnsupportedPreviewError) json(response, 415, 'unsupported_format');
    else if (error instanceof PreviewTooLargeError) json(response, 413, 'size_limit');
    else json(response, 422, 'conversion_failed');
  } finally {
    gate.release();
  }
});

await mkdir(dirname(SOCKET_PATH), { recursive: true });
await rm(SOCKET_PATH, { force: true });
server.listen(SOCKET_PATH, async () => {
  await chmod(SOCKET_PATH, 0o660);
  process.stdout.write(`ATLAS preview worker listening on ${SOCKET_PATH}\n`);
});

async function shutdown() {
  server.close(async () => {
    await rm(SOCKET_PATH, { force: true });
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
