import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

function contextWithRole(role: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ currentUser: role ? { role } : undefined }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request when no @Roles() metadata is set', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('chw'))).toBe(true);
  });

  it('allows the request when the current user has one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => ['admin', 'supervisor'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('admin'))).toBe(true);
  });

  it('denies the request when the current user lacks the required role', () => {
    const reflector = {
      getAllAndOverride: () => ['admin'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('chw'))).toBe(false);
  });
});
