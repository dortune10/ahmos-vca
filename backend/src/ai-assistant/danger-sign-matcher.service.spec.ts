import { DangerSignMatcherService } from './danger-sign-matcher.service';

describe('DangerSignMatcherService', () => {
  let service: DangerSignMatcherService;

  beforeEach(() => {
    service = new DangerSignMatcherService();
  });

  it('matches a message describing heavy bleeding', () => {
    const result = service.match('I have heavy bleeding since this morning');
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toContain('heavy bleeding');
  });

  it('matches a message describing no fetal movement, case-insensitively', () => {
    const result = service.match('BABY NOT MOVING since yesterday, worried');
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toContain('baby not moving');
  });

  it('matches a message mentioning a seizure', () => {
    const result = service.match('I had a seizure an hour ago');
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toContain('seizure');
  });

  it('does not match an ordinary profile-data question', () => {
    const result = service.match('When is my next appointment?');
    expect(result.matched).toBe(false);
    expect(result.matchedKeywords).toEqual([]);
  });

  it('returns every matched keyword when a message contains more than one', () => {
    const result = service.match('severe headache and blurred vision since last night');
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['severe headache', 'blurred vision']));
  });

  // Regression guard: substring matching made 'fits' fire on 'benefits', which would page a
  // real health worker for a routine question. Matching is word-boundary based.
  it('does not match danger-sign keywords embedded inside ordinary words', () => {
    expect(service.match('what are the benefits of this visit?').matched).toBe(false);
    expect(service.match('do I need new outfits for the baby?').matched).toBe(false);
  });
});
