import { MessageRouterService } from './message-router.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';

function buildPerson(whatsappConsent: boolean): PersonResponseDto {
  const person = new PersonResponseDto();
  person.id = 'p1';
  person.tenantId = 't1';
  person.firstName = 'Amina';
  person.lastName = null;
  person.phonePrimary = '+254700000001';
  person.dateOfBirth = null;
  person.whatsappConsent = whatsappConsent;
  person.whatsappConsentAt = whatsappConsent ? '2026-08-01T00:00:00.000Z' : null;
  return person;
}

describe('MessageRouterService (Plan 1 stub — Plan 2 replaces this)', () => {
  it('returns a fixed "still being set up" reply for a consented person, regardless of the inbound text', async () => {
    const service = new MessageRouterService();

    const reply = await service.route({ person: buildPerson(true) }, 'When is my next appointment?');

    expect(reply).toContain('still being set up');
  });

  // The consent seam (docs/DECISIONS.md #27): the controller now hands EVERY message from a
  // known person to the router, consented or not. Plan 1 has no danger-sign detection, so it
  // has nothing safe to say to someone who has not opted in — null tells the controller to
  // send the opt-in prompt alone, which is exactly the pre-#27 behaviour. Plan 2 replaces this
  // body so that a danger-sign message like the one below escalates instead.
  it('returns null for a person who has not consented yet, even for danger-sign language', async () => {
    const service = new MessageRouterService();

    await expect(
      service.route({ person: buildPerson(false) }, 'I have heavy bleeding'),
    ).resolves.toBeNull();
  });
});
