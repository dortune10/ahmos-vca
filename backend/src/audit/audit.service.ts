import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';

export interface AuditLogEntry {
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
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
}
