import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { PersonResponseDto } from './dto/person-response.dto';

export class DuplicatePersonError extends Error {
  constructor(public readonly existingPersonId: string) {
    super('A person with this phone number already exists for this tenant');
  }
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async search(jwt: string, phone: string): Promise<PersonResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('person').select('*').eq('phone_primary', phone);
    if (error) {
      throw error;
    }
    return (data ?? []).map(PersonResponseDto.fromRow);
  }

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreatePersonDto,
  ): Promise<PersonResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    if (dto.phonePrimary) {
      const { data: existing, error: searchError } = await client
        .from('person')
        .select('id')
        .eq('phone_primary', dto.phonePrimary);
      if (searchError) {
        throw searchError;
      }
      if (existing && existing.length > 0) {
        throw new DuplicatePersonError(existing[0].id);
      }
    }

    const { data, error } = await client
      .from('person')
      .insert({
        tenant_id: tenantId,
        first_name: dto.firstName,
        last_name: dto.lastName ?? null,
        phone_primary: dto.phonePrimary ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'person',
      entityId: data.id,
      action: 'created',
      metadata: {},
    });

    return PersonResponseDto.fromRow(data);
  }
}
