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
