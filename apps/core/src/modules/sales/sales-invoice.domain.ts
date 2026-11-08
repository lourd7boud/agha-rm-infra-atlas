import type { MoneyCents } from './sales-money.domain';

export type InvoiceLifecycle = 'brouillon' | 'emise' | 'annulee';
export type InvoiceSettlementState =
  | 'non_reglee'
  | 'partiellement_payee'
  | 'payee'
  | 'solde_crediteur'
  | 'remboursee';
export type PaymentMovementType = 'encaissement' | 'remboursement';

export class SalesInvoiceDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesInvoiceDomainError';
  }
}

function assertNonNegativeCents(value: MoneyCents, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SalesInvoiceDomainError(
      `${label} doit être un entier sûr positif ou nul en centimes.`,
    );
  }
}

function addSafeCents(left: MoneyCents, right: MoneyCents, label: string): MoneyCents {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new SalesInvoiceDomainError(`${label} dépasse les limites sûres.`);
  }
  return result;
}

const ALLOWED_TRANSITIONS: Readonly<Record<InvoiceLifecycle, readonly InvoiceLifecycle[]>> = {
  brouillon: ['brouillon', 'emise'],
  emise: ['emise', 'annulee'],
  annulee: ['annulee'],
};

export function assertInvoiceTransition(
  current: InvoiceLifecycle,
  next: InvoiceLifecycle,
): InvoiceLifecycle {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new SalesInvoiceDomainError(
      `Transition de facture interdite : ${current} → ${next}.`,
    );
  }
  return next;
}

export interface SettlementInput {
  totalCents: MoneyCents;
  receivedCents: MoneyCents;
  creditedCents: MoneyCents;
  refundedCents: MoneyCents;
}

export interface SettlementSummary {
  state: InvoiceSettlementState;
  netInvoiceCents: MoneyCents;
  netReceivedCents: MoneyCents;
  outstandingCents: MoneyCents;
  customerCreditCents: MoneyCents;
}

export function deriveSettlement(input: SettlementInput): SettlementSummary {
  assertNonNegativeCents(input.totalCents, 'Le total de facture');
  assertNonNegativeCents(input.receivedCents, 'Les encaissements');
  assertNonNegativeCents(input.creditedCents, 'Les avoirs');
  assertNonNegativeCents(input.refundedCents, 'Les remboursements');
  if (input.creditedCents > input.totalCents) {
    throw new SalesInvoiceDomainError(
      'Les avoirs ne peuvent pas dépasser le total de la facture.',
    );
  }
  if (input.refundedCents > input.receivedCents) {
    throw new SalesInvoiceDomainError(
      'Les remboursements ne peuvent pas dépasser les encaissements.',
    );
  }

  const netInvoiceCents = input.totalCents - input.creditedCents;
  const netReceivedCents = input.receivedCents - input.refundedCents;
  const outstandingCents = Math.max(0, netInvoiceCents - netReceivedCents);
  const customerCreditCents = Math.max(0, netReceivedCents - netInvoiceCents);

  let state: InvoiceSettlementState;
  if (customerCreditCents > 0) {
    state = 'solde_crediteur';
  } else if (netInvoiceCents === 0 && input.refundedCents > 0) {
    state = 'remboursee';
  } else if (outstandingCents === 0) {
    state = 'payee';
  } else if (netReceivedCents === 0) {
    state = 'non_reglee';
  } else {
    state = 'partiellement_payee';
  }

  return {
    state,
    netInvoiceCents,
    netReceivedCents,
    outstandingCents,
    customerCreditCents,
  };
}

export interface PaymentMovement {
  type: PaymentMovementType;
  amountCents: MoneyCents;
}

export function summarizePaymentMovements(
  movements: readonly PaymentMovement[],
  openingReceivedCents: MoneyCents = 0,
): Pick<SettlementInput, 'receivedCents' | 'refundedCents'> {
  assertNonNegativeCents(openingReceivedCents, 'La position de reprise encaissée');
  let receivedCents = openingReceivedCents;
  let refundedCents = 0;

  for (const movement of movements) {
    assertNonNegativeCents(movement.amountCents, 'Le mouvement de règlement');
    if (movement.amountCents === 0) {
      throw new SalesInvoiceDomainError(
        'Le mouvement de règlement doit être strictement positif.',
      );
    }
    if (movement.type === 'encaissement') {
      receivedCents = addSafeCents(
        receivedCents,
        movement.amountCents,
        'Le cumul des encaissements',
      );
    } else {
      refundedCents = addSafeCents(
        refundedCents,
        movement.amountCents,
        'Le cumul des remboursements',
      );
      if (refundedCents > receivedCents) {
        throw new SalesInvoiceDomainError(
          'Les remboursements ne peuvent pas dépasser les encaissements.',
        );
      }
    }
  }

  return { receivedCents, refundedCents };
}

export interface CreditNoteAllocationInput {
  invoiceTotalCents: MoneyCents;
  previouslyCreditedCents: MoneyCents;
  netReceivedCents: MoneyCents;
  requestedCreditCents: MoneyCents;
}

export interface CreditNoteAllocation {
  againstOutstandingCents: MoneyCents;
  againstCollectedCents: MoneyCents;
}

export function allocateCreditNote(
  input: CreditNoteAllocationInput,
): CreditNoteAllocation {
  assertNonNegativeCents(input.invoiceTotalCents, 'Le total de facture');
  assertNonNegativeCents(input.previouslyCreditedCents, 'Les avoirs antérieurs');
  assertNonNegativeCents(input.netReceivedCents, 'Les encaissements nets');
  assertNonNegativeCents(input.requestedCreditCents, 'Le montant de l’avoir');
  if (input.requestedCreditCents === 0) {
    throw new SalesInvoiceDomainError(
      'Le montant de l’avoir doit être strictement positif.',
    );
  }

  const remainingInvoiceCents =
    input.invoiceTotalCents - input.previouslyCreditedCents;
  if (remainingInvoiceCents < 0) {
    throw new SalesInvoiceDomainError(
      'Les avoirs antérieurs dépassent le total de la facture.',
    );
  }
  if (input.requestedCreditCents > remainingInvoiceCents) {
    throw new SalesInvoiceDomainError(
      'Le montant de l’avoir dépasse le montant restant de la facture.',
    );
  }

  const outstandingBeforeCredit = Math.max(
    0,
    remainingInvoiceCents - input.netReceivedCents,
  );
  const againstOutstandingCents = Math.min(
    input.requestedCreditCents,
    outstandingBeforeCredit,
  );
  return {
    againstOutstandingCents,
    againstCollectedCents:
      input.requestedCreditCents - againstOutstandingCents,
  };
}
