import { auth } from '@/auth';

const API_URL = process.env.ATLAS_API_URL ?? 'http://localhost:3000/api';

/** Server-side fetch against ATLAS Core with the session's bearer token. */
export async function apiGet<T>(path: string): Promise<T> {
  const session = await auth();
  const response = await fetch(`${API_URL}${path}`, {
    headers: session?.accessToken
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {},
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`ATLAS API ${path} a répondu HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Server-side POST against ATLAS Core (gate actions, agent triggers). */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const session = await auth();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`ATLAS API ${path} a répondu HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
