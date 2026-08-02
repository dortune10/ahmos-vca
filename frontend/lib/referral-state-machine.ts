// Mirrors backend/src/referral/referral-state-machine.ts (Plan 4) exactly. Duplicated, not
// imported — frontend/ and backend/ are separate npm packages with no shared workspace
// (Plan 1/5 Global Constraints), so Next.js cannot resolve a module living in a sibling
// package. See this plan's Task 4 for the full rationale. Keep this file's transition
// graph byte-for-byte identical to the backend source; the backend remains authoritative
// and will reject with 409 REFERRAL_INVALID_STATE anything this table wrongly allows.
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

export function nextValidReferralStatuses(currentStatus: string): ReferralStatus[] {
  return REFERRAL_STATUS_TRANSITIONS[currentStatus as ReferralStatus] ?? [];
}

export function isTerminalReferralStatus(status: string): boolean {
  return TERMINAL_REFERRAL_STATUSES.includes(status as ReferralStatus);
}

// Episode statuses (Plan 2 + Plan 4's 9-value pregnancy_episode.status set) for which
// creating a new referral makes sense. See this task's write-up for the reasoning behind
// each inclusion/exclusion.
const EPISODE_STATUSES_ELIGIBLE_FOR_REFERRAL = ['Active', 'Admitted'];

export function isEpisodeEligibleForReferral(episodeStatus: string): boolean {
  return EPISODE_STATUSES_ELIGIBLE_FOR_REFERRAL.includes(episodeStatus);
}
