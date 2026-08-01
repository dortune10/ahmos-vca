import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

function contextWithHeader(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('rejects a request with no Authorization header', async () => {
    const supabaseService = {} as SupabaseService;
    const guard = new AuthGuard(supabaseService);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the caller app_user row to the request when the token is valid', async () => {
    const fakeAppUser = { id: 'u1', tenant_id: 't1', role: 'chw', facility_id: 'f1' };
    const fakeClient = {
      // NOTE: the plan's original fixture omitted this — the guard implementation the plan
      // itself specifies calls `client.auth.getUser(jwt)` before querying `app_user`, so
      // without this mock the test throws `Cannot read properties of undefined (reading
      // 'getUser')` regardless of the AuthGuard logic. Added to match the intended
      // implementation, not to route around a real defect in AuthGuard.
      auth: {
        getUser: async () => ({ data: { user: { id: fakeAppUser.id } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: fakeAppUser, error: null }),
          }),
        }),
      }),
    };
    const supabaseService = {
      getClientForUser: jest.fn().mockReturnValue(fakeClient),
    } as unknown as SupabaseService;

    const guard = new AuthGuard(supabaseService);
    const request: any = { headers: { authorization: 'Bearer valid-jwt' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.currentUser).toEqual({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      jwt: 'valid-jwt',
    });
  });
});
