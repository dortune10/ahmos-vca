import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
// Namespace import, matching all five existing RLS e2e specs in backend/test/. The
// default-import rule in Global Constraints applies to `supertest` only.
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AuthGuard } from '../src/common/auth/auth.guard';

describe('POST /persons/:id/whatsapp-enrolment-code (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects enrolment-code issuance with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/persons/11111111-1111-1111-1111-111111111111/whatsapp-enrolment-code')
      .expect(401);
  });
});

describe('POST /persons/:id/whatsapp-enrolment-code (e2e) — role and tenant scoping', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';

  let app: INestApplication;
  let chwId: string;
  let chwJwt: string;
  let personAId: string;
  let personBId: string;
  let currentRole = 'chw';

  beforeAll(async () => {
    const { data: authUser } = await admin.auth.admin.createUser({
      email: `enrolment-code-chw-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    chwId = authUser.user!.id;
    await admin.from('app_user').insert({
      id: chwId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'chw',
      facility_id: null,
      full_name: 'Enrolment Code E2E CHW',
    });

    // A REAL, RLS-usable token, minted the same way every existing RLS e2e spec in this repo
    // does. It matters here: issueWhatsAppEnrolmentCode does its tenant authorization by reading
    // `person` through the CALLER'S jwt, so a token Postgres cannot resolve to an auth.uid()
    // would make person_tenant_isolation deny everything and turn the "own tenant" test into a
    // false 404 instead of a real pass.
    chwJwt = jwt.sign(
      { sub: chwId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
      process.env.SUPABASE_JWT_SECRET as string,
      { expiresIn: '1h' },
    );

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Enrolment Code E2E A', phone_primary: '+254700009501' })
      .select()
      .single();
    personAId = personA!.id;

    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Enrolment Code E2E B', phone_primary: '+254700009502' })
      .select()
      .single();
    personBId = personB!.id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.currentUser = {
            id: chwId,
            tenantId: tenantA,
            role: currentRole,
            facilityId: null,
            jwt: chwJwt,
          };
          return true;
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await admin.from('whatsapp_enrolment_code').delete().in('person_id', [personAId, personBId]);
    await admin.from('person').delete().in('id', [personAId, personBId]);
    await admin.from('app_user').delete().eq('id', chwId);
    await admin.auth.admin.deleteUser(chwId);
    await app.close();
  });

  beforeEach(() => {
    currentRole = 'chw';
  });

  it('issues a six-digit code to a CHW for a person in their own tenant', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/persons/${personAId}/whatsapp-enrolment-code`)
      .expect(201);

    expect(response.body.code).toMatch(/^[0-9]{6}$/);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { data: rows } = await admin
      .from('whatsapp_enrolment_code')
      .select('code_hash, attempts_remaining, issued_by')
      .eq('person_id', personAId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0].attempts_remaining).toBe(5);
    expect(rows?.[0].issued_by).toBe(chwId);
    // Only the hash is stored.
    expect(rows?.[0].code_hash).not.toContain(response.body.code);
  });

  it('replaces the previous open code rather than leaving two live credentials', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/persons/${personAId}/whatsapp-enrolment-code`)
      .expect(201);

    const { data: rows } = await admin
      .from('whatsapp_enrolment_code')
      .select('id')
      .eq('person_id', personAId)
      .is('consumed_at', null);
    expect(rows).toHaveLength(1);
  });

  // The tenant boundary is enforced by RLS on the caller's own client, not by an if-statement.
  it('404s for a person in another tenant', () => {
    return request(app.getHttpServer())
      .post(`/api/v1/persons/${personBId}/whatsapp-enrolment-code`)
      .expect(404);
  });

  it('403s for a role with no patient-contact duties', () => {
    currentRole = 'supervisor';
    return request(app.getHttpServer())
      .post(`/api/v1/persons/${personAId}/whatsapp-enrolment-code`)
      .expect(403);
  });
});
