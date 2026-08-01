import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly url = process.env.SUPABASE_URL as string;
  private readonly anonKey = process.env.SUPABASE_ANON_KEY as string;
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  getClientForUser(jwt: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
  }

  getServiceClient(): SupabaseClient {
    return createClient(this.url, this.serviceRoleKey);
  }
}
