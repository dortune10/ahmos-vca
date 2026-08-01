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
