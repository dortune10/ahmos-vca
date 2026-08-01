export class ReferralResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  fromFacilityId!: string | null;
  toFacilityId!: string;
  reasonCode!: string;
  urgency!: string;
  status!: string;
  createdAt!: string;
  acceptedAt!: string | null;
  departedAt!: string | null;
  arrivedAt!: string | null;
  closedAt!: string | null;

  static fromRow(row: any): ReferralResponseDto {
    const dto = new ReferralResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.fromFacilityId = row.from_facility_id;
    dto.toFacilityId = row.to_facility_id;
    dto.reasonCode = row.reason_code;
    dto.urgency = row.urgency;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    dto.acceptedAt = row.accepted_at;
    dto.departedAt = row.departed_at;
    dto.arrivedAt = row.arrived_at;
    dto.closedAt = row.closed_at;
    return dto;
  }
}
