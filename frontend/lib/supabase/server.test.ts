import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from './server';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn().mockReturnValue({ mocked: 'server-client' }),
}));
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

const mockedCreateServerClient = createServerClient as jest.MockedFunction<
  typeof createServerClient
>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;

describe('supabase server client factory', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    mockedCreateServerClient.mockClear();
    mockedCookies.mockResolvedValue({
      getAll: () => [{ name: 'sb-token', value: 'abc' }],
      set: jest.fn(),
    } as any);
  });

  it('calls createServerClient with the public env vars and a cookies adapter', async () => {
    const client = await createClient();

    expect(mockedCreateServerClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      }),
    );
    expect(client).toEqual({ mocked: 'server-client' });
  });

  it("the cookies adapter's getAll delegates to Next's cookie store", async () => {
    await createClient();
    const passedCookies = mockedCreateServerClient.mock.calls[0][2]!.cookies as any;

    expect(passedCookies.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
  });
});
