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

export class AmbiguousPersonMatchError extends Error {
  constructor(public readonly phone: string, public readonly matchCount: number) {
    super(`Phone number ${phone} matched ${matchCount} person rows, expected at most one`);
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

  async findByIds(jwt: string, ids: string[]): Promise<PersonResponseDto[]> {
    if (ids.length === 0) {
      return [];
    }
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('person').select('*').in('id', ids);
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

  // "AsSystem" methods use the service-role client because the caller has no end-user JWT —
  // e.g. the WhatsApp webhook, called by Meta's servers on behalf of a patient who has never
  // authenticated to this system. See docs/superpowers/plans/2026-08-01-whatsapp-messaging-infrastructure.md's
  // "Adaptations to Existing Modules" section for the full rationale. The existing jwt-based
  // methods above (search, findByIds, create) are untouched.
  // Meta delivers the sender as a wa_id — E.164 digits with NO leading '+' (e.g.
  // '254700000001') — while person.phone_primary is stored WITH the '+' ('+254700000001').
  // phone_primary is a plain text column: nothing in the schema or the registration UI
  // normalizes either side, so this method is the one place the two formats are reconciled.
  // Matching is EXACT against both candidate forms via .in() with an array (parameterized by
  // supabase-js). Do not relax this to ilike/like/suffix matching: this lookup is the only
  // tenant boundary in the WhatsApp feature.
  async findByPhoneAsSystem(phone: string): Promise<PersonResponseDto | null> {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length === 0) {
      return null;
    }
    const candidates = [`+${digits}`, digits];

    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .from('person')
      .select('*')
      .in('phone_primary', candidates);
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) {
      return null;
    }
    if (data.length > 1) {
      throw new AmbiguousPersonMatchError(phone, data.length);
    }
    return PersonResponseDto.fromRow(data[0]);
  }

  async markWhatsAppConsentAsSystem(personId: string, consentedAt: string): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    const { error } = await client
      .from('person')
      .update({
        whatsapp_consent: true,
        whatsapp_consent_at: consentedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', personId);
    if (error) {
      throw error;
    }
  }

  // Consent that cannot be withdrawn is not consent. WhatsApp's own Business Policy also
  // requires an honoured opt-out — ignoring STOP is grounds for the business number being
  // restricted, which takes the whole channel down. Called from the webhook's STOP branch.
  async revokeWhatsAppConsentAsSystem(personId: string): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    const { error } = await client
      .from('person')
      .update({
        whatsapp_consent: false,
        whatsapp_consent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', personId);
    if (error) {
      throw error;
    }
  }
}
