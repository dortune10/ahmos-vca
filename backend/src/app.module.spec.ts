import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from './app.module';

describe('AppModule event emitter wiring', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'service-role-key';
  });

  it('provides an injectable EventEmitter2', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const emitter = module.get(EventEmitter2);
    expect(emitter).toBeInstanceOf(EventEmitter2);
  });
});
