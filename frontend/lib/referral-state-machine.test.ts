import {
  REFERRAL_STATUS_TRANSITIONS,
  TERMINAL_REFERRAL_STATUSES,
  nextValidReferralStatuses,
  isTerminalReferralStatus,
  isEpisodeEligibleForReferral,
} from './referral-state-machine';

describe('referral-state-machine (frontend mirror of backend/src/referral/referral-state-machine.ts)', () => {
  it('matches the exact 9-state graph from Plan 4', () => {
    expect(REFERRAL_STATUS_TRANSITIONS).toEqual({
      Created: ['Sent', 'Cancelled'],
      Sent: ['Accepted', 'Cancelled'],
      Accepted: ['Dispatched', 'Cancelled'],
      Dispatched: ['InTransit', 'Failed'],
      InTransit: ['Arrived', 'Failed'],
      Arrived: ['Completed'],
      Completed: [],
      Failed: [],
      Cancelled: [],
    });
    expect(TERMINAL_REFERRAL_STATUSES).toEqual(['Completed', 'Failed', 'Cancelled']);
  });

  it('nextValidReferralStatuses returns the allowed next states for a mid-flow status', () => {
    expect(nextValidReferralStatuses('Sent')).toEqual(['Accepted', 'Cancelled']);
    expect(nextValidReferralStatuses('Accepted')).toEqual(['Dispatched', 'Cancelled']);
  });

  it('nextValidReferralStatuses returns an empty array for a terminal status', () => {
    expect(nextValidReferralStatuses('Completed')).toEqual([]);
  });

  it('nextValidReferralStatuses returns an empty array for an unrecognized status rather than throwing', () => {
    expect(nextValidReferralStatuses('NotARealStatus')).toEqual([]);
  });

  it('isTerminalReferralStatus is true only for Completed, Failed, Cancelled', () => {
    expect(isTerminalReferralStatus('Completed')).toBe(true);
    expect(isTerminalReferralStatus('Failed')).toBe(true);
    expect(isTerminalReferralStatus('Cancelled')).toBe(true);
    expect(isTerminalReferralStatus('Sent')).toBe(false);
  });
});

describe('isEpisodeEligibleForReferral', () => {
  it('is true for Active and Admitted episodes', () => {
    expect(isEpisodeEligibleForReferral('Active')).toBe(true);
    expect(isEpisodeEligibleForReferral('Admitted')).toBe(true);
  });

  it('is false for Draft, Referred, Delivered, PostnatalActive, Closed, Archived, Cancelled', () => {
    for (const status of [
      'Draft',
      'Referred',
      'Delivered',
      'PostnatalActive',
      'Closed',
      'Archived',
      'Cancelled',
    ]) {
      expect(isEpisodeEligibleForReferral(status)).toBe(false);
    }
  });
});
