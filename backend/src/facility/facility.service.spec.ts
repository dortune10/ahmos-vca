import { Test, TestingModule } from '@nestjs/testing';
import { FacilityService } from './facility.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('FacilityService', () => {
  let service: FacilityService;
  let insertMock: jest.Mock;
  let selectChain: any;
  let auditLogMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: {
            id: 'f1',
            tenant_id: 't1',
            name: 'Test Clinic',
            type: 'clinic',
            contact_phone: null,
            accepting_referrals: false,
          },
          error: null,
        }),
      }),
    });
    selectChain = {
      eq: jest.fn().mockReturnThis(),
      then: undefined,
    };
    const fakeClient = {
      from: () => ({
        insert: insertMock,
        select: () => ({
          eq: jest.fn().mockResolvedValue({
            data: [{ id: 'f1', tenant_id: 't1', name: 'Test Clinic', type: 'clinic', contact_phone: null, accepting_referrals: true }],
            error: null,
          }),
        }),
      }),
    };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<FacilityService>(FacilityService);
  });

  it('creates a facility and writes an audit event', async () => {
    const result = await service.create('jwt', 'u1', 't1', {
      name: 'Test Clinic',
      type: 'clinic',
    });

    expect(result.id).toBe('f1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'facility', action: 'created' }),
    );
  });

  it('lists facilities filtered by accepting_referrals', async () => {
    const result = await service.list('jwt', true);
    expect(result).toHaveLength(1);
    expect(result[0].acceptingReferrals).toBe(true);
  });
});

describe('FacilityService.update', () => {
  it('updates a facility and writes an "updated" audit event', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'f1',
              tenant_id: 't1',
              name: 'Test Clinic',
              type: 'clinic',
              contact_phone: null,
              accepting_referrals: true,
            },
            error: null,
          }),
        }),
      }),
    });
    const fakeClient = { from: () => ({ update: updateMock }) };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const service = module.get<FacilityService>(FacilityService);

    const result = await service.update('jwt', 'admin-1', 't1', 'f1', {
      acceptingReferrals: true,
    });

    expect(result.acceptingReferrals).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ accepting_referrals: true });
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'facility', action: 'updated', entityId: 'f1' }),
    );
  });

  it('only includes fields present on the dto in the update payload', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'f1',
              tenant_id: 't1',
              name: 'Renamed Clinic',
              type: 'clinic',
              contact_phone: null,
              accepting_referrals: false,
            },
            error: null,
          }),
        }),
      }),
    });
    const fakeClient = { from: () => ({ update: updateMock }) };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const service = module.get<FacilityService>(FacilityService);

    await service.update('jwt', 'admin-1', 't1', 'f1', { name: 'Renamed Clinic' });

    expect(updateMock).toHaveBeenCalledWith({ name: 'Renamed Clinic' });
  });
});
