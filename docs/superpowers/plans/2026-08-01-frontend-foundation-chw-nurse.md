# Frontend Foundation + CHW/Nurse Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `frontend/` Next.js application — Supabase auth wiring, an API
client against the NestJS backend, a small set of hand-rolled shared UI primitives, and the
shared `(dashboards)` shell with role-based routing — and build the first real dashboard on
top of it: the CHW/Nurse `/frontline` shared shell (design spec Section 3, Core User Flow
#1). Every piece of infrastructure in Tasks 1–7 is deliberately built as a fixed, reusable
contract: Plan 6 (Clinician), Plan 7 (Supervisor), and Plan 8 (Admin) all build their own
dashboards directly on top of it without re-deriving any of it.

**Architecture:** Single Next.js 14+ App Router application. Route groups separate the
public auth flow, `(auth)/login`, from the authenticated staff shell, `(dashboards)/*`. One
shared server-rendered layout (`(dashboards)/layout.tsx`) resolves the caller's session and
`app_user` row once, enforces role-based route access, and hands the resolved user down to
every nested Client Component via React context — no page re-fetches "who am I" on its own.
All domain data (episodes, tasks, persons) is read/written through the NestJS backend built
in Plans 1–2 via a single typed `apiFetch` helper; the frontend never calls
`@supabase/supabase-js` directly for anything except the Supabase Auth session itself
(sign-in, sign-out, and reading the access token `apiFetch` attaches) and, server-side only,
reading the caller's own `app_user` row (`id`, `tenant_id`, `role`, `facility_id`,
`full_name`, `email`) — a policy-scoped read Supabase's own RLS already allows via the
`app_user_self_and_tenant_admins` policy (Plan 1, Task 4), so there is deliberately no
backend `GET /api/v1/me` endpoint to build or call for this.

**Tech Stack:** Node.js 20 LTS, Next.js 14.x (App Router), React 18, TypeScript 5.x,
Tailwind CSS 3.x, `@supabase/supabase-js` v2, `@supabase/ssr`, Jest + React Testing Library
via the `next/jest` preset. Package manager: npm.

## Global Constraints

These are the fixed frontend conventions this plan establishes. Plan 6, Plan 7, and Plan 8
build directly against this exact contract — do not rename exports, move files, or change
prop shapes described here without updating this section and flagging it to whoever is
executing the other plans.

- **Location.** `frontend/` at the repo root, sibling to `backend/` and `supabase/` (Plan 1's
  Global Constraints already anticipated this).
- **Import alias.** `@/*` resolves to the `frontend/` directory root (the `create-next-app`
  TypeScript default, configured in `frontend/tsconfig.json`'s `paths`). Every cross-cutting
  import (`lib/`, `components/`) in this plan uses the alias, never a relative `../../../`
  chain — this matters more here than in the backend plans because App Router route
  nesting gets deep fast (see Task 11's five-segment dynamic route).
- **File naming.** Files under `lib/` and `components/` use kebab-case filenames
  (`api-client.ts`, `current-user-provider.tsx`, `ui/button.tsx`); exported symbols use
  PascalCase for components/types (`Button`, `AppUser`) and camelCase for functions/hooks
  (`apiFetch`, `useCurrentUser`). Route files follow Next.js's own required naming
  (`page.tsx`, `layout.tsx`, `middleware.ts`).
- **Test naming.** Frontend tests use the `*.test.ts` / `*.test.tsx` suffix (not `*.spec.*`
  — that suffix stays a backend-only convention from Plan 1/2), colocated next to the file
  they test, run via `cd frontend && npm test -- <path>`.
- **No component library.** Tailwind CSS utility classes only. A small set of hand-rolled
  primitives lives under `frontend/components/ui/` (`Button`, `Input`, `Card`, `Table` —
  built in Task 4). They are thin wrappers over standard semantic HTML forwarding standard
  HTML attributes (`Button`: `type`, `onClick`, `disabled`, `children`, plus an optional
  `variant`; `Input`: `label`, `value`, `onChange`, `type`, `placeholder`, `required`, plus
  an optional `error`; `Card`: `children`, plus an optional `className`; `Table`: `children`,
  rendering a native `<table>` — callers author their own `<thead>`/`<tbody>` markup inside
  it, the same pattern every later dashboard plan uses). No shared `lib/types/` DTO module —
  each page defines its own local TypeScript interface matching the exact backend response
  shape documented in Plan 2's Handoff section (`EpisodeResponseDto`, `CareTaskResponseDto`,
  etc.); this avoids a shared types module that every dashboard plan would otherwise need to
  independently keep in sync with backend DTOs it doesn't fully use.
- **Auth.** `@supabase/ssr`, not plain `@supabase/supabase-js`, for both the browser and
  server Supabase clients, so the Auth session is kept in sync via cookies across
  server-rendered navigations without any custom cookie-parsing code:
  - `frontend/lib/supabase/client.ts` — `export function createClient(): SupabaseClient`
    using `createBrowserClient`. Used by the login page and by `apiFetch`.
  - `frontend/lib/supabase/server.ts` — `export async function createClient(): Promise<SupabaseClient>`
    using `createServerClient` and Next's `cookies()` API. Used only by
    `frontend/lib/current-user.ts` (Task 5) — no other file in this plan reads cookies
    directly.
- **API client.** `frontend/lib/api-client.ts` exports:
  - `async function apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>`
    — reads the current session via the *browser* Supabase client, attaches
    `Authorization: Bearer <access_token>` when a session exists, calls
    `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1${path}`, JSON-encodes `options.body` when
    present, JSON-decodes the response, and throws `ApiError` on any non-2xx response.
  - `class ApiError extends Error` with `.code`, `.details`, `.correlationId` fields parsed
    from the backend's `{ "error": { "code", "message", "details", "correlationId" } }` shape
    (Plan 1's Global Constraints).
  - Every page in Tasks 8–11 imports both from `@/lib/api-client` and mocks that module in
    its tests (`jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { ... } }))`)
    — never mocks `fetch` or Supabase directly. `apiFetch`'s own test (Task 3) is the one
    place that mocks `fetch` and the browser Supabase client directly, because it's the thing
    proving that plumbing actually works.
- **Environment variables.** `frontend/.env.example` (Task 1) declares
  `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` —
  all three are safe to expose client-side (anon key + public URLs only, no service-role key
  ever reaches the frontend).
- **Route structure.**
  ```
  frontend/app/(auth)/login/page.tsx        — shared login page, all roles
  frontend/app/page.tsx                     — root: resolve session, redirect by role
  frontend/app/(dashboards)/layout.tsx      — shared shell: session guard, role routing, nav
  frontend/app/(dashboards)/frontline/...   — CHW/Nurse dashboard (this plan)
  frontend/app/(dashboards)/clinician/...   — Plan 6, not built here
  frontend/app/(dashboards)/supervisor/...  — Plan 7, not built here
  frontend/app/(dashboards)/admin/...       — Plan 8, not built here
  ```
  `(dashboards)/layout.tsx` exports `ROLE_HOME_ROUTE: Record<string, string>` (Task 7) —
  the single extension point later plans add their role's entry to. This plan's version
  intentionally has no `admin` key; Plan 8 adds it.
- **Known limitation, flagged not hidden (full reasoning in Task 8):** `EpisodeResponseDto`
  (Plan 2) carries `personId` but not the person's name, and the identity API (Plan 1,
  Task 9) only supports `GET /api/v1/persons?phone=<phone>` — there is no by-id or batch
  lookup endpoint. The caseload table in this plan therefore cannot join to a display name
  at all (not just inefficiently — it is not currently possible with the existing API
  surface) and shows a short person reference instead. This is an accepted MVP gap, not a
  workaround to silently ship as if it were a name.
- **Testing scope.** Jest + React Testing Library (`render`/`screen`/`fireEvent`/`waitFor`)
  via `next/jest`, colocated component/page tests only. No Playwright/e2e in this plan —
  the design spec's Testing Strategy section (Section 7) explicitly scopes end-to-end golden
  paths as later work, and this plan's own async Server Components (`app/page.tsx`,
  `(dashboards)/layout.tsx`'s default export, `middleware.ts`) that call `redirect()`,
  `headers()`, and `cookies()` are consequently **not** unit-tested directly — RTL has no
  supported way to render an App Router async Server Component with real `redirect()`
  short-circuiting without reimplementing Next's request lifecycle. Where this plan can
  extract the actual decision logic into a plain, framework-free function (`resolveRedirectForRole`
  in Task 7), it does, and that function is fully unit-tested. This mirrors Plan 1/2's own
  practice of naming a real testing gap rather than quietly working around it.
- Do not run `git commit`, `npm install`, or `npx create-next-app` for real while writing
  this plan — Steps below describe them as they will be run at execution time, matching
  Plan 1's precedent for `nest new`.

---

### Task 1: Next.js project scaffold + Jest/RTL test harness

**Files:**
- Create: `frontend/` (via `create-next-app`)
- Create: `frontend/jest.config.js`
- Create: `frontend/jest.setup.js`
- Modify: `frontend/app/page.tsx` (placeholder — replaced in Task 7)
- Create: `frontend/app/page.test.tsx` (placeholder — deleted in Task 7)
- Create: `frontend/.env.example`
- Modify: repo root `.gitignore` (add `frontend/.next/`, `frontend/node_modules/` if not
  already covered by existing patterns — read it first, don't replace it)

**Interfaces:**
- Produces: a booting Next.js app and a working `npm test` command every later task's tests
  run under.

- [ ] **Step 1: Scaffold the Next.js project**

Run:
```bash
cd /Users/dot/Documents/Projects/VCA-Health
npx create-next-app@14 frontend --typescript --tailwind --eslint --app --use-npm --import-alias "@/*"
```
When prompted interactively, choose: **No** to `src/` directory (this plan uses
`frontend/app/`, `frontend/lib/`, `frontend/components/` directly under `frontend/`, matching
Plan 1's flat `backend/src/` precedent), **Yes** to App Router, `@/*` for the import alias.

- [ ] **Step 2: Install test dependencies**

Run:
```bash
cd frontend
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @types/jest
```

- [ ] **Step 3: Write the Jest config**

Create `frontend/jest.config.js`:
```javascript
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(customJestConfig);
```

Create `frontend/jest.setup.js`:
```javascript
import '@testing-library/jest-dom';
```

Add to `frontend/package.json` scripts:
```json
"test": "jest"
```

- [ ] **Step 4: Write the failing smoke test**

Replace `frontend/app/page.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import RootPage from './page';

describe('RootPage (placeholder)', () => {
  it('renders the platform name', () => {
    render(<RootPage />);
    expect(screen.getByText('AMHOS Staff Platform')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd frontend && npm test -- app/page.test.tsx`
Expected: FAIL — `create-next-app`'s default `app/page.tsx` doesn't render this text.

- [ ] **Step 6: Implement the placeholder root page**

Replace `frontend/app/page.tsx`:
```tsx
export default function RootPage() {
  return <p>AMHOS Staff Platform</p>;
}
```

Note: this is a deliberate placeholder proving the scaffold and test harness work end to
end, the same role Plan 1 Task 1's health-check endpoint played for the backend. Task 7
below replaces this file with the real session-aware redirect logic and retires this test —
see that task's write-up for why the replacement isn't unit-tested the same way.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npm test -- app/page.test.tsx`
Expected: PASS

- [ ] **Step 8: Write `.env.example`**

Create `frontend/.env.example`:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 9: Update `.gitignore`**

Read the repo-root `.gitignore` first. If `node_modules/` and `.env*` patterns already exist
generically (they do, per Plan 1 Task 1), only append:
```
frontend/.next/
```

- [ ] **Step 10: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/ .gitignore
git commit -m "feat: scaffold Next.js frontend with Jest/RTL test harness"
```

---

### Task 2: Supabase client factories (browser + server)

**Files:**
- Create: `frontend/lib/supabase/client.ts`
- Create: `frontend/lib/supabase/client.test.ts`
- Create: `frontend/lib/supabase/server.ts`
- Create: `frontend/lib/supabase/server.test.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.
- Produces: `createClient(): SupabaseClient` (browser, `@/lib/supabase/client`) and
  `async createClient(): Promise<SupabaseClient>` (server, `@/lib/supabase/server`) — every
  later task that needs a Supabase session imports one of these two, never constructs a
  client with `@supabase/supabase-js` directly.

- [ ] **Step 1: Install dependencies**

Run: `cd frontend && npm install @supabase/supabase-js @supabase/ssr`

- [ ] **Step 2: Write the failing test for the browser client**

Create `frontend/lib/supabase/client.test.ts`:
```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- lib/supabase/client.test.ts`
Expected: FAIL — cannot find module `./client`

- [ ] **Step 4: Implement the browser client factory**

Create `frontend/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- lib/supabase/client.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for the server client**

Create `frontend/lib/supabase/server.test.ts`:
```typescript
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
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test -- lib/supabase/server.test.ts`
Expected: FAIL — cannot find module `./server`

- [ ] **Step 8: Implement the server client factory**

Create `frontend/lib/supabase/server.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component with no response to attach cookies to (e.g.
            // during static rendering). Safe to ignore here because middleware.ts (Task 7)
            // refreshes the session cookie on every real navigation anyway — this path only
            // matters for session *renewal*, not for reading the current session, which
            // still works fine from the request's existing cookies.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm test -- lib/supabase/server.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/lib/supabase/ frontend/package.json frontend/package-lock.json
git commit -m "feat: add Supabase browser and server client factories"
```

---

### Task 3: API client — `apiFetch` and `ApiError`

**Files:**
- Create: `frontend/lib/api-client.ts`
- Create: `frontend/lib/api-client.test.ts`

**Interfaces:**
- Consumes: `createClient` (browser, Task 2), `NEXT_PUBLIC_API_BASE_URL` env var, the
  backend's `{ "error": { "code", "message", "details", "correlationId" } }` shape (Plan 1
  Global Constraints).
- Produces: `apiFetch<T>(path, options?): Promise<T>` and `ApiError` — the single call
  surface every dashboard page (this plan's Tasks 8–11, and Plans 6–8) uses to reach the
  NestJS backend.

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/api-client.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- lib/api-client.test.ts`
Expected: FAIL — cannot find module `./api-client`

- [ ] **Step 3: Implement `apiFetch` and `ApiError`**

Create `frontend/lib/api-client.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- lib/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/lib/api-client.ts frontend/lib/api-client.test.ts
git commit -m "feat: add typed apiFetch client with ApiError"
```

---

### Task 4: Shared UI primitives — `Button`, `Input`, `Card`, `Table`

**Files:**
- Create: `frontend/components/ui/button.tsx`
- Create: `frontend/components/ui/button.test.tsx`
- Create: `frontend/components/ui/input.tsx`
- Create: `frontend/components/ui/input.test.tsx`
- Create: `frontend/components/ui/card.tsx`
- Create: `frontend/components/ui/card.test.tsx`
- Create: `frontend/components/ui/table.tsx`
- Create: `frontend/components/ui/table.test.tsx`

**Interfaces:**
- Produces: `Button`, `Input`, `Card`, `Table` from `@/components/ui/button`,
  `@/components/ui/input`, `@/components/ui/card`, `@/components/ui/table` respectively —
  the only presentational primitives this plan (and Plans 6–8) use. Exact prop shapes are
  fixed in this Global Constraints section; do not add required props later without
  updating every consumer.

- [ ] **Step 1: Write the failing `Button` test**

Create `frontend/components/ui/button.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders its children and calls onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Save</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies the secondary variant styling when variant="secondary"', () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('bg-white');
  });

  it('disables the button and its click handler when disabled', () => {
    const handleClick = jest.fn();
    render(
      <Button disabled onClick={handleClick}>
        Submit
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- components/ui/button.test.tsx`
Expected: FAIL — cannot find module `./button`

- [ ] **Step 3: Implement `Button`**

Create `frontend/components/ui/button.tsx`:
```tsx
'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- components/ui/button.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `Input` test**

Create `frontend/components/ui/input.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
  it('associates the label with the input via htmlFor/id and reports changes', () => {
    const handleChange = jest.fn();
    render(<Input label="First name" value="" onChange={handleChange} />);

    const input = screen.getByLabelText('First name');
    fireEvent.change(input, { target: { value: 'Amina' } });

    expect(handleChange).toHaveBeenCalled();
  });

  it('renders an error message when error is provided', () => {
    render(<Input label="Phone" value="" onChange={() => {}} error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('forwards standard input attributes such as type and required', () => {
    render(<Input label="Password" type="password" required value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toBeRequired();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npm test -- components/ui/input.test.tsx`
Expected: FAIL — cannot find module `./input`

- [ ] **Step 7: Implement `Input`**

Create `frontend/components/ui/input.tsx`:
```tsx
'use client';

import { InputHTMLAttributes, useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, className = '', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={inputId}
        className={`rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none ${className}`}
        {...rest}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npm test -- components/ui/input.test.tsx`
Expected: PASS

- [ ] **Step 9: Write the failing `Card` test**

Create `frontend/components/ui/card.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { Card } from './card';

describe('Card', () => {
  it('renders its children inside a bordered container', () => {
    render(
      <Card>
        <p>Content</p>
      </Card>,
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd frontend && npm test -- components/ui/card.test.tsx`
Expected: FAIL — cannot find module `./card`

- [ ] **Step 11: Implement `Card`**

Create `frontend/components/ui/card.tsx`:
```tsx
import { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd frontend && npm test -- components/ui/card.test.tsx`
Expected: PASS

- [ ] **Step 13: Write the failing `Table` test**

Create `frontend/components/ui/table.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { Table } from './table';

describe('Table', () => {
  it('renders a native table element with the given thead/tbody children', () => {
    render(
      <Table>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Amina</td>
          </tr>
        </tbody>
      </Table>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Amina')).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `cd frontend && npm test -- components/ui/table.test.tsx`
Expected: FAIL — cannot find module `./table`

- [ ] **Step 15: Implement `Table`**

Create `frontend/components/ui/table.tsx`:
```tsx
import { TableHTMLAttributes, ReactNode } from 'react';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ children, className = '', ...rest }: TableProps) {
  return (
    <table className={`min-w-full divide-y divide-gray-200 ${className}`} {...rest}>
      {children}
    </table>
  );
}
```

- [ ] **Step 16: Run test to verify it passes**

Run: `cd frontend && npm test -- components/ui/table.test.tsx`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/components/ui/
git commit -m "feat: add Button, Input, Card, Table shared UI primitives"
```

---

### Task 5: Current-user infrastructure — `getCurrentAppUser` + `CurrentUserProvider`

**Files:**
- Create: `frontend/lib/current-user.ts`
- Create: `frontend/lib/current-user.test.ts`
- Create: `frontend/components/current-user-provider.tsx`
- Create: `frontend/components/current-user-provider.test.tsx`

**Interfaces:**
- Consumes: `createClient` (server, Task 2), the `app_user` table and its
  `app_user_self_and_tenant_admins` RLS policy (Plan 1, Tasks 3–4).
- Produces: `AppUser` type, `getCurrentAppUser(): Promise<AppUser | null>` (server-only —
  used by `(dashboards)/layout.tsx`, Task 7), and `CurrentUserProvider` /
  `useCurrentUser(): AppUser` (Client Component context — used by every page in Tasks 8–11
  to read the logged-in staff member's `id`, `role`, `facilityId` without re-fetching it).

- [ ] **Step 1: Write the failing test for `getCurrentAppUser`**

Create `frontend/lib/current-user.test.ts`:
```typescript
import { createClient } from '@/lib/supabase/server';
import { getCurrentAppUser } from './current-user';

jest.mock('@/lib/supabase/server');

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

function buildSupabaseMock(options: { hasSession: boolean; appUserRow?: Record<string, unknown> }) {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: options.hasSession ? { user: { id: 'u1' } } : null },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            options.appUserRow
              ? { data: options.appUserRow, error: null }
              : { data: null, error: { message: 'not found' } },
        }),
      }),
    }),
  } as any;
}

describe('getCurrentAppUser', () => {
  it('returns null when there is no active session', async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ hasSession: false }));

    const result = await getCurrentAppUser();

    expect(result).toBeNull();
  });

  it('returns the mapped AppUser when a session and app_user row both exist', async () => {
    mockedCreateClient.mockResolvedValue(
      buildSupabaseMock({
        hasSession: true,
        appUserRow: {
          id: 'u1',
          tenant_id: 't1',
          role: 'chw',
          facility_id: 'f1',
          full_name: 'Amina CHW',
          email: 'amina@example.com',
        },
      }),
    );

    const result = await getCurrentAppUser();

    expect(result).toEqual({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina CHW',
      email: 'amina@example.com',
    });
  });

  it('returns null when the session exists but no app_user row is found', async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ hasSession: true, appUserRow: undefined }));

    const result = await getCurrentAppUser();

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- lib/current-user.test.ts`
Expected: FAIL — cannot find module `./current-user`

- [ ] **Step 3: Implement `getCurrentAppUser`**

Create `frontend/lib/current-user.ts`:
```typescript
import { createClient } from '@/lib/supabase/server';

export interface AppUser {
  id: string;
  tenantId: string;
  role: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';
  facilityId: string | null;
  fullName: string;
  email: string;
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from('app_user')
    .select('id, tenant_id, role, facility_id, full_name, email')
    .eq('id', session.user.id)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    tenantId: data.tenant_id,
    role: data.role,
    facilityId: data.facility_id,
    fullName: data.full_name,
    email: data.email,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- lib/current-user.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `CurrentUserProvider`/`useCurrentUser`**

Create `frontend/components/current-user-provider.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { CurrentUserProvider, useCurrentUser } from './current-user-provider';
import type { AppUser } from '@/lib/current-user';

const SAMPLE_USER: AppUser = {
  id: 'u1',
  tenantId: 't1',
  role: 'chw',
  facilityId: 'f1',
  fullName: 'Amina CHW',
  email: 'amina@example.com',
};

function Consumer() {
  const user = useCurrentUser();
  return <p>{user.fullName}</p>;
}

describe('CurrentUserProvider / useCurrentUser', () => {
  it('provides the given user to descendants', () => {
    render(
      <CurrentUserProvider user={SAMPLE_USER}>
        <Consumer />
      </CurrentUserProvider>,
    );

    expect(screen.getByText('Amina CHW')).toBeInTheDocument();
  });

  it('throws a clear error when used outside a provider', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Consumer />)).toThrow(
      'useCurrentUser must be used within a CurrentUserProvider',
    );

    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npm test -- components/current-user-provider.test.tsx`
Expected: FAIL — cannot find module `./current-user-provider`

- [ ] **Step 7: Implement `CurrentUserProvider`/`useCurrentUser`**

Create `frontend/components/current-user-provider.tsx`:
```tsx
'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { AppUser } from '@/lib/current-user';

const CurrentUserContext = createContext<AppUser | null>(null);

export function CurrentUserProvider({
  user,
  children,
}: {
  user: AppUser;
  children: ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): AppUser {
  const user = useContext(CurrentUserContext);
  if (!user) {
    throw new Error('useCurrentUser must be used within a CurrentUserProvider');
  }
  return user;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npm test -- components/current-user-provider.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/lib/current-user.ts frontend/lib/current-user.test.ts frontend/components/current-user-provider.tsx frontend/components/current-user-provider.test.tsx
git commit -m "feat: add getCurrentAppUser and CurrentUserProvider/useCurrentUser"
```

---

### Task 6: Login page

**Files:**
- Create: `frontend/app/(auth)/login/page.tsx`
- Create: `frontend/app/(auth)/login/page.test.tsx`

**Interfaces:**
- Consumes: `createClient` (browser, Task 2).
- Produces: `/login` — the only public route besides the Next.js default 404. Every role
  signs in here; the redirect to a role-specific dashboard happens at `/` (Task 7), not here.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(auth)/login/page.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';
import { createClient } from '@/lib/supabase/client';

jest.mock('@/lib/supabase/client');

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('LoginPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  it('signs in with the entered credentials and redirects to / on success', async () => {
    const signInWithPassword = jest.fn().mockResolvedValue({ error: null });
    mockedCreateClient.mockReturnValue({ auth: { signInWithPassword } } as any);

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nurse@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'nurse@example.com',
      password: 'secret123',
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the error message and does not redirect on failed sign-in', async () => {
    const signInWithPassword = jest
      .fn()
      .mockResolvedValue({ error: { message: 'Invalid credentials' } });
    mockedCreateClient.mockReturnValue({ auth: { signInWithPassword } } as any);

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nurse@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(auth)/login/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the login page**

Create `frontend/app/(auth)/login/page.tsx`:
```tsx
'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    // router.refresh() forces the root layout's Server Component to re-read the
    // just-written session cookie on the next navigation rather than serving a cached RSC
    // payload from before sign-in — a well-known @supabase/ssr + App Router gotcha.
    router.push('/');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">AMHOS Staff Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(auth)/login/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(auth)/"
git commit -m "feat: add staff login page"
```

---

### Task 7: Shared dashboard shell — role routing, layout, nav, middleware

**Files:**
- Create: `frontend/app/(dashboards)/layout.tsx`
- Create: `frontend/app/(dashboards)/layout.test.ts`
- Create: `frontend/components/nav.tsx`
- Create: `frontend/components/nav.test.tsx`
- Create: `frontend/middleware.ts`
- Modify: `frontend/app/page.tsx` (replaces Task 1's placeholder)
- Delete: `frontend/app/page.test.tsx` (Task 1's placeholder test — see Step 7 below)

**Interfaces:**
- Consumes: `getCurrentAppUser` (Task 5), `CurrentUserProvider` (Task 5), `AppUser` (Task 5).
- Produces:
  - `ROLE_HOME_ROUTE: Record<string, string>` and `resolveRedirectForRole(pathname, role): string | null`,
    both exported from `frontend/app/(dashboards)/layout.tsx` — **this is the exact
    extension point Plan 6, Plan 7, and Plan 8 each add one entry to.** This plan's map has
    no `admin` key by design; Plan 8 adds it (confirmed against that plan's own Task 1).
  - `Nav` component (`@/components/nav`), rendering role-appropriate links.
  - The `(dashboards)` route group itself: any authenticated request lands inside a shell
    that resolves the caller's `AppUser` once and provides it via context to every nested
    page.

- [ ] **Step 1: Write the middleware**

Create `frontend/middleware.ts`:
```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Two jobs, both required for (dashboards)/layout.tsx below to work:
// 1. Forward the request pathname as a header, since Server Components (layout.tsx) have
//    no other built-in way to read the current URL path.
// 2. Refresh the Supabase session cookie on every navigation, the standard @supabase/ssr
//    middleware pattern — without this, a session nearing expiry could go stale between
//    server-rendered navigations.
export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

This file is not unit-tested — it is Edge middleware exercising real
`NextRequest`/`NextResponse` request-lifecycle behavior that Jest's jsdom environment
doesn't model, the same class of limitation as this plan's Global Constraints note for
`redirect()`/`headers()`/`cookies()`-based Server Components. Its one piece of pure logic
(setting `x-pathname`) is exercised indirectly by `resolveRedirectForRole`'s unit tests
below, which test the consumer of that header.

- [ ] **Step 2: Write the failing `Nav` test**

Create `frontend/components/nav.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { Nav } from './nav';
import type { AppUser } from '@/lib/current-user';

function buildUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 'u1',
    tenantId: 't1',
    role: 'chw',
    facilityId: 'f1',
    fullName: 'Amina',
    email: 'amina@example.com',
    ...overrides,
  };
}

describe('Nav', () => {
  it("shows the CHW's frontline links and not the admin link", () => {
    render(<Nav user={buildUser({ role: 'chw' })} />);

    expect(screen.getByRole('link', { name: 'Caseload' })).toHaveAttribute(
      'href',
      '/frontline',
    );
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the admin link and full name for an admin user', () => {
    render(<Nav user={buildUser({ role: 'admin', fullName: 'Admin User' })} />);

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByText('Admin User (admin)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: FAIL — cannot find module `./nav`

- [ ] **Step 4: Implement `Nav`**

Create `frontend/components/nav.tsx`:
```tsx
import Link from 'next/link';
import type { AppUser } from '@/lib/current-user';

const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  chw: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  nurse: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  clinician: [{ href: '/clinician', label: 'Triage Board' }],
  supervisor: [{ href: '/supervisor', label: 'KPIs' }],
  admin: [{ href: '/admin', label: 'Admin' }],
};

export function Nav({ user }: { user: AppUser }) {
  const links = NAV_LINKS_BY_ROLE[user.role] ?? [];

  return (
    <nav className="flex items-center justify-between border-b bg-white px-4 py-3">
      <div className="flex gap-4">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
      <span className="text-sm text-gray-500">
        {user.fullName} ({user.role})
      </span>
    </nav>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `resolveRedirectForRole`**

Create `frontend/app/(dashboards)/layout.test.ts`:
```typescript
// These mocks isolate the pure routing logic below from the Next.js/Supabase runtime code
// the same file also contains (the default-exported layout component uses headers(),
// redirect(), and getCurrentAppUser() — none of which this test exercises or needs). Nav
// is mocked too even though it's a real module by this point, to keep this test focused
// purely on the routing logic.
jest.mock('next/headers', () => ({ headers: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/current-user', () => ({ getCurrentAppUser: jest.fn() }));
jest.mock('@/components/current-user-provider', () => ({
  CurrentUserProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/components/nav', () => ({ Nav: () => null }));

import { ROLE_HOME_ROUTE, resolveRedirectForRole } from './layout';

describe('ROLE_HOME_ROUTE', () => {
  it('maps chw, nurse, clinician, and supervisor to their dashboard prefixes', () => {
    expect(ROLE_HOME_ROUTE).toEqual({
      chw: '/frontline',
      nurse: '/frontline',
      clinician: '/clinician',
      supervisor: '/supervisor',
    });
  });
});

describe('resolveRedirectForRole', () => {
  it('redirects a chw hitting a route outside /frontline back to /frontline', () => {
    expect(resolveRedirectForRole('/admin', 'chw')).toBe('/frontline');
  });

  it('redirects a nurse hitting the clinician dashboard back to /frontline', () => {
    expect(resolveRedirectForRole('/clinician', 'nurse')).toBe('/frontline');
  });

  it('does not redirect when the pathname is already inside the role home route', () => {
    expect(resolveRedirectForRole('/frontline/register', 'nurse')).toBeNull();
  });

  it('does not enforce a redirect for a role with no configured home route yet (e.g. admin, until Plan 8 adds one)', () => {
    expect(resolveRedirectForRole('/anything', 'admin')).toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/layout.test.ts"`
Expected: FAIL — cannot find module `./layout`

- [ ] **Step 8: Implement `(dashboards)/layout.tsx`**

Create `frontend/app/(dashboards)/layout.tsx`:
```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ReactNode } from 'react';
import { getCurrentAppUser } from '@/lib/current-user';
import { CurrentUserProvider } from '@/components/current-user-provider';
import { Nav } from '@/components/nav';

// Home route for each MVP role, per docs/DECISIONS.md #20 and the design spec's Section 3
// routing table. Plan 6 (Clinician), Plan 7 (Supervisor), and Plan 8 (Admin) each add their
// own one-line entry here when they build their dashboard — this map is the single
// extension point for "where does role X land after login." No `admin` entry yet by
// design; Plan 8 adds it.
export const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
};

// Pure, framework-free, and unit-tested directly (see layout.test.ts) — this is the actual
// decision logic; everything else in this file is Next.js plumbing around it.
export function resolveRedirectForRole(pathname: string, role: string): string | null {
  const homeRoute = ROLE_HOME_ROUTE[role];
  if (!homeRoute) {
    // Role with no configured home route yet (e.g. admin, until Plan 8 adds one): no
    // enforcement here. That role's own plan owns wiring its route in.
    return null;
  }
  return pathname.startsWith(homeRoute) ? null : homeRoute;
}

export default async function DashboardsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }

  const pathname = headers().get('x-pathname') ?? '';
  const redirectTo = resolveRedirectForRole(pathname, user.role);
  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <CurrentUserProvider user={user}>
      <div className="min-h-screen bg-gray-50">
        <Nav user={user} />
        <main className="mx-auto max-w-5xl p-4">{children}</main>
      </div>
    </CurrentUserProvider>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/layout.test.ts"`
Expected: PASS

- [ ] **Step 10: Replace the root page with the real redirect logic**

Replace `frontend/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/current-user';
import { ROLE_HOME_ROUTE } from './(dashboards)/layout';

export default async function RootPage() {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }
  redirect(ROLE_HOME_ROUTE[user.role] ?? '/login');
}
```

Importing `ROLE_HOME_ROUTE` from the `(dashboards)` layout module (rather than duplicating
the map here) is deliberate: it is a plain named export from a valid ES module, and keeping
one copy means Plan 6/7/8 adding their role's entry in one place automatically fixes both
the post-login redirect (here) and the cross-route enforcement
(`(dashboards)/layout.tsx`'s own use of `resolveRedirectForRole`).

Delete `frontend/app/page.test.tsx` (Task 1's placeholder test). Its subject, the static
"AMHOS Staff Platform" placeholder, no longer exists — this file is now an async Server
Component whose entire body is `getCurrentAppUser()` + `redirect()`, both already covered
by other tests (`getCurrentAppUser`'s own unit tests, Task 5; `ROLE_HOME_ROUTE`'s/
`resolveRedirectForRole`'s unit tests, Step 6 above) or by the documented Server Component
testing limitation in Global Constraints. There is no remaining logic in this file to test
in isolation.

- [ ] **Step 11: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/page.tsx frontend/middleware.ts "frontend/app/(dashboards)/layout.tsx" "frontend/app/(dashboards)/layout.test.ts" frontend/components/nav.tsx frontend/components/nav.test.tsx
git rm frontend/app/page.test.tsx
git commit -m "feat: add shared dashboard shell with role-based routing and nav"
```

---

### Task 8: Caseload list — `/frontline`

**Files:**
- Create: `frontend/app/(dashboards)/frontline/page.tsx`
- Create: `frontend/app/(dashboards)/frontline/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 3), `useCurrentUser` (Task 5), `Card`/`Table`
  (Task 4), `GET /api/v1/pregnancy-episodes?facilityId=<id>` returning
  `EpisodeResponseDto[]` (Plan 2 Handoff).
- Produces: the CHW/Nurse landing page — `ROLE_HOME_ROUTE`'s `chw`/`nurse` target.

**The person-name gap, decided and documented here (not silently worked around):**
`EpisodeResponseDto` (Plan 2) is `{ id, personId, facilityId, lmpDate,
estimatedDeliveryDate, gestationalAgeWeeks, riskBand, status, createdAt, updatedAt }` — it
carries `personId`, never a name. The identity API (Plan 1, Task 9) exposes exactly one
read path, `GET /api/v1/persons?phone=<phone>` — a search *by phone number*, which this
page does not have for any given episode. There is no `GET /api/v1/persons/:id` and no
batch lookup endpoint (`?ids=...`). This means the usual "accept an N+1 per-row lookup as
an MVP inefficiency" option isn't actually available here — it's not slow, it's
*impossible* with the current backend surface, since the one search key the API accepts
(phone) isn't present on the episode row at all.

Given that, this task's decision is: **display a short person reference derived from
`personId` (last 8 characters, prefixed `#`) instead of a name**, and call this out
in-code with a comment pointing back to this section, rather than inventing a fake join or
quietly showing a raw UUID with no explanation. The real fix — a `GET /api/v1/persons/:id`
or batch `GET /api/v1/persons?ids=...` endpoint — is backend work belonging to whichever
plan next touches the `identity` module; it is out of scope here because this plan does not
modify the backend at all (contrast with Plan 8, which does extend Plan 1's backend
modules). Flagging this explicitly rather than leaving it for someone to discover the API
gap independently.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/frontline/page.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import FrontlinePage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

describe('FrontlinePage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina',
      email: 'amina@example.com',
    });
  });

  it('loads and renders the caseload for the current facility', async () => {
    mockedApiFetch.mockResolvedValue([
      {
        id: 'e1',
        personId: 'person-1234567890',
        facilityId: 'f1',
        lmpDate: null,
        estimatedDeliveryDate: '2026-12-01',
        gestationalAgeWeeks: 20,
        riskBand: 'low',
        status: 'Active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    render(<FrontlinePage />);

    expect(screen.getByText('Loading caseload...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('#34567890')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes?facilityId=f1');
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('shows a message and never calls the API when the user has no facility assigned', async () => {
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'supervisor',
      facilityId: null,
      fullName: 'Sup',
      email: 'sup@example.com',
    });

    render(<FrontlinePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<FrontlinePage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the caseload page**

Create `frontend/app/(dashboards)/frontline/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function FrontlinePage() {
  const user = useCurrentUser();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.facilityId) {
      setLoading(false);
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    let cancelled = false;
    apiFetch<Episode[]>(`/pregnancy-episodes?facilityId=${user.facilityId}`)
      .then((data) => {
        if (!cancelled) setEpisodes(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load caseload.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user.facilityId]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Caseload</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading caseload...</p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>Risk band</th>
                <th>EDD</th>
              </tr>
            </thead>
            <tbody>
              {episodes.length === 0 && (
                <tr>
                  <td colSpan={4}>No episodes yet.</td>
                </tr>
              )}
              {episodes.map((episode) => (
                <tr key={episode.id}>
                  {/* KNOWN LIMITATION — see this task's write-up: EpisodeResponseDto only
                      carries personId, and the identity API has no by-id or batch lookup,
                      only GET /api/v1/persons?phone=. Showing a short reference instead of
                      a name until that endpoint exists. */}
                  <td>#{episode.personId.slice(-8)}</td>
                  <td>{episode.status}</td>
                  <td>{episode.riskBand ?? '—'}</td>
                  <td>{episode.estimatedDeliveryDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/frontline/page.tsx" "frontend/app/(dashboards)/frontline/page.test.tsx"
git commit -m "feat: add CHW/Nurse caseload list"
```

---

### Task 9: Quick registration form — role-aware (CHW minimal / Nurse full)

**Files:**
- Create: `frontend/app/(dashboards)/frontline/register/page.tsx`
- Create: `frontend/app/(dashboards)/frontline/register/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 3), `useCurrentUser` (Task 5), `Card`/`Input`/
  `Button` (Task 4), `POST /api/v1/persons` (`CreatePersonDto` → `PersonResponseDto`, Plan 1
  Task 9), `POST /api/v1/pregnancy-episodes` (`CreateEpisodeDto` → `EpisodeResponseDto`,
  Plan 2 Task 6).
- Produces: `/frontline/register` — the same two backend calls for both roles, different
  form field sets, per the design spec's Core Flow #1 and `docs/DECISIONS.md` #20. CHW:
  first name, phone. Nurse: first name, last name, phone, date of birth, LMP date. Facility
  is never a form field — it's always `user.facilityId`, matching the spec's "facility is
  fixed to their own facilityId" requirement.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/frontline/register/page.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

describe('RegisterPage as CHW', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina CHW',
      email: 'amina@example.com',
    });
  });

  it('shows only the minimal field set and no last name/DOB/LMP fields', () => {
    render(<RegisterPage />);

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last menstrual period date')).not.toBeInTheDocument();
  });

  it('creates a person then an episode against the CHW own facilityId, and navigates to the caseload', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ id: 'p1', tenantId: 't1', firstName: 'Zawadi', lastName: null, phonePrimary: '+254700000001', dateOfBirth: null })
      .mockResolvedValueOnce({ id: 'e1', personId: 'p1', facilityId: 'f1', status: 'Active' });

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Zawadi' } });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+254700000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/persons', {
      method: 'POST',
      body: { firstName: 'Zawadi', phonePrimary: '+254700000001' },
    });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/pregnancy-episodes', {
      method: 'POST',
      body: { personId: 'p1', facilityId: 'f1' },
    });
  });
});

describe('RegisterPage as Nurse', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u2',
      tenantId: 't1',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
      email: 'joy@example.com',
    });
  });

  it('shows the full field set including last name, date of birth, and LMP date', () => {
    render(<RegisterPage />);

    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.getByLabelText('Last menstrual period date')).toBeInTheDocument();
  });

  it('includes lastName, dateOfBirth, and lmpDate in the two API calls', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ id: 'p2', tenantId: 't1', firstName: 'Zawadi', lastName: 'Mrema', phonePrimary: '+254700000002', dateOfBirth: '1998-01-01' })
      .mockResolvedValueOnce({ id: 'e2', personId: 'p2', facilityId: 'f1', status: 'Active' });

    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Zawadi' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Mrema' } });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+254700000002' },
    });
    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '1998-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Last menstrual period date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(2));

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/persons', {
      method: 'POST',
      body: {
        firstName: 'Zawadi',
        lastName: 'Mrema',
        phonePrimary: '+254700000002',
        dateOfBirth: '1998-01-01',
      },
    });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/pregnancy-episodes', {
      method: 'POST',
      body: { personId: 'p2', facilityId: 'f1', lmpDate: '2026-06-01' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/register/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the registration page**

Create `frontend/app/(dashboards)/frontline/register/page.tsx`:
```tsx
'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PersonResponse {
  id: string;
}

export default function RegisterPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const isNurse = user.role === 'nurse';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [lmpDate, setLmpDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!user.facilityId) {
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const personBody: Record<string, string> = { firstName, phonePrimary: phone };
      if (isNurse) {
        if (lastName) personBody.lastName = lastName;
        if (dateOfBirth) personBody.dateOfBirth = dateOfBirth;
      }

      const person = await apiFetch<PersonResponse>('/persons', {
        method: 'POST',
        body: personBody,
      });

      const episodeBody: Record<string, string> = {
        personId: person.id,
        facilityId: user.facilityId,
      };
      if (isNurse && lmpDate) {
        episodeBody.lmpDate = lmpDate;
      }

      await apiFetch('/pregnancy-episodes', { method: 'POST', body: episodeBody });

      router.push('/frontline');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {isNurse ? 'Register Patient' : 'Quick Registration'}
      </h1>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          {isNurse && (
            <Input
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          )}
          <Input
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {isNurse && (
            <>
              <Input
                label="Date of birth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
              <Input
                label="Last menstrual period date"
                type="date"
                value={lmpDate}
                onChange={(e) => setLmpDate(e.target.value)}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Registering...' : 'Register'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/register/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/frontline/register/"
git commit -m "feat: add role-aware quick registration form for CHW/Nurse"
```

---

### Task 10: Visit checklist — `/frontline/tasks`

**Files:**
- Create: `frontend/app/(dashboards)/frontline/tasks/page.tsx`
- Create: `frontend/app/(dashboards)/frontline/tasks/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 3), `useCurrentUser` (Task 5), `Card`/`Table`/
  `Button` (Task 4), `GET /api/v1/tasks?assignedUserId=<id>` and
  `POST /api/v1/tasks/:id/complete` (`CareTaskResponseDto`, Plan 2 Task 4).
- Produces: `/frontline/tasks` — same page for both CHW and nurse (task assignment/
  completion is role-agnostic in the spec; nothing about "who can mark a visit done"
  differs by role).

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/frontline/tasks/page.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskListPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const SAMPLE_TASK = {
  id: 't1',
  pregnancyEpisodeId: 'e1',
  taskType: 'anc_visit',
  assignedUserId: 'u1',
  dueAt: '2026-08-15T00:00:00.000Z',
  completedAt: null,
  status: 'Scheduled',
  priority: 'routine',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('TaskListPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina',
      email: 'amina@example.com',
    });
  });

  it('loads and renders the tasks assigned to the current user', async () => {
    mockedApiFetch.mockResolvedValueOnce([SAMPLE_TASK]);

    render(<TaskListPage />);

    expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('anc_visit')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/tasks?assignedUserId=u1');
  });

  it('marks a task complete and reloads the list', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([SAMPLE_TASK])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ ...SAMPLE_TASK, status: 'Completed', completedAt: '2026-08-02T00:00:00.000Z' }]);

    render(<TaskListPage />);
    await waitFor(() => expect(screen.getByText('anc_visit')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(3));
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/tasks/t1/complete', { method: 'POST' });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(3, '/tasks?assignedUserId=u1');
  });

  it('shows a message when there are no tasks', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);

    render(<TaskListPage />);

    await waitFor(() => expect(screen.getByText('No tasks assigned.')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/tasks/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the task list page**

Create `frontend/app/(dashboards)/frontline/tasks/page.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface CareTask {
  id: string;
  pregnancyEpisodeId: string;
  taskType: string;
  assignedUserId: string | null;
  dueAt: string;
  completedAt: string | null;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export default function TaskListPage() {
  const user = useCurrentUser();
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CareTask[]>(`/tasks?assignedUserId=${user.id}`);
      setTasks(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleComplete(taskId: string) {
    setError(null);
    try {
      await apiFetch(`/tasks/${taskId}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Visit Checklist</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading tasks...</p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4}>No tasks assigned.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.taskType}</td>
                  <td>{new Date(task.dueAt).toLocaleDateString()}</td>
                  <td>{task.status}</td>
                  <td>
                    {task.status !== 'Completed' && (
                      <Button variant="secondary" onClick={() => handleComplete(task.id)}>
                        Mark complete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/tasks/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/frontline/tasks/"
git commit -m "feat: add visit checklist task list with completion"
```

---

### Task 11: Encounter note form

**Files:**
- Create: `frontend/app/(dashboards)/frontline/episodes/[id]/encounter-note/page.tsx`
- Create: `frontend/app/(dashboards)/frontline/episodes/[id]/encounter-note/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 3), `useCurrentUser` (Task 5), `Card`/`Input`/
  `Button` (Task 4), `POST /api/v1/pregnancy-episodes/:id/encounter-notes`
  (`RecordEncounterNoteDto` → `EncounterNoteResponseDto`, Plan 2 Task 6).

**Role scope, decided and documented here:** both CHW and nurse can reach this form — the
spec's own persona split (Section 3) is about which *fields* nurses document, not a hard
permission wall around encounter notes, and nothing in Plan 1's RLS or Plan 2's controller
restricts `POST .../encounter-notes` by role. The field-set split this task implements: a
CHW sees only the free-text `noteText` field (a basic visit note — "mother reports feeling
well," "referred for follow-up," etc.); a nurse additionally sees the four vitals fields
(`bpSystolic`, `bpDiastolic`, `temperatureC`, `hemoglobinGdl`), since collecting vitals
assumes access to a BP cuff/thermometer/hemoglobinometer that the spec's CHW persona isn't
assumed to carry in the field, while a facility-based nurse is. This mirrors the same
role-aware-fields pattern as Task 9's registration form, applied to `RecordEncounterNoteDto`
instead of `CreatePersonDto`/`CreateEpisodeDto`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/frontline/episodes/[id]/encounter-note/page.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EncounterNotePage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

describe('EncounterNotePage as CHW', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina',
      email: 'amina@example.com',
    });
  });

  it('shows only the note field, no vitals fields', () => {
    render(<EncounterNotePage />);

    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(screen.queryByLabelText('BP systolic')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hemoglobin (g/dL)')).not.toBeInTheDocument();
  });

  it('submits noteText only, with no vitals key, to the episode from the URL', async () => {
    mockedApiFetch.mockResolvedValueOnce({ id: 'note-1' });

    render(<EncounterNotePage />);
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Mother reports feeling well.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: { noteText: 'Mother reports feeling well.' },
    });
  });
});

describe('EncounterNotePage as Nurse', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockPush.mockClear();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u2',
      tenantId: 't1',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
      email: 'joy@example.com',
    });
  });

  it('shows the note field and all four vitals fields', () => {
    render(<EncounterNotePage />);

    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(screen.getByLabelText('BP systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature (C)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hemoglobin (g/dL)')).toBeInTheDocument();
  });

  it('submits noteText and a numeric vitals object', async () => {
    mockedApiFetch.mockResolvedValueOnce({ id: 'note-2' });

    render(<EncounterNotePage />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'BP slightly high.' } });
    fireEvent.change(screen.getByLabelText('BP systolic'), { target: { value: '135' } });
    fireEvent.change(screen.getByLabelText('BP diastolic'), { target: { value: '88' } });
    fireEvent.change(screen.getByLabelText('Temperature (C)'), { target: { value: '37.2' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin (g/dL)'), { target: { value: '11.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/frontline'));
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: {
        noteText: 'BP slightly high.',
        vitals: { bpSystolic: 135, bpDiastolic: 88, temperatureC: 37.2, hemoglobinGdl: 11.4 },
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/episodes/\[id\]/encounter-note/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the encounter note page**

Create `frontend/app/(dashboards)/frontline/episodes/[id]/encounter-note/page.tsx`:
```tsx
'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface VitalsInput {
  bpSystolic?: number;
  bpDiastolic?: number;
  temperatureC?: number;
  hemoglobinGdl?: number;
}

export default function EncounterNotePage() {
  const user = useCurrentUser();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNurse = user.role === 'nurse';

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body: { noteText?: string; vitals?: VitalsInput } = {};
      if (noteText) {
        body.noteText = noteText;
      }

      if (isNurse) {
        const vitals: VitalsInput = {};
        if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
        if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
        if (temperatureC) vitals.temperatureC = Number(temperatureC);
        if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
        if (Object.keys(vitals).length > 0) {
          body.vitals = vitals;
        }
      }

      await apiFetch(`/pregnancy-episodes/${params.id}/encounter-notes`, {
        method: 'POST',
        body,
      });

      router.push('/frontline');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Encounter Note</h1>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          {isNurse && (
            <>
              <Input
                label="BP systolic"
                type="number"
                value={bpSystolic}
                onChange={(e) => setBpSystolic(e.target.value)}
              />
              <Input
                label="BP diastolic"
                type="number"
                value={bpDiastolic}
                onChange={(e) => setBpDiastolic(e.target.value)}
              />
              <Input
                label="Temperature (C)"
                type="number"
                value={temperatureC}
                onChange={(e) => setTemperatureC(e.target.value)}
              />
              <Input
                label="Hemoglobin (g/dL)"
                type="number"
                value={hemoglobinGdl}
                onChange={(e) => setHemoglobinGdl(e.target.value)}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/frontline/episodes/\[id\]/encounter-note/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/frontline/episodes/"
git commit -m "feat: add encounter note form with role-aware vitals fields"
```

---

## Self-review

**Spec coverage** (design spec Section 3 + Core Flow #1, all four numbered requirements
from this plan's brief):
1. Caseload list — Task 8, `GET /pregnancy-episodes?facilityId=`, with the person-name gap
   explicitly decided and documented rather than papered over.
2. Quick registration, role-aware fields — Task 9, both roles hitting the same
   `POST /persons` → `POST /pregnancy-episodes` sequence with different field sets.
3. Visit checklist / task completion — Task 10, `GET /tasks?assignedUserId=` +
   `POST /tasks/:id/complete`.
4. Encounter note form — Task 11, `POST /pregnancy-episodes/:id/encounter-notes`, role
   scope (both CHW and nurse, different field sets) decided and justified rather than left
   as an unstated assumption.

**Shared shell, role-aware content** (`docs/DECISIONS.md` #20): confirmed that Tasks 8–11
are literally the same route/page components for `chw` and `nurse` — no `/chw` vs `/nurse`
route split anywhere, matching the decision record exactly. The only per-role branching is
`user.role === 'nurse'` conditionals inside otherwise-identical components (Tasks 9 and 11).

**Fixed-conventions coverage** (the brief's required Task-1-equivalent scaffolding,
delivered across Tasks 1–7 rather than a single task, since backend Plan 1's single-task
"scaffold + auth + RLS" doesn't decompose the same way on the frontend): Next.js/Tailwind
scaffold and test harness (Task 1), Supabase client factories (Task 2), `apiFetch`/
`ApiError` (Task 3), UI primitives (Task 4), current-user infrastructure (Task 5), login
(Task 6), and the `(dashboards)` shell with `ROLE_HOME_ROUTE` (Task 7) are all present and
match this plan's own Global Constraints section word-for-word in prop shapes, file paths,
and export names — cross-checked directly against `docs/superpowers/plans/2026-08-01-admin-dashboard.md`
(Plan 8, already written), which assumes exactly these file paths (`@/lib/api-client`,
`@/components/ui/button|input|card|table`), exactly this `Button`/`Input`/`Card`/`Table`
prop shape, exactly the `ROLE_HOME_ROUTE` map living inside `(dashboards)/layout.tsx` with
no `admin` key yet, and the `*.test.tsx` naming convention. No divergence found between
what this plan produces and what Plan 8 already assumes.

**Placeholder scan:** no `TODO`, `FIXME`, or "similar to Task N" language anywhere in this
plan's code blocks — every Step contains complete, runnable code. The two intentionally
unfinished-looking pieces (Task 1's placeholder `app/page.tsx`, later replaced in Task 7;
the person-name display in Task 8) are both explicitly labeled as deliberate, temporary, or
permanent-but-limited in prose, not left as silent stubs.

**Type consistency check across tasks:** `AppUser` (`{ id, tenantId, role, facilityId,
fullName, email }`, Task 5) is used with identical field names in `CurrentUserProvider`
(Task 5), `Nav` (Task 7), and every `useCurrentUser()` call site in Tasks 8–11. The local
`Episode`/`CareTask` interfaces in Tasks 8 and 10 use the exact camelCase field names from
Plan 2's `EpisodeResponseDto`/`CareTaskResponseDto` (`personId`, `facilityId`, `lmpDate`,
`estimatedDeliveryDate`, `gestationalAgeWeeks`, `riskBand`, `status`; `pregnancyEpisodeId`,
`taskType`, `assignedUserId`, `dueAt`, `completedAt`, `priority`) — verified against Plan
2's Handoff section, no drift. Task 9's request bodies (`firstName`, `lastName`,
`phonePrimary`, `dateOfBirth`, `personId`, `facilityId`, `lmpDate`) match
`CreatePersonDto`/`CreateEpisodeDto` exactly. Task 11's request body (`noteText`, `vitals: {
bpSystolic, bpDiastolic, temperatureC, hemoglobinGdl }`) matches `RecordEncounterNoteDto`/
`VitalsDto` exactly, including the nested-optional-object shape (vitals omitted entirely
when empty, not sent as `{}`).

No issues found requiring a fix.

---

## Handoff to Plan 6, 7, 8

### Fixed conventions built by this plan (exact paths/exports)

**Supabase clients**
- `frontend/lib/supabase/client.ts` — `export function createClient(): SupabaseClient`
- `frontend/lib/supabase/server.ts` — `export async function createClient(): Promise<SupabaseClient>`

**API client** (`frontend/lib/api-client.ts`)
- `apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>`
- `class ApiError extends Error { code: string; details: unknown[]; correlationId: string }`
- Import and mock as: `jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { code = 'ERROR'; details: unknown[] = []; correlationId = 'test-correlation-id'; } }))`

**Current-user infrastructure**
- `frontend/lib/current-user.ts` — `interface AppUser { id, tenantId, role, facilityId, fullName, email }`; `async getCurrentAppUser(): Promise<AppUser | null>` (server-only — do not call from a Client Component).
- `frontend/components/current-user-provider.tsx` — `CurrentUserProvider({ user, children })`, `useCurrentUser(): AppUser` (Client Component hook — throws if called outside the `(dashboards)` layout's provider, which is always present for any route under `(dashboards)/`).

**Shared UI primitives** (`frontend/components/ui/`)
- `button.tsx` — `Button` — `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }`.
- `input.tsx` — `Input` — `InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }`.
- `card.tsx` — `Card` — `{ children: ReactNode; className?: string }`.
- `table.tsx` — `Table` — `TableHTMLAttributes<HTMLTableElement>` — thin wrapper around a native `<table>`; author `<thead>`/`<tbody>` markup directly as children (no `columns`/`rows` data-driven API).

**Role routing** (`frontend/app/(dashboards)/layout.tsx`)
- `export const ROLE_HOME_ROUTE: Record<string, string>` — currently `{ chw: '/frontline', nurse: '/frontline', clinician: '/clinician', supervisor: '/supervisor' }`, no `admin` key. **Add your role's entry here** when building Plan 6/7/8 (Plan 8 already documents doing exactly this in its own Task 1).
- `export function resolveRedirectForRole(pathname: string, role: string): string | null` — pure function backing the layout's cross-route enforcement; unit-tested directly in `layout.test.ts`. Adding a new `ROLE_HOME_ROUTE` key automatically extends this function's enforcement to that role with no other code change.
- `frontend/app/page.tsx` imports `ROLE_HOME_ROUTE` from this same file for the post-login redirect — one map, two consumers, kept in sync by construction.

**Nav** (`frontend/components/nav.tsx`) — `Nav({ user: AppUser })`, reading a
`NAV_LINKS_BY_ROLE` map keyed by role. Plan 6/7/8 add their role's link entries to that map
in the same file when wiring in their own nav links (not exported as a standalone constant
in this plan — if a later plan needs to import it directly rather than editing it in place,
export it at that point).

**Middleware** (`frontend/middleware.ts`) — forwards the request pathname as the
`x-pathname` header (consumed by `(dashboards)/layout.tsx`) and refreshes the Supabase
session cookie on every navigation. No action needed from later plans unless a new plan
needs additional middleware-level logic, in which case extend this same file rather than
adding a second `middleware.ts` (Next.js only supports one per app).

### Testing conventions

- Frontend tests: `*.test.ts`/`*.test.tsx`, colocated, run via `cd frontend && npm test -- <path>`.
- Mock `@/lib/api-client` and `@/components/current-user-provider` in page tests — never
  mock `fetch` or `@supabase/supabase-js` directly outside this plan's own foundational
  tests (Tasks 2–3, 5), which exist specifically to prove that plumbing works.
- No Playwright/e2e — explicitly out of scope per the design spec's Testing Strategy
  section; async Server Components using `redirect()`/`headers()`/`cookies()`
  (`app/page.tsx`, `(dashboards)/layout.tsx`'s default export, `middleware.ts`) are not
  unit-tested for the reasons given in Global Constraints and Task 7 — extract any new pure
  logic into a plain function and unit-test that instead, the same pattern
  `resolveRedirectForRole` establishes.

### Known gap for a future backend plan (not fixed here)

No `GET /api/v1/persons/:id` or batch person-lookup endpoint exists. Any dashboard that
needs to show a person's name next to an episode/task/referral (this plan's caseload list,
and likely Plan 6's clinician triage board) hits the same wall this plan's Task 8 documents.
Whoever next touches the `identity` module (Plan 1's `IdentityService`/`IdentityController`)
should add one of: `GET /api/v1/persons/:id` (simple, one call per name needed) or
`GET /api/v1/persons?ids=id1,id2,...` (batch, avoids N+1 for list views) — a batch endpoint
is the better fit for list-style dashboards like this one and Plan 6's, since a facility's
caseload can be dozens of episodes.
