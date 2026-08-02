import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;

function tokenFor(userId: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('ReportingController (e2e)', () => {
  let app: INestApplication;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const tenantId = randomUUID();
  let facilityId: string;
  let supervisorToken: string;
  let chwToken: string;
  let breachingReferralId: string;

  beforeAll(async () => {
    // This suite seeds ~20 sequential rows (facility, 2 auth users + app_user rows, person,
    // 5 episodes, 5 care_task rows, 4 referrals) against the shared hosted Supabase project
    // per this plan's Global Constraints ("Why this plan's e2e test scopes everything to a
    // freshly created facility") — comfortably exceeds Jest's default 5s hook timeout.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Reporting Test Clinic', type: 'clinic' })
      .select()
      .single();
    facilityId = facility!.id;

    const { data: supervisorAuth } = await admin.auth.admin.createUser({
      email: `supervisor-reporting-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    supervisorToken = tokenFor(supervisorAuth.user!.id);
    await admin.from('app_user').insert({
      id: supervisorAuth.user!.id,
      tenant_id: tenantId,
      email: supervisorAuth.user!.email,
      role: 'supervisor',
      facility_id: null,
      full_name: 'Test Supervisor',
    });

    const { data: chwAuth } = await admin.auth.admin.createUser({
      email: `chw-reporting-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    chwToken = tokenFor(chwAuth.user!.id);
    await admin.from('app_user').insert({
      id: chwAuth.user!.id,
      tenant_id: tenantId,
      email: chwAuth.user!.email,
      role: 'chw',
      facility_id: facilityId,
      full_name: 'Test CHW',
    });

    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Reporting', phone_primary: `+254700${Date.now()}` })
      .select()
      .single();

    // 5 episodes at this facility: 2 low, 1 medium, 1 high, 1 not-yet-assessed (null) —
    // registeredPregnancies=5, highRiskCaseCount=1, riskBandDistribution excludes the null.
    const riskBands: (string | null)[] = ['low', 'low', 'medium', 'high', null];
    const episodeIds: string[] = [];
    for (const riskBand of riskBands) {
      const { data: episode } = await admin
        .from('pregnancy_episode')
        .insert({ person_id: person!.id, facility_id: facilityId, status: 'Active', risk_band: riskBand })
        .select()
        .single();
      episodeIds.push(episode!.id);
    }

    // 4 anc_visit care_task rows against the first 4 episodes, 3 completed => rate = 0.75.
    const taskCompletionFlags = [true, true, true, false];
    for (let i = 0; i < taskCompletionFlags.length; i++) {
      await admin.from('care_task').insert({
        pregnancy_episode_id: episodeIds[i],
        task_type: 'anc_visit',
        due_at: new Date().toISOString(),
        status: taskCompletionFlags[i] ? 'Completed' : 'Scheduled',
        completed_at: taskCompletionFlags[i] ? new Date().toISOString() : null,
      });
    }
    // A completed pnc_visit task must NOT count toward the anc_visit rate — proves the
    // task_type filter is applied, not just "any completed task."
    await admin.from('care_task').insert({
      pregnancy_episode_id: episodeIds[0],
      task_type: 'pnc_visit',
      due_at: new Date().toISOString(),
      status: 'Completed',
      completed_at: new Date().toISOString(),
    });

    // Referrals: one open referral created 48h ago (a breach — proves the time threshold
    // is applied), one open referral created just now (not a breach — proves "open" alone
    // isn't sufficient), and one of each terminal status.
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: breachingReferral } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeIds[0],
        to_facility_id: facilityId,
        reason_code: 'high_risk_pregnancy',
        urgency: 'urgent',
        status: 'Sent',
        created_at: fortyEightHoursAgo,
      })
      .select()
      .single();
    breachingReferralId = breachingReferral!.id;

    await admin.from('referral').insert({
      pregnancy_episode_id: episodeIds[1],
      to_facility_id: facilityId,
      reason_code: 'routine_check',
      urgency: 'routine',
      status: 'Created',
    });

    for (const status of ['Completed', 'Failed', 'Cancelled']) {
      await admin.from('referral').insert({
        pregnancy_episode_id: episodeIds[2],
        to_facility_id: facilityId,
        reason_code: 'routine_check',
        urgency: 'routine',
        status,
        closed_at: new Date().toISOString(),
      });
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/reports/kpi-summary').expect(401);
  });

  it('rejects a chw calling the reports endpoints (supervisor/admin only)', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/reports/kpi-summary?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${chwToken}`)
      .expect(403);
  });

  it('returns exact KPI aggregate counts scoped to the seeded facility', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/kpi-summary?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(response.body).toEqual({
      registeredPregnancies: 5,
      highRiskCaseCount: 1,
      riskBandDistribution: { low: 2, medium: 1, high: 1 },
      ancTaskCompletionRate: 0.75,
      referralSlaBreaches: 1,
      referralOutcomeBreakdown: { completed: 1, failed: 1, cancelled: 1 },
    });
  });

  it('returns only the breaching referral in the SLA-breach detail list', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/sla-breaches?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(breachingReferralId);
    expect(response.body[0].status).toBe('Sent');
  });
});
