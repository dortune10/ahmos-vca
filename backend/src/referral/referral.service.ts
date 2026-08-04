import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { EpisodeService } from '../episode/episode.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { ReferralResponseDto } from './dto/referral-response.dto';
import {
  assertValidReferralTransition,
  TERMINAL_REFERRAL_STATUSES,
  ReferralStatus,
} from './referral-state-machine';

export class ReferralNotFoundError extends Error {
  constructor(public readonly referralId: string) {
    super(`Referral ${referralId} not found`);
  }
}

export class TargetFacilityNotAcceptingReferralsError extends Error {
  constructor(public readonly facilityId: string) {
    super(
      `Facility ${facilityId} is not accepting referrals (it either does not exist or ` +
        `accepting_referrals is false)`,
    );
  }
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly episodeService: EpisodeService,
  ) {}

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateReferralDto,
  ): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: facility, error: facilityError } = await client
      .from('facility')
      .select('id, accepting_referrals')
      .eq('id', dto.toFacilityId)
      .single();
    if (facilityError || !facility || facility.accepting_referrals !== true) {
      throw new TargetFacilityNotAcceptingReferralsError(dto.toFacilityId);
    }

    const { data, error } = await client
      .from('referral')
      .insert({
        pregnancy_episode_id: dto.pregnancyEpisodeId,
        from_facility_id: dto.fromFacilityId ?? null,
        to_facility_id: dto.toFacilityId,
        reason_code: dto.reasonCode,
        urgency: dto.urgency,
        status: 'Created',
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    // Episode side effect first, audit event second — this plan's consistent ordering for
    // both create() and updateStatus() (see updateStatus below).
    await this.episodeService.updateStatus(jwt, actorUserId, dto.pregnancyEpisodeId, 'Referred');

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'referral',
      entityId: data.id,
      action: 'created',
      metadata: {
        toFacilityId: dto.toFacilityId,
        fromFacilityId: dto.fromFacilityId ?? null,
        urgency: dto.urgency,
        reasonCode: dto.reasonCode,
      },
    });

    return ReferralResponseDto.fromRow(data);
  }

  async updateStatus(
    jwt: string,
    actorUserId: string,
    referralId: string,
    newStatus: string,
  ): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: existing, error: fetchError } = await client
      .from('referral')
      .select('status')
      .eq('id', referralId)
      .single();
    if (fetchError || !existing) {
      throw new ReferralNotFoundError(referralId);
    }

    assertValidReferralTransition(existing.status, newStatus);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'Accepted') patch.accepted_at = now;
    if (newStatus === 'Dispatched') patch.departed_at = now;
    if (newStatus === 'Arrived') patch.arrived_at = now;
    if (TERMINAL_REFERRAL_STATUSES.includes(newStatus as ReferralStatus)) patch.closed_at = now;

    const { data, error } = await client
      .from('referral')
      .update(patch)
      .eq('id', referralId)
      .select('*, pregnancy_episode(facility_id, facility(tenant_id))')
      .single();
    if (error || !data) {
      throw new ReferralNotFoundError(referralId);
    }
    const tenantId = (data as any).pregnancy_episode?.facility?.tenant_id;

    // Episode-status side effects (this plan's Global Constraints table) — Arrived means
    // she is now physically at the receiving facility; Failed/Cancelled means the referral
    // attempt didn't pan out and she reverts to ordinary active care. Completed and every
    // other status leave the episode's status untouched.
    if (newStatus === 'Arrived') {
      await this.episodeService.updateStatus(jwt, actorUserId, data.pregnancy_episode_id, 'Admitted');
    } else if (newStatus === 'Failed' || newStatus === 'Cancelled') {
      await this.episodeService.updateStatus(jwt, actorUserId, data.pregnancy_episode_id, 'Active');
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'referral',
      entityId: referralId,
      action: 'status_changed',
      metadata: { from: existing.status, to: newStatus },
    });

    return ReferralResponseDto.fromRow(data);
  }

  async getById(jwt: string, referralId: string): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('referral').select('*').eq('id', referralId).single();
    if (error || !data) {
      throw new ReferralNotFoundError(referralId);
    }
    return ReferralResponseDto.fromRow(data);
  }

  async listForFacility(
    jwt: string,
    facilityId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<ReferralResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const column = direction === 'incoming' ? 'to_facility_id' : 'from_facility_id';
    const { data, error } = await client
      .from('referral')
      .select('*')
      .eq(column, facilityId)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []).map(ReferralResponseDto.fromRow);
  }

  // Service-role read for callers with no end-user JWT — see the WhatsApp AI assistant plan's
  // "Adaptations to Existing Modules" section. Note this is a READ addition only: that plan
  // deliberately never adds a system-role "create" method here — danger-sign escalation does
  // not call ReferralService.create() at all (docs/DECISIONS.md #26).
  async getLatestForEpisodeAsSystem(episodeId: string): Promise<ReferralResponseDto | null> {
    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .from('referral')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? ReferralResponseDto.fromRow(data) : null;
  }
}
