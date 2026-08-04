import { Injectable } from '@nestjs/common';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
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

export class PersonNotFoundError extends Error {
  constructor(public readonly personId: string) {
    super(`Person ${personId} was not found`);
  }
}

// 14 days: a CHW may register a woman days before she first messages, and a code that has
// already expired by the time she tries is worse than useless — it teaches her the channel is
// broken. Long enough to be forgiving, short enough that a code written on a card and lost
// stops being a credential.
const ENROLMENT_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ENROLMENT_CODE_MAX_ATTEMPTS = 5;

export type EnrolmentCodeRedemptionOutcome =
  | 'verified'
  | 'invalid_code'
  | 'expired'
  | 'no_open_code';

export interface EnrolmentCodeRedemptionResult {
  outcome: EnrolmentCodeRedemptionOutcome;
  attemptsRemaining: number | null;
}

// randomInt is crypto-strong; Math.random is not, and a predictable enrolment code is not a
// credential at all. Six digits is a deliberate trade: it is short enough for a health worker
// to read aloud and a low-literacy user to retype, and the 10^6 space is not what bounds an
// attacker — ENROLMENT_CODE_MAX_ATTEMPTS is (5 tries per issued code, on top of the webhook's
// 10-messages-per-minute per-sender throttle from Task 8).
export function generateEnrolmentCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// The row's own uuid is the salt, so two people issued the same 6 digits do not share a hash
// and a stolen hash cannot be replayed against another row.
export function hashEnrolmentCode(codeId: string, code: string): string {
  return createHash('sha256').update(`${codeId}:${code}`).digest('hex');
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

  // Staff-initiated, so it takes a jwt — but it is a hybrid on purpose, and the split matters:
  // AUTHORIZATION is done by reading the person through the CALLER'S client, so
  // person_tenant_isolation (00000000000002_core_rls_policies.sql) makes another tenant's
  // person invisible and this throws PersonNotFoundError with no extra check in application
  // code (docs/DECISIONS.md #21). The WRITES below use the service-role client because
  // whatsapp_enrolment_code deliberately has no insert policy for authenticated (Task 9).
  async issueWhatsAppEnrolmentCode(
    jwt: string,
    actorUserId: string,
    personId: string,
  ): Promise<{ code: string; expiresAt: string }> {
    const userClient = this.supabaseService.getClientForUser(jwt);
    const { data: person, error: personError } = await userClient
      .from('person')
      .select('id, tenant_id')
      .eq('id', personId)
      .maybeSingle();
    if (personError) {
      throw personError;
    }
    if (!person) {
      throw new PersonNotFoundError(personId);
    }

    const serviceClient = this.supabaseService.getServiceClient();

    // Issuing retires every open code for this person, so "the health worker gave her a second
    // code because she lost the first" can never leave two live credentials outstanding.
    const { error: retireError } = await serviceClient
      .from('whatsapp_enrolment_code')
      .delete()
      .eq('person_id', personId)
      .is('consumed_at', null);
    if (retireError) {
      throw retireError;
    }

    // The id is generated here rather than by the database default because it is the hash's
    // salt — the hash has to be computed before the row exists.
    const codeId = randomUUID();
    const code = generateEnrolmentCode();
    const expiresAt = new Date(Date.now() + ENROLMENT_CODE_TTL_MS).toISOString();

    const { error: insertError } = await serviceClient.from('whatsapp_enrolment_code').insert({
      id: codeId,
      person_id: personId,
      code_hash: hashEnrolmentCode(codeId, code),
      expires_at: expiresAt,
      attempts_remaining: ENROLMENT_CODE_MAX_ATTEMPTS,
      issued_by: actorUserId,
    });
    if (insertError) {
      throw insertError;
    }

    // Metadata carries the expiry, never the code. audit_event is append-only (no delete
    // policy, 00000000000003_audit_event.sql) and readable by every authenticated user in the
    // tenant, so a code written here would be a permanently readable credential.
    await this.auditService.log({
      tenantId: person.tenant_id,
      actorUserId,
      entityType: 'person',
      entityId: personId,
      action: 'whatsapp_enrolment_code_issued',
      metadata: { expiresAt },
    });

    return { code, expiresAt };
  }

  // Called from the webhook (no end-user jwt), hence the AsSystem suffix and the service-role
  // client — the same convention findByPhoneAsSystem established in Task 3.
  async redeemWhatsAppEnrolmentCodeAsSystem(
    personId: string,
    tenantId: string,
    verifiedPhoneDigits: string,
    submittedCode: string,
  ): Promise<EnrolmentCodeRedemptionResult> {
    const client = this.supabaseService.getServiceClient();

    const { data: row, error } = await client
      .from('whatsapp_enrolment_code')
      .select('id, code_hash, expires_at, attempts_remaining')
      .eq('person_id', personId)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      return { outcome: 'no_open_code', attemptsRemaining: null };
    }
    if (row.attempts_remaining <= 0) {
      return { outcome: 'invalid_code', attemptsRemaining: 0 };
    }
    // Expiry is checked before the attempt is spent: an expired code is not a wrong guess, and
    // burning the budget on it would punish a woman who simply took too long.
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { outcome: 'expired', attemptsRemaining: row.attempts_remaining };
    }

    const expectedBuf = Buffer.from(row.code_hash, 'hex');
    const providedBuf = Buffer.from(hashEnrolmentCode(row.id, submittedCode), 'hex');
    const matches =
      expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);

    if (!matches) {
      const attemptsRemaining = row.attempts_remaining - 1;
      const { error: decrementError } = await client
        .from('whatsapp_enrolment_code')
        .update({ attempts_remaining: attemptsRemaining, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (decrementError) {
        throw decrementError;
      }
      return { outcome: 'invalid_code', attemptsRemaining };
    }

    // Release this handset from anyone else it is currently verified against, BEFORE binding it
    // here. Phone reassignment is common, and person_whatsapp_verified_phone_unique_idx (Task
    // 9) makes this mandatory rather than tidy: without it the bind below violates the index
    // and the woman now holding the SIM could never enrol. Each displaced person gets their own
    // audit record under their own tenant, so the loss of a channel is never silent.
    const { data: displaced, error: displacedError } = await client
      .from('person')
      .select('id, tenant_id')
      .eq('whatsapp_verified_phone', verifiedPhoneDigits)
      .neq('id', personId);
    if (displacedError) {
      throw displacedError;
    }
    for (const other of displaced ?? []) {
      const { error: releaseError } = await client
        .from('person')
        .update({
          whatsapp_verified_phone: null,
          whatsapp_verified_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', other.id);
      if (releaseError) {
        throw releaseError;
      }
      await this.auditService.log({
        tenantId: other.tenant_id,
        actorUserId: null,
        entityType: 'person',
        entityId: other.id,
        action: 'whatsapp_channel_unbound',
        metadata: { reason: 'phone_number_reverified_for_another_person' },
      });
    }

    const verifiedAt = new Date().toISOString();
    const { error: bindError } = await client
      .from('person')
      .update({
        whatsapp_verified_phone: verifiedPhoneDigits,
        whatsapp_verified_at: verifiedAt,
        updated_at: verifiedAt,
      })
      .eq('id', personId);
    if (bindError) {
      throw bindError;
    }

    const { error: consumeError } = await client
      .from('whatsapp_enrolment_code')
      .update({ consumed_at: verifiedAt, updated_at: verifiedAt })
      .eq('id', row.id);
    if (consumeError) {
      throw consumeError;
    }

    await this.auditService.log({
      tenantId,
      actorUserId: null,
      entityType: 'person',
      entityId: personId,
      action: 'whatsapp_channel_verified',
      metadata: { verifiedAt },
    });

    return { outcome: 'verified', attemptsRemaining: row.attempts_remaining };
  }
}
