import type { BidWorkspaceState } from '@atlas/contracts';

const GENERIC_TRANSITIONS: Readonly<
  Record<BidWorkspaceState, readonly BidWorkspaceState[]>
> = {
  evaluating: ['go', 'no_go', 'cancelled'],
  go: ['assembling', 'cancelled'],
  no_go: [],
  assembling: ['review', 'cancelled'],
  review: ['assembling', 'cancelled'],
  // Every state below depends on package, signature, portal or official-result
  // evidence. Dedicated atomic commands own those transitions; the generic
  // endpoint cannot manufacture legal facts by changing a state string.
  frozen: [],
  awaiting_signature: [],
  signing: [],
  signed: [],
  ready_to_submit: [],
  submitting: [],
  submitted: [],
  withdrawal_pending: [],
  withdrawn: [],
  opened: [],
  won: [],
  lost: [],
  rejected: [],
  cancelled: [],
  guarantee_release_eligible: [],
  closed: [],
};

const SPECIALIZED_TRANSITIONS = new Set<string>([
  'review:frozen',
  'frozen:assembling',
  'frozen:awaiting_signature',
  'awaiting_signature:assembling',
  'awaiting_signature:signing',
  'signing:assembling',
  'signing:awaiting_signature',
  'signing:signed',
  'signed:assembling',
  'signed:ready_to_submit',
  'ready_to_submit:assembling',
  'ready_to_submit:submitting',
  'submitting:ready_to_submit',
  'submitting:submitted',
  'submitted:withdrawal_pending',
  'submitted:opened',
  'withdrawal_pending:submitted',
  'withdrawal_pending:withdrawn',
  'opened:won',
  'opened:lost',
  'opened:rejected',
  'won:closed',
  'lost:guarantee_release_eligible',
  'lost:closed',
  'rejected:guarantee_release_eligible',
  'rejected:closed',
  'guarantee_release_eligible:closed',
]);

export class BidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BidTransitionError';
  }
}

export function legalBidTargets(from: BidWorkspaceState): readonly BidWorkspaceState[] {
  return GENERIC_TRANSITIONS[from];
}

export function assertBidTransition(
  from: BidWorkspaceState,
  to: BidWorkspaceState,
): void {
  if (from === 'submitting' && to === 'submitted') {
    throw new BidTransitionError(
      'Official receipt is required to mark a bid as submitted',
    );
  }
  if (SPECIALIZED_TRANSITIONS.has(`${from}:${to}`)) {
    throw new BidTransitionError(
      `Specialized command required for bid workspace transition: ${from} → ${to}`,
    );
  }
  if (!GENERIC_TRANSITIONS[from].includes(to)) {
    throw new BidTransitionError(`Illegal bid workspace transition: ${from} → ${to}`);
  }
}
