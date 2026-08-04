import { Injectable } from '@nestjs/common';

// PROVISIONAL KEYWORD LIST — NOT CLINICALLY VALIDATED. See docs/DECISIONS.md's "Still Open"
// section ("Clinical validation of risk-band language and any future danger-sign keyword
// list — needs a clinical advisor"), and mirror the exact same framing
// backend/src/risk/risk-rules-engine.service.ts's header uses for its own provisional
// thresholds. These keywords are drawn from WHO's commonly published "danger signs in
// pregnancy" guidance (vaginal bleeding, severe headache/visual disturbance suggestive of
// pre-eclampsia, reduced/absent fetal movement, convulsions, severe abdominal pain, high
// fever, ruptured membranes) — real, recognizable content, not placeholder text — but this
// exact list, and plain-text substring matching as the detection method, have NOT received
// clinical sign-off. A false negative here means a genuine danger sign gets a normal AI
// Q&A response instead of an escalation — do not treat this as a validated triage tool.
// Every match is logged to the audit trail (EscalationService) so a clinician can
// review it, and the fixed reply text always tells the woman to seek in-person care
// regardless of match confidence.
export interface DangerSignMatchResult {
  matched: boolean;
  matchedKeywords: string[];
}

const DANGER_SIGN_KEYWORDS: string[] = [
  'bleeding',
  'heavy bleeding',
  'blood loss',
  'severe pain',
  'severe abdominal pain',
  'severe stomach pain',
  'severe headache',
  'blurred vision',
  "can't see",
  'no fetal movement',
  'baby not moving',
  'baby stopped moving',
  'not feeling baby move',
  'seizure',
  'convulsion',
  'convulsions',
  'fitting',
  'fainting',
  'fainted',
  'unconscious',
  "can't breathe",
  'difficulty breathing',
  'water broke',
  'fluid leaking',
  'high fever',
  'very high temperature',
];

// Word-boundary matching, NOT String.includes. Plain substring matching made 'fits' fire on
// 'benefits', 'outfits' and 'profits' — so "what are the benefits of the ANC visit?" would
// have created an urgent care_task and sent the patient an alarming "go to your nearest
// health facility now" message. Over-triage is the safe direction in principle, but a queue
// that fills with noise is a queue staff learn to ignore, which is exactly how the real
// danger-sign message gets missed. ('fits' has been replaced by 'fitting'/'convulsions'
// above for the same reason.)
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DANGER_SIGN_PATTERNS: { keyword: string; pattern: RegExp }[] = DANGER_SIGN_KEYWORDS.map(
  (keyword) => ({
    keyword,
    pattern: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i'),
  }),
);

@Injectable()
export class DangerSignMatcherService {
  match(text: string): DangerSignMatchResult {
    const matchedKeywords = DANGER_SIGN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
      ({ keyword }) => keyword,
    );
    return { matched: matchedKeywords.length > 0, matchedKeywords };
  }
}
