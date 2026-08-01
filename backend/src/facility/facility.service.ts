import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { FacilityResponseDto } from './dto/facility-response.dto';
import { UpdateFacilityDto } from './dto/update-facility.dto';

@Injectable()
export class FacilityService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateFacilityDto,
  ): Promise<FacilityResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('facility')
      .insert({
        tenant_id: tenantId,
        name: dto.name,
        type: dto.type,
        contact_phone: dto.contactPhone ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'facility',
      entityId: data.id,
      action: 'created',
      metadata: { name: dto.name, type: dto.type },
    });

    return FacilityResponseDto.fromRow(data);
  }

  async list(jwt: string, acceptingReferralsOnly?: boolean): Promise<FacilityResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('facility').select('*');
    if (acceptingReferralsOnly) {
      query = query.eq('accepting_referrals', true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(FacilityResponseDto.fromRow);
  }

  async update(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    id: string,
    dto: UpdateFacilityDto,
  ): Promise<FacilityResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.contactPhone !== undefined) patch.contact_phone = dto.contactPhone;
    if (dto.acceptingReferrals !== undefined) patch.accepting_referrals = dto.acceptingReferrals;

    const { data, error } = await client
      .from('facility')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'facility',
      entityId: data.id,
      action: 'updated',
      metadata: patch,
    });

    return FacilityResponseDto.fromRow(data);
  }
}
