import { randomBytes } from 'node:crypto';

/**
 * Short-lived in-memory cache of DCE file bytes, keyed by an opaque random
 * token, so the Microsoft Office Online viewer (view.officeapps.live.com) can
 * fetch the document from a PUBLIC, unauthenticated URL — Microsoft's servers
 * render it, so they can't send our session cookie. The token is single-purpose
 * and expires fast; the file itself is a public tender document. Process-local
 * (the web app runs as one container); entries self-evict on TTL.
 */

interface Entry {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 min — covers the viewer's fetch window
const MAX_ENTRIES = 64; // bound memory (each ≤ a few MB)

const store = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [token, e] of store) {
    if (e.expiresAt <= now) store.delete(token);
  }
}

export function putOfficeFile(bytes: Uint8Array, mime: string, filename: string): string {
  const now = Date.now();
  sweep(now);
  // Evict oldest if over the bound.
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) store.delete(oldest[0]);
  }
  const token = randomBytes(24).toString('hex');
  store.set(token, { bytes, mime, filename, expiresAt: now + TTL_MS });
  return token;
}

export function getOfficeFile(token: string): Entry | null {
  const e = store.get(token);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    store.delete(token);
    return null;
  }
  return e;
}
