import Link from 'next/link';
import {
  BUILD_FACTS,
  PATHWAY_STEPS,
  RISK_STAGES,
  ROLE_ROWS,
  referralHappyPath,
} from '@/lib/landing-content';

// Public landing page for unauthenticated visitors. A Server Component on purpose: it ships
// no client JavaScript of its own, which is the point for an audience on low-end Android
// devices and poor connections.
//
// Note on the CTA: this uses a styled `next/link` rather than `components/ui/button`.
// `Button` renders a real `<button>` and is a client component; putting one inside an
// anchor is invalid HTML (nested interactive content) and would pull a client bundle into
// an otherwise static page, while a plain anchor keeps middle-click, open-in-new-tab and
// no-JS navigation working. The class shape below deliberately matches Button's
// (`rounded-md px-4 py-2 text-sm font-medium`) so the two read as the same system.

const CTA_BASE =
  'inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium ' +
  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

function PrimaryCta({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/login"
      className={`${CTA_BASE} bg-ink text-paper hover:bg-ink-line focus-visible:outline-ink`}
    >
      {children}
    </Link>
  );
}

function Eyebrow({ children, tone = 'paper' }: { children: React.ReactNode; tone?: 'paper' | 'ink' }) {
  return (
    <p
      className={`font-data text-[0.6875rem] uppercase tracking-[0.18em] ${
        tone === 'ink' ? 'text-ink-pale' : 'text-ink-muted'
      }`}
    >
      {children}
    </p>
  );
}

/** The atom of the product: one episode record. Explicitly labelled as an example. */
function ExampleEpisodeCard() {
  return (
    <figure className="animate-rise-in [animation-delay:260ms] motion-reduce:animate-none">
      <div className="rounded-lg border border-paper-rule bg-white p-5 shadow-[0_1px_2px_rgba(14,35,32,0.04),0_12px_32px_-24px_rgba(14,35,32,0.5)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Pregnancy episode &middot; Example</Eyebrow>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-band-medium/30 bg-band-medium/[0.07] px-3 py-1">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-band-medium" />
            <span className="font-data text-[0.6875rem] uppercase tracking-[0.14em] text-band-medium">
              Medium risk
            </span>
          </span>
        </div>

        <div className="mt-5 flex items-end gap-x-5">
          <p className="font-data text-4xl leading-none tracking-tight text-ink">
            26<span className="text-ink-muted">+3</span>
          </p>
          <div className="pb-0.5">
            <p className="font-data text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted">
              Gestational age
            </p>
            <p className="mt-1 text-sm text-ink-soft">Estimated delivery 12 Feb</p>
          </div>
        </div>

        <dl className="mt-6 divide-y divide-paper-rule border-t border-paper-rule text-sm">
          {[
            ['Reasons', 'Blood pressure 142/94 · haemoglobin not recorded'],
            ['Next task', 'Antenatal visit 4 · due in 6 days'],
            ['Referral', 'None open'],
          ].map(([term, value]) => (
            <div key={term} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="font-data text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted sm:w-28 sm:shrink-0 sm:pt-1">
                {term}
              </dt>
              <dd className="text-ink-soft">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <figcaption className="mt-3 text-xs leading-relaxed text-ink-muted">
        An example of the record staff work from. AMHOS holds no patient data — nothing on
        this page comes from a real person.
      </figcaption>
    </figure>
  );
}

function Hero() {
  return (
    <section className="border-b border-paper-rule">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16 lg:py-28">
        <div>
          <div className="animate-rise-in motion-reduce:animate-none">
            <Eyebrow>Maternal &amp; newborn care coordination</Eyebrow>
          </div>

          <h1 className="animate-rise-in [animation-delay:80ms] mt-6 font-display text-[2.4rem] leading-[1.08] tracking-[-0.02em] text-ink motion-reduce:animate-none sm:text-5xl lg:text-[3.75rem]">
            Every pregnancy registered.
            <br />
            Every risk seen.
            <br />
            Every referral tracked <em className="italic">to arrival</em>.
          </h1>

          <p className="animate-rise-in [animation-delay:160ms] mt-7 max-w-xl text-base leading-relaxed text-ink-soft motion-reduce:animate-none sm:text-[1.0625rem]">
            AMHOS is a care-coordination platform for maternal and newborn health in
            low-resource settings. Community health workers, midwives, clinicians and
            district supervisors work from one shared record — from the first home visit
            through referral to the last postnatal check.
          </p>

          <div className="animate-rise-in [animation-delay:220ms] mt-9 flex flex-wrap items-center gap-3 motion-reduce:animate-none">
            <PrimaryCta>Sign in</PrimaryCta>
            <Link
              href="#pathway"
              className={`${CTA_BASE} border border-ink/25 text-ink hover:border-ink/60 hover:bg-white focus-visible:outline-ink`}
            >
              How the pathway works
            </Link>
          </div>

          <p className="animate-rise-in [animation-delay:280ms] mt-5 text-sm text-ink-muted motion-reduce:animate-none">
            Accounts are created by your programme administrator. There is no public sign-up.
          </p>
        </div>

        <ExampleEpisodeCard />
      </div>
    </section>
  );
}

/**
 * The signature element: a custody line. A single rule threads every step of the episode,
 * and each step says who is holding the case — the page's organising idea is custody, which
 * is what actually breaks down in fragmented maternal care, not sequence for its own sake.
 */
function Pathway() {
  const happyPath = referralHappyPath();

  return (
    <section id="pathway" className="scroll-mt-4 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <Eyebrow>One episode, start to close</Eyebrow>
          <h2 className="mt-4 font-display text-3xl leading-tight tracking-[-0.015em] text-ink sm:text-[2.5rem]">
            The record changes hands. It does not restart.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ink-soft">
            A pregnancy in a fragmented system is re-entered at every threshold it crosses,
            and the thread is lost at the handover. In AMHOS each step below writes to the
            same episode, and each one has someone holding it.
          </p>
        </div>

        <ol className="relative mt-14">
          {/* The line itself. Sits behind the nodes, which are opaque, so it reads as one
              continuous rule passing through them. */}
          <span
            aria-hidden
            className="absolute bottom-6 left-[7px] top-3 w-px bg-ink/20 sm:left-[9px]"
          />

          {PATHWAY_STEPS.map((step) => (
            <li key={step.label} className="relative pl-9 sm:pl-12">
              <span
                aria-hidden
                className="absolute left-0 top-[0.3rem] h-[15px] w-[15px] rounded-[3px] border border-ink/60 bg-white sm:left-0.5 sm:top-[0.35rem]"
              />
              <div className="border-t border-paper-rule pb-9 pt-1 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <div className="pt-4 md:pt-4">
                  <h3 className="font-display text-xl text-ink sm:text-2xl">{step.label}</h3>
                  <p className="mt-1.5 font-data text-[0.625rem] uppercase leading-relaxed tracking-[0.14em] text-ink-muted">
                    {step.heldBy}
                  </p>
                </div>
                <div className="pt-3 md:pt-4">
                  <p className="max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
                    {step.detail}
                  </p>

                  {step.label === 'Assess' && (
                    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                      {(
                        [
                          ['Low', 'bg-band-low', 'text-band-low'],
                          ['Medium', 'bg-band-medium', 'text-band-medium'],
                          ['High', 'bg-band-high', 'text-band-high'],
                        ] as const
                      ).map(([label, dot, text]) => (
                        <li key={label} className="flex items-center gap-2">
                          <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${dot}`} />
                          <span
                            className={`font-data text-[0.6875rem] uppercase tracking-[0.14em] ${text}`}
                          >
                            {label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {step.label === 'Refer' && (
                    <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2">
                      {happyPath.map((status, index) => (
                        <li key={status} className="flex items-center gap-1.5">
                          {index > 0 && (
                            <span aria-hidden className="text-ink-muted">
                              &rarr;
                            </span>
                          )}
                          <span className="rounded border border-paper-rule bg-paper px-2 py-1 font-data text-[0.6875rem] tracking-tight text-ink-soft">
                            {status}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Roles() {
  return (
    <section className="border-y border-paper-rule bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <Eyebrow>Who works in it</Eyebrow>
          <h2 className="mt-4 font-display text-3xl leading-tight tracking-[-0.015em] text-ink sm:text-[2.5rem]">
            Four roles, four different jobs, one record between them.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ink-soft">
            AMHOS is staff software. Signing in puts you straight into the screen your role
            works from, with access limited to your own tenant and facility.
          </p>
        </div>

        <ul className="mt-12 border-t border-ink/15">
          {ROLE_ROWS.map((row) => (
            <li
              key={row.role}
              className="border-b border-ink/15 py-6 md:grid md:grid-cols-[17rem_1fr] md:gap-8"
            >
              <div className="flex items-baseline justify-between gap-4 md:block">
                <h3 className="font-display text-xl text-ink sm:text-[1.375rem]">
                  {row.role}
                </h3>
                <p className="mt-1.5 font-data text-xs tracking-tight text-ink-muted">
                  {row.lands}
                </p>
              </div>
              <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft md:mt-0 md:pt-1">
                {row.work}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The dark section — the loudest moment on the page — is spent on what the system will not
 * do. For health infrastructure sold to ministries and clinical programmes, the limitation
 * is the credibility, so it gets the emphasis a boast would normally take.
 */
function RiskEngine() {
  return (
    <section className="bg-ink">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="lg:grid lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <Eyebrow tone="ink">Risk scoring</Eyebrow>
            <h2 className="mt-4 font-display text-3xl leading-tight tracking-[-0.015em] text-paper sm:text-[2.5rem]">
              Decision support, and nothing further.
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-pale">
              Every pregnancy is scored so that the ones needing attention first are visible
              first. What the score is for, and where it stops, is fixed in the design rather
              than left to interpretation.
            </p>
          </div>

          <ol className="mt-12 lg:mt-0">
            {RISK_STAGES.map((stage) => (
              <li
                key={stage.title}
                className="border-t border-ink-line py-6 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[5.5rem_1fr] sm:gap-6"
              >
                <p className="font-data text-[0.6875rem] uppercase tracking-[0.16em] text-ink-pale sm:pt-1.5">
                  {stage.order}
                </p>
                <div className="mt-2 sm:mt-0">
                  <h3 className="font-display text-xl text-paper">{stage.title}</h3>
                  <p className="mt-2 max-w-xl text-[0.95rem] leading-relaxed text-ink-pale">
                    {stage.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 border-t border-ink-line pt-10 sm:mt-20">
          <p className="max-w-4xl font-display text-2xl leading-[1.35] tracking-[-0.01em] text-paper sm:text-[1.875rem]">
            AMHOS produces decision support, not diagnoses. Its thresholds come from
            published obstetric reference ranges and have{' '}
            <em className="italic">not been clinically validated</em>. Nothing in the system
            replaces a clinician&rsquo;s judgement, and nothing in it acts on a patient
            without one.
          </p>
        </div>
      </div>
    </section>
  );
}

function HowItsBuilt() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <Eyebrow>How it is built</Eyebrow>
          <h2 className="mt-4 font-display text-3xl leading-tight tracking-[-0.015em] text-ink sm:text-[2.5rem]">
            Built for scrutiny, on the assumption something will go wrong.
          </h2>
        </div>

        <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {BUILD_FACTS.map((fact) => (
            <div key={fact.title} className="border-t border-ink/15 pt-5">
              <h3 className="font-display text-xl text-ink">{fact.title}</h3>
              <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-soft">
                {fact.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Status() {
  return (
    <section className="border-t border-paper-rule bg-paper-deep">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="md:grid md:grid-cols-[1fr_auto] md:items-end md:gap-12">
          <div className="max-w-2xl">
            <Eyebrow>Where this stands</Eyebrow>
            <h2 className="mt-4 font-display text-2xl leading-snug text-ink sm:text-3xl">
              Pre-pilot. No live deployment, no patients in the system, no field results to
              report.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-ink-soft">
              This page describes what is built and running, not what is promised. If you
              already have an account, sign in. If you are evaluating AMHOS for a programme,
              the honest summary is the one above: the workflow is real, the clinical
              thresholds still need sign-off.
            </p>
          </div>
          <div className="mt-8 md:mt-0 md:shrink-0">
            <PrimaryCta>Sign in</PrimaryCta>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-paper font-ui text-ink antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper"
      >
        Skip to main content
      </a>

      <header className="border-b border-paper-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg tracking-[0.02em] text-ink">AMHOS</span>
            <span className="hidden font-data text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted sm:inline">
              AI Maternal Health Operating System
            </span>
          </div>
          <Link
            href="/login"
            className="rounded-md px-2 py-1 text-sm font-medium text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main id="main">
        <Hero />
        <Pathway />
        <Roles />
        <RiskEngine />
        <HowItsBuilt />
        <Status />
      </main>

      <footer className="border-t border-paper-rule bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>AMHOS — AI Maternal Health Operating System</p>
          <p>Staff platform. Patient messaging channels are designed but not yet built.</p>
        </div>
      </footer>
    </div>
  );
}
