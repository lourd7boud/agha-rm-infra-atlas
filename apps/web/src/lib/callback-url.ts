/**
 * Validates a post-login redirect target.
 *
 * Auth flows must never accept an arbitrary URL — a user-supplied callbackUrl
 * that is not path-local can be turned into an open redirect. This accepts only
 * same-origin absolute paths (a single leading "/"), never a full URL, never a
 * protocol-relative "//host" value, and never the login screen itself (which
 * would loop). Anything suspicious falls back to "/".
 */

const DEFAULT_CALLBACK_URL = '/';

export function safeCallbackUrl(
  value: unknown,
  fallback: string = DEFAULT_CALLBACK_URL,
): string {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return fallback;

  // Absolute paths only: must start with a single "/".
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;

  // Never keep the user on (or under) the login screen after a sign-in.
  const path = trimmed.split(/[?#]/, 1)[0];
  if (path === '/login' || path.startsWith('/login/')) return fallback;

  // Reject backslashes (smuggled separators on some proxies) and control
  // characters that could be injected into headers or HTML.
  if (trimmed.includes('\\') || /[\u0000-\u001f\u007f]/.test(trimmed)) return fallback;

  return trimmed;
}