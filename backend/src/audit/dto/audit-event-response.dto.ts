export class AuditEventResponseDto {
  id!: string;
  tenantId!: string;
  actorUserId!: string | null;
  entityType!: string;
  entityId!: string;
  action!: string;
  eventTime!: string;
  metadata!: Record<string, unknown>;

  static fromRow(row: any): AuditEventResponseDto {
    const dto = new AuditEventResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.actorUserId = row.actor_user_id;
    dto.entityType = row.entity_type;
    dto.entityId = row.entity_id;
    dto.action = row.action;
    dto.eventTime = row.event_time;
    dto.metadata = row.metadata_json;
    return dto;
  }
}
