import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CurrentUserPayload {
  id: string;
  tenantId: string;
  role: string;
  facilityId: string | null;
  jwt: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const jwt = authHeader.slice('Bearer '.length);

    const client = this.supabaseService.getClientForUser(jwt);

    const { data: authData } = await client.auth.getUser(jwt);
    if (!authData?.user) {
      throw new UnauthorizedException('Invalid session');
    }

    const { data, error } = await client
      .from('app_user')
      .select('id, tenant_id, role, facility_id')
      .eq('id', authData.user.id)
      .single();

    if (error || !data) {
      throw new UnauthorizedException('Invalid session');
    }

    const currentUser: CurrentUserPayload = {
      id: data.id,
      tenantId: data.tenant_id,
      role: data.role,
      facilityId: data.facility_id,
      jwt,
    };
    request.currentUser = currentUser;
    return true;
  }
}
