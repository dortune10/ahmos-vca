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
  person.whatsappVerifiedPhone = '254700000001';
  person.whatsappVerifiedAt = '2026-08-01T00:00:00.000Z';
  return person;
}

describe('MessageRouterService (Plan 1 stub — Plan 2 replaces this)', () => {
  it('returns a fixed "still being set up" reply for a verified, consented person, regardless of the inbound text', async () => {
    const service = new MessageRouterService();

    const reply = await service.route(
      { person: buildPerson(true), channelVerified: true },
      'When is my next appointment?',
    );

    expect(reply).toContain('still being set up');
  });

  // The consent seam (docs/DECISIONS.md #27): the controller hands EVERY message from a known
  // person to the router, consented or not. Plan 1 has no danger-sign detection, so it has
  // nothing safe to say to someone who has not opted in — null tells the controller to send the
  // opt-in prompt alone. Plan 2 replaces this body so that a danger-sign message like the one
  // below escalates instead.
  it('returns null for a person who has not consented yet, even for danger-sign language', async () => {
    const service = new MessageRouterService();

    await expect(
      service.route({ person: buildPerson(false), channelVerified: true }, 'I have heavy bleeding'),
    ).resolves.toBeNull();
  });

  // The verification seam (docs/DECISIONS.md #28): consent alone is not enough. A consented
  // person messaging from a handset that has never been proven to be hers gets nothing back
  // from the router either — in Plan 2 that same message would still escalate on a danger sign,
  // because the matcher runs ahead of both checks.
  it('returns null for a consented person whose handset is not verified', async () => {
    const service = new MessageRouterService();

    await expect(
      service.route({ person: buildPerson(true), channelVerified: false }, 'When is my next appointment?'),
    ).resolves.toBeNull();
  });
});
