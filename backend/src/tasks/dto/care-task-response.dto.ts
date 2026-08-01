export class CareTaskResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  taskType!: string;
  assignedUserId!: string | null;
  dueAt!: string;
  completedAt!: string | null;
  status!: string;
  priority!: string;
  createdAt!: string;
  updatedAt!: string;

  static fromRow(row: any): CareTaskResponseDto {
    const dto = new CareTaskResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.taskType = row.task_type;
    dto.assignedUserId = row.assigned_user_id;
    dto.dueAt = row.due_at;
    dto.completedAt = row.completed_at;
    dto.status = row.status;
    dto.priority = row.priority;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}
