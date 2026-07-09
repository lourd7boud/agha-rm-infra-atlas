// Module Projets BTP — server-side helpers on top of lib/api.ts: PUT + multipart
// upload (both follow apiPost's session/timeout/error contract), plus a re-export
// of the client-safe types/formatters so server files import from one place.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { API_WRITE_TIMEOUT_MS, AtlasApiError } from '@/lib/api';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';
const SIGNIN = '/login';

export * from '@/lib/btp-shared';

/** Server-side PUT against ATLAS Core (bordereau/métrés/index saves). */
export async function apiPut<T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    redirect(SIGNIN);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? API_WRITE_TIMEOUT_MS),
  });
  if (response.status === 401) {
    redirect(SIGNIN);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Server-side multipart POST (photothèque/documents uploads → MinIO). */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: { timeoutMs?: number },
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    redirect(SIGNIN);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    // No Content-Type: fetch sets the multipart boundary itself.
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: formData,
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? API_WRITE_TIMEOUT_MS),
  });
  if (response.status === 401) {
    redirect(SIGNIN);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
