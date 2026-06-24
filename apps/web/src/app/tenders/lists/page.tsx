import { apiGet } from '@/lib/api';
import { ListsManager } from './ListsManager';

export interface TenderListRow {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  ownerSub: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Listes — datao's top-nav "Listes" tab. Server-fetches the user's visible
 * lists (own + others' shared) and hands them to a client manager that does
 * delete + open (navigates to /tenders?list=<id>).
 */
export default async function TenderListsPage() {
  const lists = await apiGet<TenderListRow[]>('/tender/lists');
  return <ListsManager initial={lists} />;
}
