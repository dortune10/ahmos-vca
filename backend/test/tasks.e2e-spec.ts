import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('TasksController (e2e)', () => {
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

  it('rejects listing tasks with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
  });

  it('rejects completing a task with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/tasks/11111111-1111-1111-1111-111111111111/complete')
      .expect(401);
  });
});
