import { createBrowserClient } from '@supabase/ssr';
import { createClient } from './client';

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn().mockReturnValue({ mocked: 'browser-client' }),
}));

const mockedCreateBrowserClient = createBrowserClient as jest.MockedFunction<
  typeof createBrowserClient
>;

describe('supabase browser client factory', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    mockedCreateBrowserClient.mockClear();
  });

  it('calls createBrowserClient with the public Supabase env vars', () => {
    const client = createClient();

    expect(mockedCreateBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
    );
    expect(client).toEqual({ mocked: 'browser-client' });
  });
});
