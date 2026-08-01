import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Risk assessment endpoints (e2e)', () => {
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

  it('rejects a manual risk-assessment trigger with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments')
      .expect(401);
  });

  it('rejects risk-assessment history listing with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments')
      .expect(401);
  });

  it('rejects fetching the latest risk assessment with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments/latest')
      .expect(401);
  });

  it('rejects a risk-assessment override with no auth token', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/risk-assessments/11111111-1111-1111-1111-111111111111/override')
      .send({ finalRiskBand: 'low', overrideReason: 'test' })
      .expect(401);
  });
});
