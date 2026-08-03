export class PersonResponseDto {
  id!: string;
  tenantId!: string;
  firstName!: string;
  lastName!: string | null;
  phonePrimary!: string | null;
  dateOfBirth!: string | null;
  whatsappConsent!: boolean;
  whatsappConsentAt!: string | null;

  static fromRow(row: any): PersonResponseDto {
    const dto = new PersonResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.firstName = row.first_name;
    dto.lastName = row.last_name;
    dto.phonePrimary = row.phone_primary;
    dto.dateOfBirth = row.date_of_birth;
    dto.whatsappConsent = row.whatsapp_consent ?? false;
    dto.whatsappConsentAt = row.whatsapp_consent_at ?? null;
    return dto;
  }
}
