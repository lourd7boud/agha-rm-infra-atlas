import type {
  ClientRecord,
  InvoiceRecord,
  LegalClientSnapshot,
  LegalSellerSnapshot,
} from './sales';
import type { ComptaProfil } from './compta';

export function sellerFromProfile(profile: ComptaProfil): LegalSellerSnapshot {
  return {
    legalName: profile.raisonSociale,
    address: profile.adresse ?? '',
    ice: profile.ice ?? '',
    taxId: profile.identifiantFiscal ?? '',
    tradeRegister: profile.registreCommerce ?? '',
    professionalTaxId: profile.taxeProfessionnelle ?? undefined,
  };
}

export function legalParties(
  snapshot: LegalSellerSnapshot | undefined,
  liveClient: ClientRecord,
  fallbackSeller?: LegalSellerSnapshot,
) {
  const seller = snapshot?.legalName ? snapshot : fallbackSeller;
  const client: LegalClientSnapshot = snapshot?.client ?? liveClient;
  return {
    seller,
    client,
    compatibilityFallback: !snapshot?.legalName || !snapshot.client,
  };
}

export function buildInvoiceLegalDocument(
  invoice: InvoiceRecord,
  liveClient: ClientRecord,
  fallbackSeller?: LegalSellerSnapshot,
) {
  const parties = legalParties(invoice.legalSnapshot, liveClient, fallbackSeller);
  const blockReasons: string[] = [];
  if (!invoice.reference) blockReasons.push('Référence officielle manquante.');
  if (!invoice.invoiceDate) blockReasons.push('Date de facture manquante.');
  for (const [field, label] of [
    ['legalName', 'raison sociale'],
    ['address', 'adresse'],
    ['ice', 'ICE'],
    ['taxId', 'IF'],
    ['tradeRegister', 'RC'],
  ] as const) {
    if (!parties.seller?.[field]?.trim()) {
      blockReasons.push(`Donnée vendeur manquante : ${label}.`);
    }
  }
  if (!parties.client.name?.trim()) blockReasons.push('Identité du client manquante.');
  if (!parties.client.address?.trim()) blockReasons.push('Adresse du client manquante.');
  if (parties.client.clientType === 'professionnel' && !parties.client.ice?.trim()) {
    blockReasons.push('ICE du client professionnel manquant.');
  }
  if (!invoice.lines.length || invoice.lines.some((line) =>
    !line.designation.trim() || line.quantity <= 0 ||
    !Number.isFinite(line.unitPriceMad) || line.unitPriceMad < 0
  )) blockReasons.push('Lignes de facture incomplètes.');
  if ([invoice.totalHtMad, invoice.tvaMad, invoice.totalTtcMad].some(
    (amount) => !Number.isFinite(amount) || amount < 0,
  )) blockReasons.push('Totaux de facture invalides.');
  return {
    ...parties,
    blockReasons,
    watermark: invoice.status === 'brouillon'
      ? 'BROUILLON — NON VALABLE'
      : blockReasons.length > 0 ? 'DOCUMENT INCOMPLET — À VÉRIFIER' : undefined,
    currency: 'MAD' as const,
    paymentTerms: invoice.paymentTerms ?? 'Selon échéance indiquée sur la facture',
  };
}
