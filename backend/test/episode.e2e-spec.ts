import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('EpisodeController (e2e)', () => {
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

  it('rejects episode creation with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/pregnancy-episodes')
      .send({ personId: '11111111-1111-1111-1111-111111111111', facilityId: '11111111-1111-1111-1111-111111111111' })
      .expect(401);
  });

  it('rejects episode listing with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/pregnancy-episodes').expect(401);
  });
});
