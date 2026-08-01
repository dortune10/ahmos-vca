import {
  REFERRAL_STATUS_TRANSITIONS,
  TERMINAL_REFERRAL_STATUSES,
  InvalidReferralStateError,
  assertValidReferralTransition,
  ReferralStatus,
} from './referral-state-machine';

const ALL_STATUSES: ReferralStatus[] = [
  'Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled',
];

describe('referral state machine', () => {
  describe('valid transitions', () => {
    const validCases: Array<[ReferralStatus, ReferralStatus]> = [
      ['Created', 'Sent'],
      ['Created', 'Cancelled'],
      ['Sent', 'Accepted'],
      ['Sent', 'Cancelled'],
      ['Accepted', 'Dispatched'],
      ['Accepted', 'Cancelled'],
      ['Dispatched', 'InTransit'],
      ['Dispatched', 'Failed'],
      ['InTransit', 'Arrived'],
      ['InTransit', 'Failed'],
      ['Arrived', 'Completed'],
    ];

    it.each(validCases)('allows %s -> %s', (from, to) => {
      expect(() => assertValidReferralTransition(from, to)).not.toThrow();
    });

    it('the transition table has no valid transitions beyond these 11', () => {
      const total = Object.values(REFERRAL_STATUS_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      );
      expect(total).toBe(validCases.length);
    });
  });

  describe('invalid transitions', () => {
    it('rejects the PRD example: Completed -> InTransit', () => {
      // Gherkin (docs/PRD.md "Invalid referral transition" scenario):
      //   Given a referral is in status Completed
      //   When a user attempts to change the status to InTransit
      //   Then the API shall reject the request (this unit proves the domain-level
      //   rejection; Task 5's e2e test proves the HTTP 409 + REFERRAL_INVALID_STATE
      //   contract on top of it)
      expect(() => assertValidReferralTransition('Completed', 'InTransit')).toThrow(
        InvalidReferralStateError,
      );
      try {
        assertValidReferralTransition('Completed', 'InTransit');
        fail('expected assertValidReferralTransition to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidReferralStateError);
        const typed = err as InvalidReferralStateError;
        expect(typed.currentStatus).toBe('Completed');
        expect(typed.attemptedStatus).toBe('InTransit');
        expect(typed.message).toBe('Referral cannot transition from Completed to InTransit');
      }
    });

    const invalidCases: Array<[ReferralStatus, ReferralStatus]> = [
      ['Created', 'Accepted'], // skips Sent
      ['Created', 'Dispatched'],
      ['Sent', 'Dispatched'], // skips Accepted
      ['Accepted', 'InTransit'], // skips Dispatched
      ['Arrived', 'Failed'], // Arrived only allows Completed
      ['Dispatched', 'Arrived'], // skips InTransit
    ];

    it.each(invalidCases)('rejects %s -> %s', (from, to) => {
      expect(() => assertValidReferralTransition(from, to)).toThrow(InvalidReferralStateError);
    });
  });

  describe('terminal states have no exits', () => {
    it.each(TERMINAL_REFERRAL_STATUSES)('%s cannot transition to any other status', (terminal) => {
      for (const target of ALL_STATUSES) {
        expect(() => assertValidReferralTransition(terminal, target)).toThrow(
          InvalidReferralStateError,
        );
      }
    });
  });
});
