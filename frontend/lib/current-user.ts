import { createClient } from '@/lib/supabase/server';

export interface AppUser {
  id: string;
  tenantId: string;
  role: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';
  facilityId: string | null;
  fullName: string;
  email: string;
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from('app_user')
    .select('id, tenant_id, role, facility_id, full_name, email')
    .eq('id', session.user.id)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    tenantId: data.tenant_id,
    role: data.role,
    facilityId: data.facility_id,
    fullName: data.full_name,
    email: data.email,
  };
}
