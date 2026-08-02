import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ReactNode } from 'react';
import { getCurrentAppUser } from '@/lib/current-user';
import { resolveRedirectForRole } from '@/lib/role-routing';
import { CurrentUserProvider } from '@/components/current-user-provider';
import { Nav } from '@/components/nav';

export default async function DashboardsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }

  const pathname = headers().get('x-pathname') ?? '';
  const redirectTo = resolveRedirectForRole(pathname, user.role);
  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <CurrentUserProvider user={user}>
      <div className="min-h-screen bg-gray-50">
        <Nav user={user} />
        <main className="mx-auto max-w-5xl p-4">{children}</main>
      </div>
    </CurrentUserProvider>
  );
}
