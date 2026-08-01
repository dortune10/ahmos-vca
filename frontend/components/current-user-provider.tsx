'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { AppUser } from '@/lib/current-user';

const CurrentUserContext = createContext<AppUser | null>(null);

export function CurrentUserProvider({
  user,
  children,
}: {
  user: AppUser;
  children: ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): AppUser {
  const user = useContext(CurrentUserContext);
  if (!user) {
    throw new Error('useCurrentUser must be used within a CurrentUserProvider');
  }
  return user;
}
