import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CareTaskResponseDto } from './dto/care-task-response.dto';

// Simplified fixed ANC visit schedule for MVP: 4 routine visits spaced roughly monthly
// starting 2 weeks out. Not clinically validated (see docs/DECISIONS.md "Still Open" —
// actual clinical scheduling rules need clinical input, same caveat as the risk rules
// engine's thresholds).
const ANC_SCHEDULE_OFFSETS_DAYS = [14, 45, 75, 105];

export class CareTaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Care task ${taskId} not found`);
  }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async generateInitialAncSchedule(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    pregnancyEpisodeId: string,
  ): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const now = Date.now();
    const rows = ANC_SCHEDULE_OFFSETS_DAYS.map((offsetDays) => ({
      pregnancy_episode_id: pregnancyEpisodeId,
      task_type: 'anc_visit',
      assigned_user_id: actorUserId,
      due_at: new Date(now + offsetDays * 24 * 60 * 60 * 1000).toISOString(),
      status: 'Scheduled',
      priority: 'routine',
    }));

    const { data, error } = await client.from('care_task').insert(rows).select();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'care_task',
      entityId: pregnancyEpisodeId,
      action: 'schedule_generated',
      metadata: { taskIds: (data ?? []).map((row: any) => row.id), count: data?.length ?? 0 },
    });

    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }

  async listForUser(jwt: string, assignedUserId: string): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('care_task')
      .select('*')
      .eq('assigned_user_id', assignedUserId)
      .order('due_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }

  async complete(jwt: string, actorUserId: string, taskId: string): Promise<CareTaskResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data, error } = await client
      .from('care_task')
      .update({
        status: 'Completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select('*, pregnancy_episode(facility_id, facility(tenant_id))')
      .single();

    if (error || !data) {
      throw new CareTaskNotFoundError(taskId);
    }

    const tenantId = (data as any).pregnancy_episode?.facility?.tenant_id;

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'care_task',
      entityId: taskId,
      action: 'completed',
      metadata: {},
    });

    return CareTaskResponseDto.fromRow(data);
  }

  async listOverdue(jwt: string, facilityId?: string): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client
      .from('care_task')
      .select('*, pregnancy_episode!inner(facility_id)')
      .lt('due_at', new Date().toISOString())
      .in('status', ['Scheduled', 'Due']);

    if (facilityId) {
      query = query.eq('pregnancy_episode.facility_id', facilityId);
    }

    const { data, error } = await query.order('due_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }
}
