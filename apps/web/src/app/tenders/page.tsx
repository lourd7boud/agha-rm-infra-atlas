import { apiGet } from '@/lib/api';
import type { TenderInventory } from '@/lib/tenders';
import { TendersExplorer } from './TendersExplorer';

/**
 * Marchés Publics — datao-style catalogue. The whole active inventory is
 * fetched server-side (auth happens here) and handed to a client explorer that
 * does instant search / multi-facet filtering / sorting / resizable columns and
 * a click-to-open detail drawer. The deeper AI tabs (Résumé/FAQ/Lots/BPU) are
 * wired to structured data now and to the dossier-extraction pipeline later.
 */
export default async function TendersPage() {
  const inventory = await apiGet<TenderInventory>('/tender/inventory?limit=1000');
  return <TendersExplorer inventory={inventory} />;
}
