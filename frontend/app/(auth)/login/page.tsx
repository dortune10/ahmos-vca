'use client';

import { KeyboardEvent, SyntheticEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';

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

  // The first screen of every shift, read on a low-end Android over a bad connection. It is
  // one object: an ink masthead sitting directly on the paper form, the way an official
  // register carries a printed header above ruled lines. That gives the screen an identity
  // with a background colour and two typefaces — no image, no illustration, no extra bytes,
  // nothing between the health worker and the two fields.
  //
  // It is also the only screen in the product with no clinical data on it, so it carries no
  // saturation at all — not even for the failure message. The first saturated pixel anyone
  // sees in AMHOS is a risk band.
  return (
    <div className="flex min-h-screen flex-col bg-paper font-ui text-ink antialiased">
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-[25rem]">
          <div className="overflow-hidden rounded-lg border border-paper-rule shadow-[0_1px_2px_rgba(14,35,32,0.04),0_18px_40px_-28px_rgba(14,35,32,0.6)]">
            <div className="bg-ink px-6 py-6 sm:px-7">
              <p className="font-display text-2xl leading-none tracking-[0.02em] text-paper">
                AMHOS
              </p>
              <p className="mt-2.5 font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-pale">
                AI Maternal Health Operating System
              </p>
            </div>

            <div className="bg-white px-6 py-6 sm:px-7">
              <h1 className="font-display text-xl leading-snug text-ink">Staff sign-in</h1>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <Input
                  label="Email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  required
                />
                {error && (
                  <Notice tone="error" label="Sign-in failed">
                    {error}
                  </Notice>
                )}
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </div>

            <div className="border-t border-paper-rule bg-paper-deep px-6 py-3.5 sm:px-7">
              <p className="text-xs leading-relaxed text-ink-soft">
                Accounts are created by your programme administrator. There is no public
                sign-up.
              </p>
            </div>
          </div>

          <p className="mt-4 px-1 font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
            Staff platform &middot; Pre-pilot
          </p>
        </div>
      </main>
    </div>
  );
}
