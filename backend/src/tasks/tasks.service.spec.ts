import { Test, TestingModule } from '@nestjs/testing';
import { TasksService, CareTaskNotFoundError } from './tasks.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

const SAMPLE_TASK = {
  id: 't1',
  pregnancy_episode_id: 'e1',
  task_type: 'anc_visit',
  assigned_user_id: 'u1',
  due_at: '2026-08-15T00:00:00.000Z',
  completed_at: null,
  status: 'Scheduled',
  priority: 'routine',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

async function buildService(supabaseService: SupabaseService, auditService: AuditService) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TasksService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();
  return module.get<TasksService>(TasksService);
}

describe('TasksService', () => {
  it('generateInitialAncSchedule inserts 4 anc_visit tasks and logs an audit event', async () => {
    const insertedRows = [SAMPLE_TASK, SAMPLE_TASK, SAMPLE_TASK, SAMPLE_TASK];
    const selectMock = jest.fn().mockResolvedValue({ data: insertedRows, error: null });
    const insertMock = jest.fn().mockReturnValue({ select: selectMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ insert: insertMock }) }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.generateInitialAncSchedule('jwt', 'u1', 't1', 'e1');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toHaveLength(4);
    expect(result).toHaveLength(4);
    expect(result[0].taskType).toBe('anc_visit');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', entityType: 'care_task', action: 'schedule_generated' }),
    );
  });

  it('listForUser lists tasks assigned to a user ordered by due date', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [SAMPLE_TASK], error: null });
    const eqMock = jest.fn().mockReturnValue({ order: orderMock });
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ select: selectMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.listForUser('jwt', 'u1');

    expect(eqMock).toHaveBeenCalledWith('assigned_user_id', 'u1');
    expect(result).toHaveLength(1);
  });

  it('complete marks a task completed and logs an audit event with the derived tenant id', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { ...SAMPLE_TASK, status: 'Completed', completed_at: '2026-08-01T00:00:00.000Z', pregnancy_episode: { facility_id: 'f1', facility: { tenant_id: 't1' } } },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ update: updateMock }) }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.complete('jwt', 'u1', 't1');

    expect(result.status).toBe('Completed');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', entityType: 'care_task', action: 'completed' }),
    );
  });

  it('complete throws CareTaskNotFoundError when the task does not exist', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ update: updateMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    await expect(service.complete('jwt', 'u1', 'missing')).rejects.toThrow(CareTaskNotFoundError);
  });

  it('listOverdue lists tasks not yet completed whose due date has passed', async () => {
    const overdueTask = { ...SAMPLE_TASK, due_at: '2020-01-01T00:00:00.000Z' };
    const orderMock = jest.fn().mockResolvedValue({ data: [overdueTask], error: null });
    const inMock = jest.fn().mockReturnValue({ order: orderMock });
    const ltMock = jest.fn().mockReturnValue({ in: inMock });
    const selectMock = jest.fn().mockReturnValue({ lt: ltMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ select: selectMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.listOverdue('jwt');

    expect(inMock).toHaveBeenCalledWith('status', ['Scheduled', 'Due']);
    expect(result).toHaveLength(1);
  });
});
