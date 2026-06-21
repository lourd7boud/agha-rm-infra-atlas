import { redirect } from 'next/navigation';
import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

const SIGNIN = '/login';

/**
 * Production Next.js redacts server-error messages before they reach the
 * client error boundary, but forwards a pre-set `digest` as-is. Carrying
 * the upstream HTTP status in the digest lets error.tsx say WHY it failed
 * (409 transition vs 503 IA indisponible) instead of a generic message.
 */
export class AtlasApiError extends Error {
  readonly digest: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`ATLAS API ${path} a répondu HTTP ${status}`);
    this.status = status;
    this.digest = `ATLAS_API_${status}`;
  }
}

/** Server-side fetch against ATLAS Core with the session's bearer token. */
export async function apiGet<T>(path: string): Promise<T> {
  const session = await auth();
  // Missing/expired-and-unrefreshable session: send to sign-in, don't 500.
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    redirect(SIGNIN);
  }
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect(SIGNIN);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return (await response.json()) as T;
}

/** Server-side POST against ATLAS Core (gate actions, agent triggers). */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    redirect(SIGNIN);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect(SIGNIN);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return (await response.json()) as T;
}

/** Server-side PATCH against ATLAS Core (partial updates, e.g. task progress). */
export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const session = await auth();
  if (!session?.accessToken || session.error === 'RefreshAccessTokenError') {
    redirect(SIGNIN);
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect(SIGNIN);
  }
  if (!response.ok) {
    throw new AtlasApiError(path, response.status);
  }
  return (await response.json()) as T;
}
