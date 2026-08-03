// Copy and structure for the public landing page at `/`.
//
// This lives in lib/ rather than beside the page for the same reason `role-routing.ts`
// does: a file named `page.tsx` under app/ may only export Next's recognised exports
// (`default`, `metadata`, ...), so anything worth importing or unit-testing has to live
// outside it.
//
// Editorial constraint on everything below — the product is pre-pilot. Every statement
// must be checkable against this repository. No adoption numbers, no outcome claims, no
// named partners, no certifications, no clinical-validation language.

import {
  REFERRAL_STATUS_TRANSITIONS,
  type ReferralStatus,
} from './referral-state-machine';

/**
 * The referral happy path, walked out of the real transition table rather than retyped, so
 * the chain printed on the landing page cannot drift away from the state machine the
 * backend actually enforces. Each state's first listed transition is its non-failure one.
 */
export function referralHappyPath(): ReferralStatus[] {
  const path: ReferralStatus[] = ['Created'];
  // Bounded rather than `while (true)`: a future edit that introduced a cycle into the
  // transition table should produce a short wrong list, not hang the render.
  for (let step = 0; step < 20; step += 1) {
    const next = REFERRAL_STATUS_TRANSITIONS[path[path.length - 1]]?.[0];
    if (!next || path.includes(next)) {
      break;
    }
    path.push(next);
  }
  return path;
}

export interface PathwayStep {
  /** Short verb the step is known by. Doubles as the node label on the custody line. */
  label: string;
  /** Who holds the case at this step. The page's structural device is custody, not order. */
  heldBy: string;
  detail: string;
}

/**
 * The maternal episode from registration to closure. Ordered because the pathway really is
 * ordered — this is the sequence the episode state machine walks, not a decorative 01/02/03.
 */
export const PATHWAY_STEPS: PathwayStep[] = [
  {
    label: 'Register',
    heldBy: 'Community health worker or nurse',
    detail:
      'A pregnancy is entered once and becomes an episode. Everything after this — visits, assessments, referrals — attaches to it rather than starting a new record.',
  },
  {
    label: 'Assess',
    heldBy: 'Rules engine, then a clinician',
    detail:
      'Blood pressure, haemoglobin and temperature are scored against clinical rules. The result carries its reasons with it, and says plainly when a value was missing rather than guessing.',
  },
  {
    label: 'Schedule',
    heldBy: 'The care plan',
    detail:
      'Antenatal and postnatal checks become dated tasks with a named owner, so a visit that does not happen is visible instead of invisible.',
  },
  {
    label: 'Refer',
    heldBy: 'Nurse or clinician',
    detail:
      'An escalation opens a referral with a reason and an urgency. From there every change of state is timestamped and cannot skip a step.',
  },
  {
    label: 'Receive',
    heldBy: 'Receiving facility',
    detail:
      'The hospital works a triage board ordered by risk rather than by who walked in first, and can see the referral before the patient arrives.',
  },
  {
    label: 'Follow up',
    heldBy: 'Community health worker',
    detail:
      'Postnatal and newborn checks run to completion, and only then does the episode close.',
  },
];

export interface RoleRow {
  role: string;
  /** Where this role lands after signing in — the real route from `ROLE_HOME_ROUTE`. */
  lands: string;
  work: string;
}

/**
 * The page is organised by who does the work because the product is: every role has its own
 * home route and its own dashboard (see `lib/role-routing.ts`).
 */
export const ROLE_ROWS: RoleRow[] = [
  {
    role: 'Community health worker & nurse',
    lands: '/frontline',
    work: 'Register a pregnancy in the field, work through a visit checklist, and record encounter notes and vitals at the clinic.',
  },
  {
    role: 'Clinician',
    lands: '/clinician',
    work: 'Work a facility triage board ordered by risk, open an episode in full, override a risk assessment with a recorded reason, and refer on to another facility.',
  },
  {
    role: 'District supervisor',
    lands: '/supervisor',
    work: 'Follow programme indicators across facilities and see which referrals have breached their service-level window.',
  },
  {
    role: 'Tenant administrator',
    lands: '/admin',
    work: 'Create facilities and staff accounts, and read the audit trail.',
  },
];

export interface RiskStage {
  order: string;
  title: string;
  detail: string;
}

/** How the risk engine actually behaves. Deliberately worded as limits, not capabilities. */
export const RISK_STAGES: RiskStage[] = [
  {
    order: 'First',
    title: 'Deterministic rules',
    detail:
      'Clinical rules score the vitals that are present and return a band together with the reason codes behind it. This tier always runs and never depends on a network call.',
  },
  {
    order: 'Second',
    title: 'An AI tier that enriches, never gates',
    detail:
      'A model-assisted advisory score refines the rule result. If the model is slow, unavailable or misconfigured, scoring falls back to rules alone and care continues.',
  },
  {
    order: 'Last',
    title: 'A clinician decides',
    detail:
      'Any clinician can override the band. The new band, the reason and the person who set it are written onto the assessment and into the audit trail.',
  },
];

export interface BuildFact {
  title: string;
  detail: string;
}

/** Engineering facts, each checkable in this repository. */
export const BUILD_FACTS: BuildFact[] = [
  {
    title: 'Isolation enforced by the database',
    detail:
      'Tenant and facility access rules are Postgres row-level security policies, so who can read a record does not depend on the application layer getting every query right.',
  },
  {
    title: 'An audit trail staff can read but not rewrite',
    detail:
      'Clinical actions, risk overrides and configuration changes append to an event table with no update or delete path for end users.',
  },
  {
    title: 'Referral states that cannot skip',
    detail:
      'The referral lifecycle is a declared state machine. A transition that is not in the table is rejected outright and the attempt is recorded, rather than quietly accepted.',
  },
  {
    title: 'Light enough for the phones staff already carry',
    detail:
      'This page loads no third-party scripts, no icon library and no web font for its headings. Everything you see is HTML, CSS and a small amount of React.',
  },
];
