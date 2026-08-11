'use client';

import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

/**
 * Scoped React Query provider for the /tenders explorer subtree ONLY — we do
 * NOT wrap the whole app. `useState` guarantees a single QueryClient per browser
 * mount (never re-created on re-render). `keepPreviousData` semantics are set
 * per-query via `placeholderData` in the explorer so paging swaps stay flicker
 * free; the defaults here just tune caching for a live catalogue.
 */
export function TendersQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is fresh for 30 s; after that a background refetch runs while
            // the cached page stays on screen (no spinner, no flicker).
            staleTime: 30_000,
            // A stalled/failed page fetch shouldn't spin forever — one retry.
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
