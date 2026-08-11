import type { MoneyCents } from '../sales/sales-money.domain';
import {
  ComptaSalesDomainError,
  blockedForMissingAccounts,
  blockedForUnconfiguredTva,
  readyPosting,
  type FaitGenerateurTva,
  type PostingLine,
  type PostingResult,
  type ReadyPosting,
  type SalesPostingAccounts,
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
  if (targetTvaCents < input.previouslyTransferredTvaCents) {
    throw new ComptaSalesDomainError(
      'La TVA déjà transférée dépasse la quote-part cumulée des encaissements.',
    );
  }
  const tvaTransferredCents =
    targetTvaCents - input.previouslyTransferredTvaCents;
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
