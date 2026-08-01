import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/current-user';
import { ROLE_HOME_ROUTE } from './(dashboards)/layout';

export default async function RootPage() {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }
  redirect(ROLE_HOME_ROUTE[user.role] ?? '/login');
}
