import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { EpisodeResponseDto } from './dto/episode-response.dto';
import { RecordEncounterNoteDto } from './dto/record-encounter-note.dto';
import { EncounterNoteResponseDto } from './dto/encounter-note-response.dto';

export class PersonNotFoundError extends Error {
  constructor(public readonly personId: string) {
    super(`Person ${personId} not found`);
  }
}

export class EpisodeNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`Pregnancy episode ${episodeId} not found`);
  }
}

export interface EpisodeLifecycleEventPayload {
  episodeId: string;
  tenantId: string;
  actorUserId: string;
}

// Naegele's rule: EDD = LMP + 280 days (40 weeks). Standard obstetric estimate used when no
// more precise (e.g. ultrasound-confirmed) EDD is provided at registration. Uses UTC-based
// date methods throughout -- setDate()/getDate() operate in the server's local timezone,
// which would make this computation depend on wherever the process happens to be deployed.
function estimateDeliveryDateFromLmp(lmpDate: string): string {
  const date = new Date(lmpDate);
  date.setUTCDate(date.getUTCDate() + 280);
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class EpisodeService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // EpisodeService.create() sets the new episode's status directly to 'Active', not
  // 'Draft'. The PRD's state diagram assumes a CHW-mobile app that can create a local,
  // not-yet-synced episode ('Draft') before it reaches the server. This build has no
  // offline-sync requirement — an always-online web app hits this API directly — so there
  // is no intermediate "not yet submitted" state to represent: by the time this method
  // runs at all, the full registration payload has already reached the server in one
  // request. This also matches the design spec's Section 5 registration flow, which treats
  // registration as a single atomic step that immediately assigns initial care tasks and
  // triggers risk assessment — behavior that belongs to an active episode, not a draft one.
  // 'Draft' remains a legal value in the pregnancy_episode.status CHECK constraint for
  // forward compatibility (e.g. a future multi-step registration wizard) but nothing in
  // this plan ever sets it.
  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateEpisodeDto,
  ): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: person, error: personError } = await client
      .from('person')
      .select('id')
      .eq('id', dto.personId)
      .single();
    if (personError || !person) {
      throw new PersonNotFoundError(dto.personId);
    }

    const estimatedDeliveryDate =
      dto.estimatedDeliveryDate ?? (dto.lmpDate ? estimateDeliveryDateFromLmp(dto.lmpDate) : null);

    const { data, error } = await client
      .from('pregnancy_episode')
      .insert({
        person_id: dto.personId,
        facility_id: dto.facilityId,
        lmp_date: dto.lmpDate ?? null,
        estimated_delivery_date: estimatedDeliveryDate,
        gestational_age_weeks: dto.gestationalAgeWeeks ?? null,
        status: 'Active',
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'pregnancy_episode',
      entityId: data.id,
      action: 'created',
      metadata: { personId: dto.personId, facilityId: dto.facilityId },
    });

    // Partial-failure note (accepted MVP limitation, not solved here): if task generation
    // below fails after the episode insert above has already committed, the episode is
    // left without its initial ANC schedule. supabase-js has no cross-table transaction
    // API, so this sequence (person check -> episode insert -> task insert) is
    // best-effort, not atomic. A retry/backfill path for orphaned episodes is future work,
    // not a distributed-transaction problem to solve in this plan.
    await this.tasksService.generateInitialAncSchedule(jwt, actorUserId, tenantId, data.id);

    const payload: EpisodeLifecycleEventPayload = { episodeId: data.id, tenantId, actorUserId };
    this.eventEmitter.emit('episode.created', payload);

    return EpisodeResponseDto.fromRow(data);
  }

  async recordEncounterNote(
    jwt: string,
    actorUserId: string,
    episodeId: string,
    dto: RecordEncounterNoteDto,
  ): Promise<EncounterNoteResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: episode, error: episodeError } = await client
      .from('pregnancy_episode')
      .select('id, facility(tenant_id)')
      .eq('id', episodeId)
      .single();
    if (episodeError || !episode) {
      throw new EpisodeNotFoundError(episodeId);
    }
    const tenantId = (episode as any).facility?.tenant_id;

    const { data, error } = await client
      .from('encounter_note')
      .insert({
        pregnancy_episode_id: episodeId,
        recorded_by: actorUserId,
        note_text: dto.noteText ?? null,
        vitals_json: dto.vitals ?? null,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'encounter_note',
      entityId: data.id,
      action: 'created',
      metadata: { pregnancyEpisodeId: episodeId },
    });

    const payload: EpisodeLifecycleEventPayload = { episodeId, tenantId, actorUserId };
    this.eventEmitter.emit('episode.clinical_data_updated', payload);

    return EncounterNoteResponseDto.fromRow(data);
  }

  // Note the "minimal validation" design per this plan's brief: any string that passes
  // UpdateEpisodeStatusDto's @IsIn check at the controller layer (Task 6) is accepted here
  // without a transition-graph check — the referral module (Plan 4) owns strict
  // state-machine validation for its own referral.status, and duplicating a transition
  // graph here for pregnancy_episode.status would be validating the same real-world event
  // twice in two places that could drift apart.
  async updateStatus(
    jwt: string,
    actorUserId: string,
    episodeId: string,
    newStatus: string,
  ): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data, error } = await client
      .from('pregnancy_episode')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', episodeId)
      .select('*, facility(tenant_id)')
      .single();
    if (error || !data) {
      throw new EpisodeNotFoundError(episodeId);
    }
    const tenantId = (data as any).facility?.tenant_id;

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'pregnancy_episode',
      entityId: episodeId,
      action: 'status_changed',
      metadata: { newStatus },
    });

    return EpisodeResponseDto.fromRow(data);
  }

  // Read path for the clinical narrative that recordEncounterNote() writes. Until this
  // existed, encounter_note was write-only from the application's perspective: the only
  // other reader is RiskService, which pulls vitals_json off the single latest note for
  // scoring and never surfaces note_text to a human.
  //
  // Ordered by recorded_at (the clinical event time the UI labels each note with), not
  // created_at (the row's insert time). They are equal today because recordEncounterNote()
  // lets both default to now(), but recorded_at is the column that would carry a
  // back-dated visit if retrospective entry is ever added, so ordering on it is the
  // definition that stays correct.
  async listEncounterNotes(jwt: string, episodeId: string): Promise<EncounterNoteResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);

    // Resolve the episode first so an unknown or out-of-tenant episode id produces
    // EPISODE_NOT_FOUND rather than a silently empty list. The encounter_note select policy
    // is tenant-scoped, so querying notes directly for another tenant's episode returns []
    // — indistinguishable from "this episode genuinely has no notes yet", which is a
    // dangerous ambiguity to show a clinician.
    const { data: episode, error: episodeError } = await client
      .from('pregnancy_episode')
      .select('id')
      .eq('id', episodeId)
      .single();
    if (episodeError || !episode) {
      throw new EpisodeNotFoundError(episodeId);
    }

    const { data, error } = await client
      .from('encounter_note')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('recorded_at', { ascending: false });
    if (error) {
      throw error;
    }

    return (data ?? []).map(EncounterNoteResponseDto.fromRow);
  }

  async getById(jwt: string, episodeId: string): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('pregnancy_episode')
      .select('*')
      .eq('id', episodeId)
      .single();
    if (error || !data) {
      throw new EpisodeNotFoundError(episodeId);
    }
    return EpisodeResponseDto.fromRow(data);
  }

  async listForCaseload(jwt: string, facilityId?: string): Promise<EpisodeResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('pregnancy_episode').select('*');
    if (facilityId) {
      query = query.eq('facility_id', facilityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(EpisodeResponseDto.fromRow);
  }
}
