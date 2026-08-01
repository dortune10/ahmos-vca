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
});
