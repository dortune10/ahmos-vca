export class EncounterNoteResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  recordedBy!: string;
  recordedAt!: string;
  noteText!: string | null;
  vitals!: {
    bpSystolic: number | null;
    bpDiastolic: number | null;
    temperatureC: number | null;
    hemoglobinGdl: number | null;
  } | null;
  createdAt!: string;

  static fromRow(row: any): EncounterNoteResponseDto {
    const dto = new EncounterNoteResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.recordedBy = row.recorded_by;
    dto.recordedAt = row.recorded_at;
    dto.noteText = row.note_text;
    dto.vitals = row.vitals_json ?? null;
    dto.createdAt = row.created_at;
    return dto;
  }
}
