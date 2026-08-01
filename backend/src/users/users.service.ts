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
}
