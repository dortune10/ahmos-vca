import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';

const URGENT_CARE_MESSAGE =
  'We are concerned about what you described and have alerted your health worker to contact ' +
  'you urgently. If you feel this is a life-threatening emergency, please go to your ' +
  'nearest health facility now or call your local emergency number.';

const NO_EPISODE_URGENT_CARE_MESSAGE =
  'We are concerned about what you described. Please go to your nearest health facility now ' +
  'or contact a health worker immediately — we could not find an active pregnancy record to ' +
  'route this to a specific care team automatically.';

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  async escalate(
    person: PersonResponseDto,
    episode: EpisodeResponseDto | null,
    matchedKeywords: string[],
    inboundText: string,
  ): Promise<string> {
    // matchedKeywords only — never the verbatim inbound text. audit_event is append-only by
    // design (no delete policy) and readable tenant-wide, so a woman's verbatim disclosure of
    // bleeding or seizures written here would be permanently un-erasable and exposed more
    // widely than the clinical tables. The text already lives in `message`, which is
    // correctable and deletable; reviewers read it from there.
    await this.auditService.log({
      tenantId: person.tenantId,
      actorUserId: null,
      entityType: 'person',
      entityId: person.id,
      action: 'whatsapp_danger_sign_detected',
      metadata: { matchedKeywords },
    });

    if (!episode) {
      this.logger.warn(
        `Danger-sign message from person ${person.id} but no active pregnancy episode found — cannot create an escalation task.`,
      );
      return NO_EPISODE_URGENT_CARE_MESSAGE;
    }

    // EVERYTHING BELOW IS BEST-EFFORT. The patient-facing safety text must never depend on a
    // database write succeeding. This is the one message in the whole system that must not
    // fail to deliver: a woman who has just texted "I have heavy bleeding" must receive "go to
    // your nearest health facility now" even if Supabase is having a bad minute. Without this
    // try/catch, a transient error here propagates through MessageRouterService.route() and
    // the webhook controller, Nest returns 500, and she receives absolutely nothing.
    try {
      const assignedUserId = await this.resolveAssignee(person.tenantId, episode.facilityId);

      const task = await this.tasksService.createEscalationTask(
        person.tenantId,
        episode.id,
        assignedUserId,
        'whatsapp_danger_sign',
      );

      await this.auditService.log({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'care_task',
        entityId: task.id,
        action: 'urgent_escalation_created',
        metadata: {
          pregnancyEpisodeId: episode.id,
          assignedUserId,
          matchedKeywords,
          // Per docs/DECISIONS.md #13's human-picks-facility intent and #26: no Referral is
          // created automatically here. The assigned staff member creates it via the
          // existing, unmodified POST /api/v1/referrals endpoint once they've picked an
          // appropriate facility.
          referralCreated: false,
          referralDeferredToStaffAction: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `URGENT: failed to create escalation task for person ${person.id}, episode ${episode.id} ` +
          `after a danger-sign match (${matchedKeywords.join(', ')}). The patient WAS sent the ` +
          'urgent-care message, but no task exists for staff to action. Manual follow-up required.',
        err instanceof Error ? err.stack : String(err),
      );
      await this.safeAudit({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'person',
        entityId: person.id,
        action: 'whatsapp_escalation_failed',
        metadata: { matchedKeywords, pregnancyEpisodeId: episode.id },
      });
    }

    return URGENT_CARE_MESSAGE;
  }

  // The failure-path audit write must not itself throw and swallow the reply.
  private async safeAudit(entry: Parameters<AuditService['log']>[0]): Promise<void> {
    try {
      await this.auditService.log(entry);
    } catch (err) {
      this.logger.error(
        'Failed to write escalation-failure audit event',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async resolveAssignee(tenantId: string, facilityId: string): Promise<string | null> {
    // tenantId is passed through, not dropped: app_user.facility_id can point at a facility in
    // a different tenant (the two columns have no cross-check constraint), and a wrong-tenant
    // assignee cannot see the task at all under care_task_select_tenant.
    const facilityStaff = await this.usersService.findAssignableStaffForFacilityAsSystem(
      tenantId,
      facilityId,
    );
    if (facilityStaff.length > 0) {
      return facilityStaff[0].id;
    }

    const supervisors = await this.usersService.findSupervisorsForTenantAsSystem(tenantId);
    if (supervisors.length > 0) {
      // NOTE: supervisors have no care_task UI in the shipped product (role-routing.ts
      // redirects them away from /frontline/tasks). This fallback keeps the task attributable
      // and audited, but it is not a delivery guarantee — see the plan's "Adaptations to
      // Existing Modules" section on escalation visibility.
      this.logger.warn(
        `No chw/nurse at facility ${facilityId} for tenant ${tenantId} — urgent escalation task ` +
          `assigned to supervisor ${supervisors[0].id}, who has no task UI. Follow up manually.`,
      );
      return supervisors[0].id;
    }

    this.logger.error(
      `ALERT: no chw/nurse at facility ${facilityId} and no supervisor for tenant ${tenantId} — ` +
        'urgent danger-sign escalation task created UNASSIGNED and will not appear on any ' +
        "user's task list. This needs operational follow-up.",
    );
    return null;
  }
}
