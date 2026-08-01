export class EpisodeResponseDto {
  id!: string;
  personId!: string;
  facilityId!: string;
  lmpDate!: string | null;
  estimatedDeliveryDate!: string | null;
  gestationalAgeWeeks!: number | null;
  riskBand!: string | null;
  status!: string;
  createdAt!: string;
  updatedAt!: string;

  static fromRow(row: any): EpisodeResponseDto {
    const dto = new EpisodeResponseDto();
    dto.id = row.id;
    dto.personId = row.person_id;
    dto.facilityId = row.facility_id;
    dto.lmpDate = row.lmp_date;
    dto.estimatedDeliveryDate = row.estimated_delivery_date;
    dto.gestationalAgeWeeks = row.gestational_age_weeks;
    dto.riskBand = row.risk_band;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}
