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
      <div className="min-h-screen bg-paper font-ui text-ink antialiased">
        <Nav user={user} />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </CurrentUserProvider>
  );
}
