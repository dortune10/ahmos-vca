import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthGuard } from '../src/common/auth/auth.guard';
import { ReferralService } from '../src/referral/referral.service';
import { InvalidReferralStateError } from '../src/referral/referral-state-machine';

describe('ReferralController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects referral creation with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/referrals')
      .send({
        pregnancyEpisodeId: '11111111-1111-1111-1111-111111111111',
        toFacilityId: '11111111-1111-1111-1111-111111111111',
        reasonCode: 'suspected_preeclampsia',
        urgency: 'urgent',
      })
      .expect(401);
  });

  it('rejects referral status update with no auth token', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/referrals/11111111-1111-1111-1111-111111111111/status')
      .send({ status: 'Sent' })
      .expect(401);
  });

  it('rejects referral listing with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/referrals?facilityId=11111111-1111-1111-1111-111111111111&direction=incoming')
      .expect(401);
  });
});

describe('ReferralController (e2e) — REFERRAL_INVALID_STATE contract', () => {
  let app: INestApplication;
  const fakeReferralService = { updateStatus: jest.fn() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.currentUser = { id: 'u1', tenantId: 't1', role: 'clinician', facilityId: 'f1', jwt: 'fake-jwt' };
          return true;
        },
      })
      .overrideProvider(ReferralService)
      .useValue(fakeReferralService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeReferralService.updateStatus.mockReset();
  });

  it('rejects Completed -> InTransit with HTTP 409 and the REFERRAL_INVALID_STATE contract', async () => {
    // Gherkin (docs/PRD.md "Invalid referral transition" scenario):
    //   Given a referral is in status Completed
    //   When a user attempts to change the status to InTransit
    //   Then the API shall reject the request with HTTP 409
    //   And return the error code REFERRAL_INVALID_STATE
    const referralId = '22222222-2222-2222-2222-222222222222';
    fakeReferralService.updateStatus.mockRejectedValue(
      new InvalidReferralStateError('Completed', 'InTransit'),
    );

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/referrals/${referralId}/status`)
      .send({ status: 'InTransit' })
      .expect(409);

    expect(response.body.error.code).toBe('REFERRAL_INVALID_STATE');
    expect(response.body.error.message).toBe(
      'Referral cannot transition from Completed to InTransit',
    );
    expect(response.body.error.details).toEqual([]);
    expect(typeof response.body.error.correlationId).toBe('string');
    expect(response.body.error.correlationId.length).toBeGreaterThan(0);
  });
});
