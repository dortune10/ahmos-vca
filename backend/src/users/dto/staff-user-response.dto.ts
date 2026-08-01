export class StaffUserResponseDto {
  id!: string;
  tenantId!: string;
  email!: string;
  role!: string;
  facilityId!: string | null;
  fullName!: string;

  static fromRow(row: any): StaffUserResponseDto {
    const dto = new StaffUserResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.email = row.email;
    dto.role = row.role;
    dto.facilityId = row.facility_id;
    dto.fullName = row.full_name;
    return dto;
  }
}
