import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { StaffUserResponseDto } from './dto/staff-user-response.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async createStaffUser(
    actorUserId: string,
    tenantId: string,
    dto: CreateStaffUserDto,
  ): Promise<{ id: string; email: string; role: string }> {
    const client = this.supabaseService.getServiceClient();

    const { data: authResult, error: authError } = await client.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
    });
    if (authError || !authResult.user) {
      throw authError ?? new Error('Failed to create auth user');
    }

    const { data, error } = await client
      .from('app_user')
      .insert({
        id: authResult.user.id,
        tenant_id: tenantId,
        email: dto.email,
        role: dto.role,
        facility_id: dto.facilityId ?? null,
        full_name: dto.fullName,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'app_user',
      entityId: data.id,
      action: 'created',
      metadata: { role: dto.role },
    });

    return { id: data.id, email: data.email, role: data.role };
  }

  async list(jwt: string): Promise<StaffUserResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('app_user').select('*');
    if (error) {
      throw error;
    }
    return (data ?? []).map(StaffUserResponseDto.fromRow);
  }

  // Service-role reads for callers with no end-user JWT — see
  // docs/superpowers/plans/2026-08-01-whatsapp-ai-assistant-escalation.md's "Adaptations to
  // Existing Modules" section. Existing methods above are untouched.
  // BOTH filters are required. app_user.tenant_id and app_user.facility_id are independent
  // columns with no cross-check constraint (00000000000001_core_schema.sql), so a facility-only
  // filter can return a user whose tenant_id is a DIFFERENT tenant. That user cannot see the
  // task — care_task_select_tenant resolves the tenant through the episode's facility, not
  // through the assignee — so assigned_user_id would point at someone for whom the row is
  // invisible, while EscalationService reports success. The urgent task would exist in the
  // database and reach nobody. This is the one service-role query in this plan that RLS is not
  // scoping for us; scope it in application code.
  //
  // Roles are limited to chw/nurse deliberately: /frontline/tasks is the only page in the
  // shipped product that lists care_tasks, and frontend/lib/role-routing.ts hard-redirects
  // clinician and supervisor away from it. Assigning to a clinician would put the emergency in
  // a UI dead end. See "Adaptations to Existing Modules".
  async findAssignableStaffForFacilityAsSystem(
    tenantId: string,
    facilityId: string,
  ): Promise<StaffUserResponseDto[]> {
    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .from('app_user')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('facility_id', facilityId)
      .in('role', ['chw', 'nurse'])
      .order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(StaffUserResponseDto.fromRow);
  }

  async findSupervisorsForTenantAsSystem(tenantId: string): Promise<StaffUserResponseDto[]> {
    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .from('app_user')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('role', 'supervisor')
      .order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(StaffUserResponseDto.fromRow);
  }
}
