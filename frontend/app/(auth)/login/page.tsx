'use client';

import { KeyboardEvent, SyntheticEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Triggered directly from the button's onClick rather than the form's onSubmit event
  // reaching React through native browser form-submission bubbling — in some environments
  // (e.g. certain browser extensions that intercept form submit events, or automated
  // testing tools that dispatch a native 'submit' rather than routing through React) that
  // native path can silently fail to reach this handler, leaving the button apparently
  // inert. Calling the handler directly from onClick removes that dependency entirely.
  // The form's onSubmit is kept as a second path (see below) and Enter-key submission is
  // handled explicitly since the submit button is no longer type="submit".
  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    // router.refresh() forces the root layout's Server Component to re-read the
    // just-written session cookie on the next navigation rather than serving a cached RSC
    // payload from before sign-in — a well-known @supabase/ssr + App Router gotcha.
    router.push('/');
    router.refresh();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // With the button no longer type="submit" (see handleSubmit's comment above), a form
    // with two text inputs no longer implicitly submits on Enter — restore that directly.
    if (event.key === 'Enter') {
      handleSubmit(event);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">AMHOS Staff Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            required
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
