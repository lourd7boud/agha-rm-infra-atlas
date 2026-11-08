import {
  formatMoneyCents,
  type MoneyCents,
} from '../sales/sales-money.domain';
import { validateEcriture } from './compta-livres.domain';

export type FaitGenerateurTva = 'non_configure' | 'encaissement' | 'debits';
export type PostingBlockCode =
  | 'fait_generateur_tva_non_configure'
  | 'compte_manquant';

export interface SalesPostingAccounts {
  client: string | null;
  revenue: string | null;
  tvaPending: string | null;
  tvaDue: string | null;
}

export interface PostingLine {
  accountCode: string;
  debitCents: MoneyCents;
  creditCents: MoneyCents;
  party?: string;
}

export interface ReadyPosting {
  kind: 'ready';
  label: string;
  lines: PostingLine[];
}

export interface BlockedPosting {
  kind: 'blocked';
  code: PostingBlockCode;
  message: string;
}

export type PostingResult = ReadyPosting | BlockedPosting;

export class ComptaSalesDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComptaSalesDomainError';
  }
}

function assertNonNegativeCents(value: MoneyCents, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ComptaSalesDomainError(
      `${label} doit être un entier sûr positif ou nul en centimes.`,
    );
  }
}

function assertDocumentTotals(input: {
  totalHtCents: MoneyCents;
  tvaCents: MoneyCents;
  totalTtcCents: MoneyCents;
}): void {
  assertNonNegativeCents(input.totalHtCents, 'Le total HT');
  assertNonNegativeCents(input.tvaCents, 'La TVA');
  assertNonNegativeCents(input.totalTtcCents, 'Le total TTC');
  if (input.totalHtCents === 0 || input.totalTtcCents === 0) {
    throw new ComptaSalesDomainError(
      'Les totaux HT et TTC doivent être strictement positifs.',
    );
  }
  if (
    !Number.isSafeInteger(input.totalHtCents + input.tvaCents) ||
    input.totalHtCents + input.tvaCents !== input.totalTtcCents
  ) {
    throw new ComptaSalesDomainError(
      'Le total HT augmenté de la TVA doit être exactement égal au total TTC.',
    );
  }
}

function configuredAccount(
  accounts: SalesPostingAccounts,
  key: keyof SalesPostingAccounts,
): string | null {
  const account = accounts[key]?.trim();
  return account ? account : null;
}

export function blockedForMissingAccounts(
  accounts: SalesPostingAccounts,
  required: readonly (keyof SalesPostingAccounts)[],
): BlockedPosting | null {
  const missing = required.filter((key) => !configuredAccount(accounts, key));
  if (missing.length === 0) return null;
  return {
    kind: 'blocked',
    code: 'compte_manquant',
    message: `Comptes comptables manquants : ${missing.join(', ')}.`,
  };
}

export function blockedForUnconfiguredTva(
  faitGenerateurTva: FaitGenerateurTva,
): BlockedPosting | null {
  return faitGenerateurTva === 'non_configure'
    ? {
        kind: 'blocked',
        code: 'fait_generateur_tva_non_configure',
        message:
          'Le fait générateur de TVA doit être configuré avant la projection comptable.',
      }
    : null;
}

export function readyPosting(label: string, lines: PostingLine[]): ReadyPosting {
  validateEcriture(
    lines.map((line) => ({
      compteCode: line.accountCode,
      debit: formatMoneyCents(line.debitCents),
      credit: formatMoneyCents(line.creditCents),
      tiers: line.party,
    })),
  );
  return { kind: 'ready', label, lines };
}

export interface InvoicePostingInput {
  reference: string;
  clientName: string;
  faitGenerateurTva: FaitGenerateurTva;
  totalHtCents: MoneyCents;
  tvaCents: MoneyCents;
  totalTtcCents: MoneyCents;
  accounts: SalesPostingAccounts;
}

export function buildInvoiceIssuePosting(
  input: InvoicePostingInput,
): PostingResult {
  assertDocumentTotals(input);
  const tvaBlock = blockedForUnconfiguredTva(input.faitGenerateurTva);
  if (tvaBlock) return tvaBlock;

  const tvaAccountKey =
    input.faitGenerateurTva === 'encaissement' ? 'tvaPending' : 'tvaDue';
  const required: (keyof SalesPostingAccounts)[] = ['client', 'revenue'];
  if (input.tvaCents > 0) required.push(tvaAccountKey);
  const accountBlock = blockedForMissingAccounts(input.accounts, required);
  if (accountBlock) return accountBlock;

  const lines: PostingLine[] = [
    {
      accountCode: configuredAccount(input.accounts, 'client')!,
      debitCents: input.totalTtcCents,
      creditCents: 0,
      party: input.clientName,
    },
    {
      accountCode: configuredAccount(input.accounts, 'revenue')!,
      debitCents: 0,
      creditCents: input.totalHtCents,
    },
  ];
  if (input.tvaCents > 0) {
    lines.push({
      accountCode: configuredAccount(input.accounts, tvaAccountKey)!,
      debitCents: 0,
      creditCents: input.tvaCents,
    });
  }
  return readyPosting(`Facture ${input.reference}`, lines);
}

export interface CreditNotePostingInput extends InvoicePostingInput {
  againstOutstandingCents: MoneyCents;
  againstCollectedCents: MoneyCents;
  outstandingBeforeCreditCents: MoneyCents;
  availablePendingTvaCents: MoneyCents;
  availableDueTvaCents: MoneyCents;
}

export function buildCreditNotePosting(
  input: CreditNotePostingInput,
): PostingResult {
  assertDocumentTotals(input);
  assertNonNegativeCents(
    input.againstOutstandingCents,
    'La part imputée sur la créance',
  );
  assertNonNegativeCents(
    input.againstCollectedCents,
    'La part imputée sur les encaissements',
  );
  assertNonNegativeCents(
    input.outstandingBeforeCreditCents,
    'La créance avant avoir',
  );
  assertNonNegativeCents(
    input.availablePendingTvaCents,
    'La TVA en attente disponible',
  );
  assertNonNegativeCents(
    input.availableDueTvaCents,
    'La TVA exigible disponible',
  );
  if (input.againstOutstandingCents > input.outstandingBeforeCreditCents) {
    throw new ComptaSalesDomainError(
      'La part imputée sur la créance dépasse la créance avant avoir.',
    );
  }
  if (
    !Number.isSafeInteger(
      input.againstOutstandingCents + input.againstCollectedCents,
    ) ||
    input.againstOutstandingCents + input.againstCollectedCents !==
      input.totalTtcCents
  ) {
    throw new ComptaSalesDomainError(
      'La ventilation de l’avoir doit être exactement égale à son total TTC.',
    );
  }

  const tvaBlock = blockedForUnconfiguredTva(input.faitGenerateurTva);
  if (tvaBlock) return tvaBlock;
  let pendingTvaCents = 0;
  let dueTvaCents = input.tvaCents;
  if (input.tvaCents > 0 && input.faitGenerateurTva === 'encaissement') {
    const availableTvaCents =
      input.availablePendingTvaCents + input.availableDueTvaCents;
    if (
      !Number.isSafeInteger(availableTvaCents) ||
      input.tvaCents > availableTvaCents
    ) {
      throw new ComptaSalesDomainError(
        'La TVA de l’avoir dépasse la position TVA disponible.',
      );
    }

    if (input.againstOutstandingCents > 0) {
      const nominalPendingTvaCents = Number(
        (BigInt(input.tvaCents) * BigInt(input.againstOutstandingCents)) /
          BigInt(input.totalTtcCents),
      );
      pendingTvaCents = nominalPendingTvaCents;
      const closesOutstanding =
        input.againstOutstandingCents === input.outstandingBeforeCreditCents;
      if (
        closesOutstanding &&
        Math.abs(input.availablePendingTvaCents - nominalPendingTvaCents) <= 1 &&
        input.availablePendingTvaCents <= input.tvaCents
      ) {
        pendingTvaCents = input.availablePendingTvaCents;
      }
    }
    if (pendingTvaCents > input.availablePendingTvaCents) {
      throw new ComptaSalesDomainError(
        'La TVA de l’avoir dépasse la position TVA en attente disponible.',
      );
    }
    dueTvaCents = input.tvaCents - pendingTvaCents;
    if (dueTvaCents > input.availableDueTvaCents) {
      throw new ComptaSalesDomainError(
        'La TVA de l’avoir dépasse la position TVA exigible disponible.',
      );
    }
  } else if (
    input.tvaCents > 0 &&
    input.tvaCents > input.availableDueTvaCents
  ) {
    throw new ComptaSalesDomainError(
      'La TVA de l’avoir dépasse la position TVA exigible disponible.',
    );
  }

  const required: (keyof SalesPostingAccounts)[] = ['client', 'revenue'];
  if (pendingTvaCents > 0) required.push('tvaPending');
  if (dueTvaCents > 0) required.push('tvaDue');
  const accountBlock = blockedForMissingAccounts(input.accounts, required);
  if (accountBlock) return accountBlock;

  const lines: PostingLine[] = [
    {
      accountCode: configuredAccount(input.accounts, 'revenue')!,
      debitCents: input.totalHtCents,
      creditCents: 0,
    },
  ];
  if (pendingTvaCents > 0) {
    lines.push({
      accountCode: configuredAccount(input.accounts, 'tvaPending')!,
      debitCents: pendingTvaCents,
      creditCents: 0,
    });
  }
  if (dueTvaCents > 0) {
    lines.push({
      accountCode: configuredAccount(input.accounts, 'tvaDue')!,
      debitCents: dueTvaCents,
      creditCents: 0,
    });
  }
  lines.push({
    accountCode: configuredAccount(input.accounts, 'client')!,
    debitCents: 0,
    creditCents: input.totalTtcCents,
    party: input.clientName,
  });
  return readyPosting(`Avoir ${input.reference}`, lines);
}

// Compatibility surface used by the existing sales posting repository. The new
// centime-based builders above remain authoritative for the compliant event flow.
export const VENTE_COMPTE_CLIENT = '3421';
export const VENTE_COMPTE_PRODUIT = '71242';
export const VENTE_COMPTE_TVA = '4455';
export const VENTE_JOURNAL = 'VTE';

export interface VenteEcritureLigne {
  compteCode: string;
  debit: number;
  credit: number;
  tiers?: string;
}

export type VentePostingReason =
  | 'posted'
  | 'already_posted'
  | 'raced'
  | 'still_draft'
  | 'not_paid'
  | 'not_found'
  | 'incoherent'
  | 'exercice_cloture'
  | 'error';

export interface VentePostingResult {
  created: boolean;
  ecritureId?: string;
  validated?: boolean;
  reason: VentePostingReason;
}

export const VENTE_POSTING_NEEDS_ATTENTION: readonly VentePostingReason[] = [
  'incoherent',
  'exercice_cloture',
  'error',
];

export interface VenteSource {
  reference: string;
  clientName: string;
  totalHtMad: number;
  totalTtcMad: number;
}

export interface VenteEcriture {
  journalCode: typeof VENTE_JOURNAL;
  pieceRef: string;
  libelle: string;
  lignes: VenteEcritureLigne[];
  tvaMad: number;
  certaine: boolean;
}

function roundMad(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildVenteEcriture(src: VenteSource): VenteEcriture | null {
  const ht = roundMad(src.totalHtMad);
  const ttc = roundMad(src.totalTtcMad);
  const tva = roundMad(ttc - ht);
  if (ttc <= 0 || ht < 0 || ht > ttc) return null;

  const lignes: VenteEcritureLigne[] = [
    {
      compteCode: VENTE_COMPTE_CLIENT,
      debit: ttc,
      credit: 0,
      tiers: src.clientName,
    },
    { compteCode: VENTE_COMPTE_PRODUIT, debit: 0, credit: ht },
  ];
  if (tva > 0) {
    lignes.push({ compteCode: VENTE_COMPTE_TVA, debit: 0, credit: tva });
  }

  const totalDebit = roundMad(lignes.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = roundMad(
    lignes.reduce((sum, line) => sum + line.credit, 0),
  );

  return {
    journalCode: VENTE_JOURNAL,
    pieceRef: src.reference,
    libelle: `Facture ${src.reference} — ${src.clientName}`,
    lignes,
    tvaMad: tva,
    certaine:
      src.clientName.trim().length > 0 &&
      totalDebit === totalCredit &&
      totalDebit > 0,
  };
}
