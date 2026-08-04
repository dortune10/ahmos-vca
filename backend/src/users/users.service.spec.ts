import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('UsersService', () => {
  let service: UsersService;
  let auditLogMock: jest.Mock;
  let insertMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { id: 'auth-user-1', tenant_id: 't1', email: 'nurse@example.com', role: 'nurse', facility_id: 'f1', full_name: 'Nurse Joy' },
          error: null,
        }),
      }),
    });
    const fakeServiceClient = {
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-1' } },
            error: null,
          }),
        },
      },
      from: () => ({ insert: insertMock }),
    };
    const supabaseService = {
      getServiceClient: () => fakeServiceClient,
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates the auth identity, the app_user row, and an audit event', async () => {
    const result = await service.createStaffUser('admin-1', 't1', {
      email: 'nurse@example.com',
      password: 'temp-password-123',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
    });

    expect(result.id).toBe('auth-user-1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'app_user', action: 'created' }),
    );
  });
});

describe('UsersService.list', () => {
  it('returns staff users mapped to StaffUserResponseDto', async () => {
    const row = {
      id: 'auth-user-1',
      tenant_id: 't1',
      email: 'nurse@example.com',
      role: 'nurse',
      facility_id: 'f1',
      full_name: 'Nurse Joy',
    };
    const selectMock = jest.fn().mockResolvedValue({ data: [row], error: null });
    const fakeUserClient = { from: () => ({ select: selectMock }) };
    const supabaseService = {
      getClientForUser: jest.fn().mockReturnValue(fakeUserClient),
    } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    const service = module.get<UsersService>(UsersService);

    const result = await service.list('jwt');

    expect(supabaseService.getClientForUser).toHaveBeenCalledWith('jwt');
    expect(result).toEqual([
      {
        id: 'auth-user-1',
        tenantId: 't1',
        email: 'nurse@example.com',
        role: 'nurse',
        facilityId: 'f1',
        fullName: 'Nurse Joy',
      },
    ]);
  });
});

describe('UsersService system-role staff lookups', () => {
  describe('findAssignableStaffForFacilityAsSystem', () => {
    it('returns chw/nurse app_user rows scoped to BOTH the tenant and the facility', async () => {
      const orderMock = jest.fn().mockResolvedValue({
        data: [
          { id: 'u1', tenant_id: 't1', email: 'chw@example.com', role: 'chw', facility_id: 'f1', full_name: 'CHW One' },
        ],
        error: null,
      });
      const tenantEqMock = jest.fn();
      const facilityEqMock = jest.fn();
      const inMock = jest.fn().mockReturnValue({ order: orderMock });
      facilityEqMock.mockReturnValue({ in: inMock });
      tenantEqMock.mockReturnValue({ eq: facilityEqMock });
      const serviceClient = {
        from: () => ({
          select: () => ({ eq: tenantEqMock }),
        }),
      };
      const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const service = new UsersService(supabaseService, auditService);

      const result = await service.findAssignableStaffForFacilityAsSystem('t1', 'f1');

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('chw');
      // The tenant filter is the guard against assigning an urgent task to a user in another
      // tenant, who would never be able to see it. Do not drop it.
      expect(tenantEqMock).toHaveBeenCalledWith('tenant_id', 't1');
      expect(facilityEqMock).toHaveBeenCalledWith('facility_id', 'f1');
      expect(inMock).toHaveBeenCalledWith('role', ['chw', 'nurse']);
    });
  });

  describe('findSupervisorsForTenantAsSystem', () => {
    it('returns supervisor app_user rows for the given tenant', async () => {
      const orderMock = jest.fn().mockResolvedValue({
        data: [
          { id: 'u2', tenant_id: 't1', email: 'supervisor@example.com', role: 'supervisor', facility_id: null, full_name: 'Supervisor One' },
        ],
        error: null,
      });
      const serviceClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ order: orderMock }),
            }),
          }),
        }),
      };
      const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const service = new UsersService(supabaseService, auditService);

      const result = await service.findSupervisorsForTenantAsSystem('t1');

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('supervisor');
    });
  });
});
