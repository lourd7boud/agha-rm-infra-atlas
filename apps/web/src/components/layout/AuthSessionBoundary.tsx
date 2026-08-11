'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArmiMark } from '@/components/brand/ArmiMark';
import { shouldReleaseBlockingSessionCheck } from '@/lib/session-check';

interface SessionStatus {
  authenticated?: boolean;
}

export function AuthSessionBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const latestBlockingRequestIdRef = useRef(0);
  const [blockingCheck, setBlockingCheck] = useState(false);
  const [expired, setExpired] = useState(false);

  const verifySession = useCallback(
    async (blockContent = false) => {
      if (expired) return;
      const requestId = blockContent ? ++latestBlockingRequestIdRef.current : 0;
      if (blockContent) setBlockingCheck(true);
      let usable = false;

      try {
        const response = await fetch('/api/auth/status', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const status = response.ok
          ? ((await response.json()) as SessionStatus)
          : { authenticated: false };

        usable = status.authenticated === true;
        if (!usable) {
          setExpired(true);
          router.replace('/login');
          router.refresh();
        }
      } catch {
        if (blockContent) {
          // BFCache/focus restoration fails closed: a network error must never
          // reveal a cached authenticated shell whose session cannot be proven.
          setExpired(true);
          router.replace('/login');
          router.refresh();
        }
      } finally {
        if (
          shouldReleaseBlockingSessionCheck({
            blocking: blockContent,
            requestId,
            latestBlockingRequestId: latestBlockingRequestIdRef.current,
            usable,
          })
        ) {
          setBlockingCheck(false);
        }
      }
    },
    [expired, router],
  );

  useEffect(() => {
    const interval = window.setInterval(() => void verifySession(), 60_000);
    const onFocus = () => void verifySession(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void verifySession(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void verifySession(true);
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [verifySession]);

  if (blockingCheck || expired) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-paper text-muted"
      >
        <div className="flex items-center gap-3 rounded-xl border border-line bg-paper-2 px-5 py-4 shadow-card">
          <ArmiMark size={32} className="animate-pulse" />
          <span className="text-sm">Vérification de la session…</span>
        </div>
      </div>
    );
  }

  return children;
}
