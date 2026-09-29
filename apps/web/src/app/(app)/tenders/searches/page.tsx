import { apiGet } from '@/lib/api';
import { SearchesManager } from './SearchesManager';

export interface SavedSearchRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  ownerSub: string;
  filters: unknown;
  createdAt: string;
  updatedAt: string;
}

/**
 * Recherches sauvegardées — datao's "Recherches sauvegardées" surface.
 * Server-fetches the user's saved searches and hands them to a client manager
 * that does delete + open (navigates to /tenders?savedSearch=<id>).
 */
export default async function SavedSearchesPage() {
  const searches = await apiGet<SavedSearchRow[]>('/tender/saved-searches');
  return <SearchesManager initial={searches} />;
}
