import { toPhoneDigits, isChannelVerified, looksLikeEnrolmentCode } from './channel-verification';

describe('toPhoneDigits', () => {
  it('strips the leading plus, spaces, dashes and parentheses', () => {
    expect(toPhoneDigits('+254 (700) 000-001')).toBe('254700000001');
    expect(toPhoneDigits('254700000001')).toBe('254700000001');
  });
});

describe('isChannelVerified', () => {
  it('is false when the person has no verified handset at all', () => {
    expect(isChannelVerified({ whatsappVerifiedPhone: null }, '254700000001')).toBe(false);
  });

  it('is true when the inbound wa_id matches the stored digits', () => {
    expect(isChannelVerified({ whatsappVerifiedPhone: '254700000001' }, '254700000001')).toBe(true);
  });

  it('normalizes the inbound address before comparing', () => {
    expect(isChannelVerified({ whatsappVerifiedPhone: '254700000001' }, '+254700000001')).toBe(true);
  });

  // The whole point of binding to a handset rather than to a person: her record stays sealed
  // when the message arrives from a different phone, even though phone_primary still resolves
  // to her.
  it('is false when the message arrives from a different handset than the verified one', () => {
    expect(isChannelVerified({ whatsappVerifiedPhone: '254700000009' }, '254700000001')).toBe(false);
  });

  it('is false for an empty inbound address', () => {
    expect(isChannelVerified({ whatsappVerifiedPhone: '254700000001' }, '')).toBe(false);
  });
});

describe('looksLikeEnrolmentCode', () => {
  it('accepts a bare six-digit message, with or without spacing', () => {
    expect(looksLikeEnrolmentCode('482915')).toBe(true);
    expect(looksLikeEnrolmentCode('  482915 ')).toBe(true);
    expect(looksLikeEnrolmentCode('482 915')).toBe(true);
  });

  it('rejects anything that is not exactly six digits', () => {
    expect(looksLikeEnrolmentCode('48291')).toBe(false);
    expect(looksLikeEnrolmentCode('4829155')).toBe(false);
    expect(looksLikeEnrolmentCode('my code is 482915')).toBe(false);
  });

  // The single most important assertion in this file. Treating a message as an enrolment code
  // makes it terminal — it never reaches the danger-sign matcher. A looser "contains a
  // six-digit run" rule would swallow the message below and silently skip the escalation.
  it('rejects a message that carries danger-sign language alongside digits', () => {
    expect(looksLikeEnrolmentCode('bleeding since 482915')).toBe(false);
    expect(looksLikeEnrolmentCode('I am bleeding 482915')).toBe(false);
  });
});
