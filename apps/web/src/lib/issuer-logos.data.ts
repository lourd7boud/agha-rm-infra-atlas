import RESOLVER_DATA from './datao-issuers-resolver.json';
import { NAME_TO_ASSET_PART_1 } from './issuer-logos.data-1';
import { NAME_TO_ASSET_PART_2 } from './issuer-logos.data-2';

export const CATALOG_RESOLVER = RESOLVER_DATA as Readonly<Record<string, string>>;

/**
 * Curated issuer logos — 305 unique assets pulled from datao.ma's public
 * Supabase Storage and committed under apps/web/public/issuers/datao/. The
 * NAME_TO_ASSET table below is the exhaustive set datao indexes with logos:
 * 1049 rows in datao's `issuers` table that have logo_url populated, dedup'd
 * to 933 normalized names + 37 alt_name acronyms (CNSS, ONCF, ONEE, ONDA…)
 * mapping onto 305 shared logo files. Organizational hierarchies share assets
 * — every DP Éducation hits one row, every Al Omrane regional company hits
 * one row. Acronym aliases were pulled live from datao's issuers.alt_name
 * column via Burp Suite Pro on 2026-06-29.
 *
 * Lookup keys are NORMALIZED (lower-case, accent-stripped, punctuation
 * collapsed) so French spelling variants all hit the same logo.
 *
 * Add a new logo: drop the .png into /issuers/datao/ and append a row below.
 */

/** Exact (normalized) buyer name → asset filename. */
export const NAME_TO_ASSET: Readonly<Record<string, string>> = {
  ...NAME_TO_ASSET_PART_1,
  ...NAME_TO_ASSET_PART_2,
};

interface FallbackRule {
  match: RegExp;
  file: string;
}

/** Substring-regex fallbacks for ATLAS buyer-name variants not in the exact
 *  map (acronyms, slight wording shifts). Order matters — most specific first. */
export const FALLBACK_RULES: readonly FallbackRule[] = [
  { match: /\bofppt\b/, file: '941ccdeb-a317-4924-bda6-d1b03cd0ff1f.png' },
  { match: /\boncf\b|office.*chemins.*fer/, file: '5a7270ca-5391-4030-842b-df1756f3b583.png' },
  { match: /\bonda\b|office.*aeroports/, file: 'a47ba955-bed6-47c9-b7c8-81df07ad028b.png' },
  { match: /\bnarsa\b|securite.*routiere/, file: '651c4212-0605-4761-8c82-7347bd3c5bf7.png' },
  { match: /\banapec\b/, file: '39efd1b3-5f15-4587-b67c-8d2bb1b17275.png' },
  { match: /\bonhym\b/, file: 'c8117bb3-2113-47f5-bd53-b5ef0183b0c3.png' },
  { match: /\bonee\b.*electricite|branche electricite/, file: 'de4233d9-e76d-475e-87e5-36f50f52bc77.png' },
  { match: /\bonee\b|office.*electricite.*eau/, file: '71de3eba-f53e-42ff-a015-d2d6051c375a.png' },
  { match: /\banep\b|agence nationale.*equipements publics/, file: 'df210e14-cef2-46ea-be0b-09b290cf84cb.png' },
  { match: /\banp\b|agence nationale des ports/, file: 'bd494a19-c706-4bfc-8b41-b6b466a75644.png' },
  { match: /al omrane|holding.*omrane|\balomrane\b/, file: '59ab5100-2c80-4650-9263-b7bd81731fd5.png' },
  // ATLAS uses both "Direction Provinciale" AND "Directeur Provincial" (singular)
  // for the same physical entity. Also handle the legacy "service de l'équipement"
  // form and the truncated "L'EQUIPEMENT…" without "transport".
  { match: /direction provinciale.*(equipement|transport|logistique)|directeur provincial.*(equipement|transport|logistique)|service.*equipement.*transport/, file: '220c110a-d549-46c3-a359-3cfaa66f8e96.png' },
  // Agriculture: same logo for "Direction Provinciale" + "Directeur Provincial"
  // + "Direction Regionale" + "Chambre" + a typo'd "Pronvinciale".
  { match: /direction provinciale.*agriculture|directeur provincial.*agriculture|direction regionale.*agriculture|directeur regional.*agriculture|direction pronvinciale.*agriculture|chambre.*agriculture/, file: '75c3d657-bca2-473d-8264-e59f0a71dd69.png' },
  // Education: every DP Education province + AREF (Académie Régionale d'Éducation).
  { match: /direction provinciale.*education|directeur provincial.*education|ministere.*education|academie regionale d education|\baref\b/, file: 'a72aa028-7630-4085-89b6-5d0f1e9a803f.png' },
  { match: /office.*conseil.*agricole/, file: '836da57a-68f6-456e-8b27-373bd7462f41.png' },
  { match: /office.*securite.*sanitaire.*produits.*alimentaires|\bonssa\b/, file: '815293ea-0c99-4752-96d9-c6204ab1af21.png' },
  { match: /agence nationale.*eaux.*forets|\banef\b/, file: '8bf0947e-8280-4192-bb67-e938ed07f541.png' },
  { match: /agence regionale.*execution.*projets|\barep\b/, file: '0b363a62-76c3-4404-9cbb-f6f33eb85f91.png' },
  { match: /fonds d.equipement communal|\bfec\b/, file: 'a41276ab-308b-4048-88f9-0aa027e602a6.png' },
  { match: /office.*mise en valeur agricole|\bormva\b/, file: '554096e4-f219-4410-be40-454626b05472.png' },
  // Santé: every Direction Régionale santé / Délégué Santé / Groupement Sanitaire
  // / Direction Approvisionnement Médicaments / Centre Hospitalier (non-CHU) →
  // Ministère de la Santé as the umbrella brand (CHUs keep their own logos above).
  { match: /ministere.*sante|sante.*protection sociale|direction regionale.*sante|directeur.*sante|delegue.*sante|groupement sanitaire|approvisionnement.*medicaments|hospitalier prefectoral|hospitalier provincial/, file: '94f65fb6-aabc-4d86-a2c2-173206e615aa.png' },
  // Habous & Affaires Islamiques: ministry + délégations + Direction des Mosquées.
  { match: /habous.*affaires islamiques|direction.*mosquees|delegue.*affaires islamiques|delegation.*affaires islamiques/, file: '287cefce-c213-43e7-91e4-7511c1dc3c0e.png' },
  // Fondation Mohammed VI (datao key uses "De Promotion", ATLAS uses "Pour La Promotion").
  { match: /fondation mohammed vi.*oeuvres sociales|fondation mohammed vi.*promotion/, file: 'a2720c5a-f655-44d9-b97f-c48f6ea1e740.png' },
  { match: /douanes.*impots.*indirects/, file: '9364bdb6-5b6b-467b-8027-1211754d591e.png' },
  { match: /tresorerie generale/, file: '71541112-3b25-4d69-a2af-7eafa0589f4d.png' },
  { match: /caisse.*compensation/, file: 'fb20bc52-167c-4c38-a880-c91c50ba0474.png' },
  { match: /caisse marocaine.*retraites/, file: '066202c4-411d-48ac-8f86-a34e57d0d145.png' },
  { match: /protection civile/, file: '8019c013-9937-4e0f-a243-4d419b67f9b7.png' },
  { match: /direction generale.*meteorologie|meteorologie nationale/, file: 'b732c218-6a39-4955-b9ee-ee869ef69497.png' },
  { match: /universite cadi ayyad|ensa marrakech|sciences.*techniques.*marrakech/, file: 'b3408757-badf-4343-acd0-67340418483b.png' },
  { match: /chu.*marrakech|hospitalier.*mohammed vi.*marrakech|hospitalo.*marrakech/, file: '15716b48-f06e-47f1-a394-296898cb393a.png' },
  { match: /chu.*oujda|hospitalier.*mohammed vi.*oujda|hospitalo.*oujda/, file: '49d7fa23-6b31-4146-b92a-3d3f75e0d97b.png' },
  { match: /chu.*fes|hassan ii.*fes|hospitalo.*fes/, file: '3a69ffa7-6e2d-4704-977f-d6fc7fea50fe.png' },
  { match: /chu.*ibn sina|ibn sina.*rabat/, file: 'd47517db-6c3d-456d-a6aa-2fa3e49528bd.png' },
  { match: /ibn roched|ibn rochd/, file: '6cd08e97-c5b9-41cd-baef-99d9b45caa87.png' },
  // Agence du Bassin Hydraulique — per-region (ATLAS occasionally types "Bassain"
  // for "Bassin"; we accept both via `bass(?:ain|in)`). Each ABH has its own logo
  // in datao so we don't generalize to a single fallback.
  { match: /bass(?:ain|in) hydraulique.*draa.*(?:oued|noun)|(?:draa|oued noun).*bass(?:ain|in) hydraulique/, file: '72e7a2d9-d158-4afd-8b52-e52ebc3e38df.png' },
  { match: /bass(?:ain|in) hydraulique.*bouregreg|bouregreg.*bass(?:ain|in)/, file: '50210047-63f5-486a-add8-f5fc67b8b2f2.png' },
  { match: /bass(?:ain|in) hydraulique.*sebou/, file: '496635f1-e8c5-410a-b5b4-449d76f618f5.png' },
  { match: /bass(?:ain|in) hydraulique.*loukkos/, file: '1ce91dab-52fb-4837-b102-9b514cefdc48.png' },
  { match: /bass(?:ain|in) hydraulique.*oum.*er.*rbia/, file: 'd2264663-db21-4a9c-9bc8-b61ccb5a0b4e.png' },
  // Fall-through bassin hydraulique covers Souss-Massa / Tensift / Moulouya
  // (no datao logo for these) — they collapse to ANEF as the umbrella Eaux &
  // Forêts brand (close enough — same Ministry of Water cluster).
  { match: /bass(?:ain|in) hydraulique|amenagements hydrauliques/, file: '8bf0947e-8280-4192-bb67-e938ed07f541.png' },
  // SRM = Société Régionale Multiservices (post-2024 regional utility companies
  // replacing RADEEs). Each region has its own brand in datao for the 4 we
  // captured; ATLAS has 6 more not in datao. Fall back to the Rabat-Salé-Kénitra
  // SRM logo as the common visual identity until per-region logos are sourced.
  { match: /societe regionale multiservices|\bsrm\b/, file: '7aff5b26-a83a-49ba-aec9-f9ffff80b82a.png' },
  // Région / Conseil Régional — generic region logo (using Région Souss-Massa
  // for that distinct case; others get the Préfecture Rabat as a neutral
  // governance brand. Better than a colored disc).
  { match: /\bregion de sous(?:s)?.*massa\b|\bregion sous(?:s).*massa\b/, file: 'a9672849-f590-4e5d-91fb-00b5919c2498.png' },
  // Préfecture / Wilaya per major city (datao has dedicated logos for these).
  { match: /prefecture.*marrakech|wilaya.*marrakech/, file: '6e2837de-2997-4760-b516-9c5255d1108d.png' },
  { match: /prefecture.*meknes|conseil.*prefecture.*meknes/, file: 'a46b1542-274d-4ea4-92e3-b0d6d2c42e9d.png' },
  { match: /prefecture.*rabat|wali.*region rabat|gouverneur.*prefecture.*rabat/, file: 'f4b0f5ae-3983-457b-a4f8-dfd35c45d4f3.png' },
  { match: /prefecture.*sale|prefecture de sale/, file: 'a084b668-24b0-42bd-9280-3e73e32200ca.png' },
  // CHU catch-all — any "Centre Hospitalo-Universitaire" or "CHU" that didn't
  // match a city-specific rule above falls back to the Ministère de la Santé
  // brand. Better than initials for hospital identification.
  { match: /\bchu\b|hospitalo.{0,4}universitaire|centre hospitalier universitaire|centre hospitalier/, file: '94f65fb6-aabc-4d86-a2c2-173206e615aa.png' },
];
