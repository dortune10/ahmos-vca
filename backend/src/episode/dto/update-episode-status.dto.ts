import { IsIn } from 'class-validator';

// Allow-list includes 'Admitted' and 'Cancelled' even though this plan's own migration
// (Task 1) only adds the other seven values to the `pregnancy_episode.status` CHECK
// constraint. Plan 4 (Referral Lifecycle) extends that constraint via its own
// `ALTER TABLE` migration to add exactly these two values, because the referral state
// machine drives an episode to `Admitted` (referral arrived) and back to `Active` (referral
// failed/cancelled) — but Plan 4's `ReferralService` does that via a direct call to
// `EpisodeService.updateStatus()`, bypassing this DTO entirely (this DTO only guards the
// `PATCH /api/v1/pregnancy-episodes/:id/status` HTTP body). Without this allow-list
// extension, that HTTP endpoint itself would reject `Admitted`/`Cancelled` even after Plan
// 4's migration has run — exactly the "known cross-plan follow-up" Plan 4's own Global
// Constraints section flags as not fixed there. This fixes it here instead, so a
// clinician/nurse can also set those two states by hand through the endpoint, not only via
// the referral state machine. Execution order matters: run this plan (Plan 2) first, then
// Plan 4. Until Plan 4's migration has actually run, a PATCH with `status: "Admitted"` or
// `"Cancelled"` will pass this DTO's validation but still be rejected by the database's
// CHECK constraint — that is expected and fine, not a bug to work around here.
export class UpdateEpisodeStatusDto {
  @IsIn(['Draft', 'Active', 'Referred', 'Admitted', 'Delivered', 'PostnatalActive', 'Closed', 'Archived', 'Cancelled'])
  status!:
    | 'Draft'
    | 'Active'
    | 'Referred'
    | 'Admitted'
    | 'Delivered'
    | 'PostnatalActive'
    | 'Closed'
    | 'Archived'
    | 'Cancelled';
}
