import { createClient } from './supabase/client';

export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown[];
  correlationId: string;
}

export class ApiError extends Error {
  code: string;
  details: unknown[];
  correlationId: string;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.details = body.details;
    this.correlationId = body.correlationId;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1${path}`,
    {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    },
  );

  const rawBody = await response.text();
  const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;

  if (!response.ok) {
    const errorBody: ApiErrorBody = parsedBody?.error ?? {
      code: 'UNKNOWN_ERROR',
      message: response.statusText || 'Request failed',
      details: [],
      correlationId: response.headers.get('X-Correlation-Id') ?? '',
    };
    throw new ApiError(errorBody);
  }

  return parsedBody as T;
}
