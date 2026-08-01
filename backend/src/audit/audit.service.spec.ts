import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { SupabaseService } from '../common/supabase/supabase.service';

describe('AuditService', () => {
  let service: AuditService;
  let insertMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockResolvedValue({ error: null });
    const fakeServiceClient = { from: () => ({ insert: insertMock }) };
    const supabaseService = {
      getServiceClient: () => fakeServiceClient,
    } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('writes an audit_event row with the given fields', async () => {
    await service.log({
      tenantId: 't1',
      actorUserId: 'u1',
      entityType: 'person',
      entityId: 'p1',
      action: 'created',
      metadata: { source: 'chw' },
    });

    expect(insertMock).toHaveBeenCalledWith({
      tenant_id: 't1',
      actor_user_id: 'u1',
      entity_type: 'person',
      entity_id: 'p1',
      action: 'created',
      metadata_json: { source: 'chw' },
    });
  });

  describe('list', () => {
    function buildQueryBuilder(rows: any[]) {
      const builder: any = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    }

    it('returns audit events mapped to AuditEventResponseDto, scoped by RLS via getClientForUser', async () => {
      const row = {
        id: 'a1',
        tenant_id: 't1',
        actor_user_id: 'u1',
        entity_type: 'facility',
        entity_id: 'f1',
        action: 'created',
        event_time: '2026-08-01T00:00:00.000Z',
        metadata_json: { name: 'Test Clinic' },
      };
      const builder = buildQueryBuilder([row]);
      const getClientForUser = jest.fn().mockReturnValue({ from: () => builder });
      const supabaseService = { getClientForUser } as unknown as SupabaseService;

      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
      }).compile();
      const listService = module.get<AuditService>(AuditService);

      const result = await listService.list('jwt');

      expect(getClientForUser).toHaveBeenCalledWith('jwt');
      expect(result).toEqual([
        {
          id: 'a1',
          tenantId: 't1',
          actorUserId: 'u1',
          entityType: 'facility',
          entityId: 'f1',
          action: 'created',
          eventTime: '2026-08-01T00:00:00.000Z',
          metadata: { name: 'Test Clinic' },
        },
      ]);
      expect(builder.eq).not.toHaveBeenCalled();
    });

    it('applies entityType and entityId filters when provided', async () => {
      const builder = buildQueryBuilder([]);
      const supabaseService = {
        getClientForUser: () => ({ from: () => builder }),
      } as unknown as SupabaseService;

      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
      }).compile();
      const listService = module.get<AuditService>(AuditService);

      await listService.list('jwt', { entityType: 'facility', entityId: 'f1' });

      expect(builder.eq).toHaveBeenCalledWith('entity_type', 'facility');
      expect(builder.eq).toHaveBeenCalledWith('entity_id', 'f1');
    });
  });
});
