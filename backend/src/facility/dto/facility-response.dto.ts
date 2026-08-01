export class FacilityResponseDto {
  id!: string;
  tenantId!: string;
  name!: string;
  type!: string;
  contactPhone!: string | null;
  acceptingReferrals!: boolean;

  static fromRow(row: any): FacilityResponseDto {
    const dto = new FacilityResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.name = row.name;
    dto.type = row.type;
    dto.contactPhone = row.contact_phone;
    dto.acceptingReferrals = row.accepting_referrals;
    return dto;
  }
}
