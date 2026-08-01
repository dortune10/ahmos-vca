export type ReferralStatus =
  | 'Created'
  | 'Sent'
  | 'Accepted'
  | 'Dispatched'
  | 'InTransit'
  | 'Arrived'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

// Exact graph per the design spec (Section 4 / Core User Flow #4) and docs/PRD.md's
// "Feature: Referral Management" states list. Completed/Failed/Cancelled are terminal —
// no key for them means no outgoing transitions.
export const REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  Created: ['Sent', 'Cancelled'],
  Sent: ['Accepted', 'Cancelled'],
  Accepted: ['Dispatched', 'Cancelled'],
  Dispatched: ['InTransit', 'Failed'],
  InTransit: ['Arrived', 'Failed'],
  Arrived: ['Completed'],
  Completed: [],
  Failed: [],
  Cancelled: [],
};

export const TERMINAL_REFERRAL_STATUSES: ReferralStatus[] = ['Completed', 'Failed', 'Cancelled'];

export class InvalidReferralStateError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
  ) {
    super(`Referral cannot transition from ${currentStatus} to ${attemptedStatus}`);
  }
}

export function assertValidReferralTransition(
  currentStatus: string,
  attemptedStatus: string,
): void {
  const allowed = REFERRAL_STATUS_TRANSITIONS[currentStatus as ReferralStatus];
  if (!allowed || !allowed.includes(attemptedStatus as ReferralStatus)) {
    throw new InvalidReferralStateError(currentStatus, attemptedStatus);
  }
}
