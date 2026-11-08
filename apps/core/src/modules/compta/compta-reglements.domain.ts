import type { MoneyCents } from '../sales/sales-money.domain';
import {
  ComptaSalesDomainError,
  VENTE_COMPTE_CLIENT,
  VENTE_COMPTE_TVA,
  blockedForMissingAccounts,
  blockedForUnconfiguredTva,
  readyPosting,
  type FaitGenerateurTva,
  type PostingLine,
  type PostingResult,
  type ReadyPosting,
  type SalesPostingAccounts,
  type VenteEcritureLigne,
} from './compta-ventes.domain';

function assertNonNegativeCents(value: MoneyCents, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ComptaSalesDomainError(
      `${label} doit être un entier sûr positif ou nul en centimes.`,
    );
  }
}

function assertPositiveCents(value: MoneyCents, label: string): void {
  assertNonNegativeCents(value, label);
  if (value === 0) {
    throw new ComptaSalesDomainError(`${label} doit être strictement positif.`);
  }
}

function safeAdd(left: MoneyCents, right: MoneyCents, label: string): MoneyCents {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new ComptaSalesDomainError(`${label} dépasse les limites sûres.`);
  }
  return result;
}

export interface ReceiptPostingInput {
  invoiceReference: string;
  clientName: string;
  faitGenerateurTva: FaitGenerateurTva;
  amountCents: MoneyCents;
  invoiceTtcCents: MoneyCents;
  invoiceTvaCents: MoneyCents;
  previouslyReceivedCents: MoneyCents;
  previouslyTransferredTvaCents: MoneyCents;
  receiptTvaCents?: MoneyCents;
  treasuryAccount: string | null;
  accounts: SalesPostingAccounts;
}

export type ReceiptPostingResult =
  | (ReadyPosting & { tvaTransferredCents: MoneyCents })
  | Exclude<PostingResult, ReadyPosting>;

function targetTransferredTva(input: ReceiptPostingInput): MoneyCents {
  if (input.faitGenerateurTva !== 'encaissement' || input.invoiceTvaCents === 0) {
    return 0;
  }
  const cumulativeReceived = safeAdd(
    input.previouslyReceivedCents,
    input.amountCents,
    'Le cumul des encaissements',
  );
  const taxableCumulative = Math.min(cumulativeReceived, input.invoiceTtcCents);
  if (taxableCumulative === input.invoiceTtcCents) return input.invoiceTvaCents;
  return Number(
    (BigInt(input.invoiceTvaCents) * BigInt(taxableCumulative)) /
      BigInt(input.invoiceTtcCents),
  );
}

export function buildReceiptPosting(
  input: ReceiptPostingInput,
): ReceiptPostingResult {
  assertPositiveCents(input.amountCents, 'Le montant encaissé');
  assertPositiveCents(input.invoiceTtcCents, 'Le total TTC de la facture');
  assertNonNegativeCents(input.invoiceTvaCents, 'La TVA de la facture');
  assertNonNegativeCents(
    input.previouslyReceivedCents,
    'Les encaissements antérieurs',
  );
  assertNonNegativeCents(
    input.previouslyTransferredTvaCents,
    'La TVA déjà transférée',
  );
  if (input.invoiceTvaCents > input.invoiceTtcCents) {
    throw new ComptaSalesDomainError(
      'La TVA ne peut pas dépasser le total TTC de la facture.',
    );
  }
  if (input.previouslyTransferredTvaCents > input.invoiceTvaCents) {
    throw new ComptaSalesDomainError(
      'La TVA déjà transférée dépasse la TVA de la facture.',
    );
  }

  const tvaBlock = blockedForUnconfiguredTva(input.faitGenerateurTva);
  if (tvaBlock) return tvaBlock;
  const required: (keyof SalesPostingAccounts)[] = ['client'];
  if (input.faitGenerateurTva === 'encaissement' && input.invoiceTvaCents > 0) {
    required.push('tvaPending', 'tvaDue');
  }
  const accountBlock = blockedForMissingAccounts(input.accounts, required);
  if (accountBlock) return accountBlock;
  const treasuryAccount = input.treasuryAccount?.trim();
  if (!treasuryAccount) {
    return {
      kind: 'blocked',
      code: 'compte_manquant',
      message: 'Le compte de trésorerie du règlement est manquant.',
    };
  }

  const targetTvaCents = targetTransferredTva(input);
  const previousTransfer = input.faitGenerateurTva === 'encaissement'
    ? input.previouslyTransferredTvaCents : 0;
  const tvaTransferredCents = input.faitGenerateurTva === 'encaissement'
    ? input.receiptTvaCents ?? Math.max(0, targetTvaCents - previousTransfer) : 0;
  assertNonNegativeCents(tvaTransferredCents, 'La TVA de cet encaissement');
  if (tvaTransferredCents > input.amountCents ||
      previousTransfer + tvaTransferredCents > input.invoiceTvaCents) {
    throw new ComptaSalesDomainError('La TVA transférée dépasse le solde disponible.');
  }
  const lines: PostingLine[] = [
    {
      accountCode: treasuryAccount,
      debitCents: input.amountCents,
      creditCents: 0,
    },
    {
      accountCode: input.accounts.client!,
      debitCents: 0,
      creditCents: input.amountCents,
      party: input.clientName,
    },
  ];
  if (tvaTransferredCents > 0) {
    lines.push(
      {
        accountCode: input.accounts.tvaPending!,
        debitCents: tvaTransferredCents,
        creditCents: 0,
      },
      {
        accountCode: input.accounts.tvaDue!,
        debitCents: 0,
        creditCents: tvaTransferredCents,
      },
    );
  }
  return {
    ...readyPosting(`Encaissement ${input.invoiceReference}`, lines),
    tvaTransferredCents,
  };
}

export interface PaymentReversalPostingInput {
  invoiceReference: string;
  originalLines: readonly PostingLine[];
}

export function buildPaymentReversalPosting(
  input: PaymentReversalPostingInput,
): ReadyPosting {
  if (input.originalLines.length === 0) {
    throw new ComptaSalesDomainError(
      'Le règlement à contre-passer ne contient aucune ligne.',
    );
  }
  return readyPosting(
    `Contre-passation règlement ${input.invoiceReference}`,
    input.originalLines.map((line) => ({
      ...line,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
    })),
  );
}

export interface RefundPostingInput {
  invoiceReference: string;
  clientName: string;
  amountCents: MoneyCents;
  treasuryAccount: string | null;
  accounts: SalesPostingAccounts;
}

export function buildRefundPosting(input: RefundPostingInput): PostingResult {
  assertPositiveCents(input.amountCents, 'Le montant remboursé');
  const accountBlock = blockedForMissingAccounts(input.accounts, ['client']);
  if (accountBlock) return accountBlock;
  const treasuryAccount = input.treasuryAccount?.trim();
  if (!treasuryAccount) {
    return {
      kind: 'blocked',
      code: 'compte_manquant',
      message: 'Le compte de trésorerie du remboursement est manquant.',
    };
  }
  return readyPosting(`Remboursement ${input.invoiceReference}`, [
    {
      accountCode: input.accounts.client!,
      debitCents: input.amountCents,
      creditCents: 0,
      party: input.clientName,
    },
    {
      accountCode: treasuryAccount,
      debitCents: 0,
      creditCents: input.amountCents,
    },
  ]);
}

export const REGLEMENT_COMPTE_TVA_DUE = '4456';
export type ReglementMethod = 'virement' | 'cheque' | 'espece' | 'carte';

export const REGLEMENT_TRESORERIE: Record<
  ReglementMethod,
  { compte: string; journal: string }
> = {
  virement: { compte: '5141', journal: 'BQ' },
  cheque: { compte: '5141', journal: 'BQ' },
  carte: { compte: '5141', journal: 'BQ' },
  espece: { compte: '5161', journal: 'CAI' },
};

export const DEFAULT_REGLEMENT_METHOD: ReglementMethod = 'virement';

export interface EncaissementSource {
  reference: string;
  clientName: string;
  montantTtc: number;
  tvaMad: number;
  method?: ReglementMethod;
}

export interface EncaissementEcriture {
  journalCode: string;
  pieceRef: string;
  libelle: string;
  lignes: VenteEcritureLigne[];
  certaine: boolean;
}

function roundMad(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildEncaissementEcriture(
  src: EncaissementSource,
): EncaissementEcriture | null {
  const montant = roundMad(src.montantTtc);
  if (montant <= 0) return null;
  const tva = roundMad(src.tvaMad);
  const method = src.method ?? DEFAULT_REGLEMENT_METHOD;
  const { compte, journal } = REGLEMENT_TRESORERIE[method];
  const lignes: VenteEcritureLigne[] = [
    { compteCode: compte, debit: montant, credit: 0 },
    {
      compteCode: VENTE_COMPTE_CLIENT,
      debit: 0,
      credit: montant,
      tiers: src.clientName,
    },
  ];
  if (tva > 0) {
    lignes.push({ compteCode: VENTE_COMPTE_TVA, debit: tva, credit: 0 });
    lignes.push({
      compteCode: REGLEMENT_COMPTE_TVA_DUE,
      debit: 0,
      credit: tva,
    });
  }

  return {
    journalCode: journal,
    pieceRef: src.reference,
    libelle: `Encaissement ${src.reference} — ${src.clientName}`,
    lignes,
    certaine: src.clientName.trim().length > 0,
  };
}
