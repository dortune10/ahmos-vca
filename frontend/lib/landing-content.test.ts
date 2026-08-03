import {
  BUILD_FACTS,
  PATHWAY_STEPS,
  RISK_STAGES,
  ROLE_ROWS,
  referralHappyPath,
} from './landing-content';
import { ROLE_HOME_ROUTE } from './role-routing';

describe('referralHappyPath', () => {
  it('walks the real transition table from Created through to Completed', () => {
    expect(referralHappyPath()).toEqual([
      'Created',
      'Sent',
      'Accepted',
      'Dispatched',
      'InTransit',
      'Arrived',
      'Completed',
    ]);
  });

  it('ends on a terminal state rather than running off the table', () => {
    const path = referralHappyPath();

    expect(path[path.length - 1]).toBe('Completed');
    expect(new Set(path).size).toBe(path.length);
  });
});

describe('landing content', () => {
  it('describes every pathway step with a holder and a detail', () => {
    expect(PATHWAY_STEPS.length).toBeGreaterThan(0);
    PATHWAY_STEPS.forEach((step) => {
      expect(step.label).toBeTruthy();
      expect(step.heldBy).toBeTruthy();
      expect(step.detail).toBeTruthy();
    });
  });

  it('only advertises roles that really have a home route', () => {
    ROLE_ROWS.forEach((row) => {
      expect(Object.values(ROLE_HOME_ROUTE)).toContain(row.lands);
    });
  });

  it('covers every distinct role home route the app can send someone to', () => {
    const advertised = new Set(ROLE_ROWS.map((row) => row.lands));

    expect(advertised).toEqual(new Set(Object.values(ROLE_HOME_ROUTE)));
  });

  it('keeps the risk stages ordered rules-first, model-second, clinician-last', () => {
    expect(RISK_STAGES.map((stage) => stage.order)).toEqual(['First', 'Second', 'Last']);
    expect(RISK_STAGES[0].title).toMatch(/rules/i);
    expect(RISK_STAGES[RISK_STAGES.length - 1].title).toMatch(/clinician/i);
  });

  it('makes no claim of certification, adoption or clinical outcomes anywhere in the copy', () => {
    const allCopy = [
      ...PATHWAY_STEPS.map((s) => `${s.label} ${s.heldBy} ${s.detail}`),
      ...ROLE_ROWS.map((r) => `${r.role} ${r.work}`),
      ...RISK_STAGES.map((s) => `${s.title} ${s.detail}`),
      ...BUILD_FACTS.map((f) => `${f.title} ${f.detail}`),
    ]
      .join(' ')
      .toLowerCase();

    [
      'hipaa',
      'iso 27001',
      'gdpr-compliant',
      'certified',
      'trusted by',
      'clinically validated',
      'proven',
      'uptime',
      'customers',
    ].forEach((forbidden) => expect(allCopy).not.toContain(forbidden));
  });
});
