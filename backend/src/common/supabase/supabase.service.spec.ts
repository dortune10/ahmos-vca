import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [SupabaseService],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('getClientForUser attaches the given JWT as the Authorization header', () => {
    const client = service.getClientForUser('user-jwt-token');
    // supabase-js exposes the configured global headers on the client instance;
    // simplest black-box check is that a fresh call each time returns a client
    // whose auth header carries the token we passed in.
    // NOTE: the plan's original assertion checked `client.rest.headers['Authorization']`,
    // but @supabase/supabase-js v2.111.0's `rest.headers` is a Fetch API `Headers`
    // instance (no bracket access) — `client.headers` is the plain object that still
    // supports it, so the assertion was updated to match the installed version's actual
    // shape while testing the same behavior.
    expect((client as any).headers['Authorization']).toBe('Bearer user-jwt-token');
  });

  it('getServiceClient uses the service role key, not the anon key', () => {
    const client = service.getServiceClient();
    // NOTE: the plan's original assertion checked `client.rest.headers['apikey']`, but in
    // v2.111.0 the apikey header is injected per-request by an internal fetch wrapper, not
    // stored statically on the client — `client.supabaseKey` is the reliable place to
    // verify which key the client was constructed with.
    expect((client as any).supabaseKey).toBe('service-role-key');
  });
});
