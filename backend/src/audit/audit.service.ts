import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';

export interface AuditLogEntry {
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
}

export interface AuditEventFilters {
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    await client.from('audit_event').insert({
      tenant_id: entry.tenantId,
      actor_user_id: entry.actorUserId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      metadata_json: entry.metadata,
    });
  }

  async list(jwt: string, filters?: AuditEventFilters): Promise<AuditEventResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('audit_event').select('*').order('event_time', { ascending: false });
    if (filters?.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters?.entityId) {
      query = query.eq('entity_id', filters.entityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(AuditEventResponseDto.fromRow);
  }
}
