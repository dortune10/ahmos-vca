import { apiFetch, ApiError } from './api-client';
import { createClient } from './supabase/client';

jest.mock('./supabase/client');

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

function mockSession(accessToken: string | null) {
  mockedCreateClient.mockReturnValue({
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: accessToken ? { access_token: accessToken } : null },
      }),
    },
  } as any);
}

describe('apiFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('attaches the Authorization header from the current session and calls the versioned API path', async () => {
    mockSession('token-123');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ id: 'e1' }),
    });
    global.fetch = fetchMock as any;

    const result = await apiFetch<{ id: string }>('/pregnancy-episodes/e1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/pregnancy-episodes/e1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
    expect(result).toEqual({ id: 'e1' });
  });

  it('JSON-encodes the body and uses the given method when options are provided', async () => {
    mockSession('token-123');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      text: async () => JSON.stringify({ id: 'p1' }),
    });
    global.fetch = fetchMock as any;

    await apiFetch('/persons', { method: 'POST', body: { firstName: 'Amina' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/persons',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ firstName: 'Amina' }),
      }),
    );
  });

  it('omits the Authorization header when there is no active session', async () => {
    mockSession(null);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify([]),
    });
    global.fetch = fetchMock as any;

    await apiFetch('/pregnancy-episodes');

    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeUndefined();
  });

  it('throws ApiError parsed from the backend error shape on a non-2xx response', async () => {
    mockSession('token-123');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          error: {
            code: 'EPISODE_NOT_FOUND',
            message: 'Pregnancy episode e1 not found',
            details: [],
            correlationId: 'corr-1',
          },
        }),
    });
    global.fetch = fetchMock as any;

    await expect(apiFetch('/pregnancy-episodes/e1')).rejects.toThrow(ApiError);

    let caught: unknown;
    try {
      await apiFetch('/pregnancy-episodes/e1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.code).toBe('EPISODE_NOT_FOUND');
    expect(apiError.message).toBe('Pregnancy episode e1 not found');
    expect(apiError.correlationId).toBe('corr-1');
  });
});
