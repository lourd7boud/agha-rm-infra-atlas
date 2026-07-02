// next/navigation's redirect() throws a control-flow signal (NEXT_REDIRECT) that
// must NOT be swallowed by an action's catch — re-throw it untouched.
export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
