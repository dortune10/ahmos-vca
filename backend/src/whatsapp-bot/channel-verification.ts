// The person-side half of docs/DECISIONS.md #28. Kept as pure functions with no Nest or
// Supabase dependency so the rules below can be pinned by fast unit tests and read in one
// screen — they decide whether a woman's health record is disclosed, which is not a decision
// that should be buried inside a controller method.

// Meta delivers the sender as a wa_id: E.164 digits with NO leading '+'. Both
// person.whatsapp_verified_phone (migration 00000000000013) and this function store/produce
// that same digits-only form, so the comparison below is a plain string equality with no
// re-normalization at read time. IdentityService.findByPhoneAsSystem applies the identical
// transformation on the phone_primary side.
export function toPhoneDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// Verification binds a PERSON to a HANDSET, not to a name or a date of birth. That is what
// makes it work for the majority of this bot's users, who were registered through the CHW
// quick-registration form and therefore have only a first name and a phone number on file --
// there is no other identifying data to challenge them on. It is also why the check compares
// the inbound address rather than just checking a boolean: if she messages from a phone that
// is not the one she enrolled, her record stays sealed.
export function isChannelVerified(
  person: { whatsappVerifiedPhone: string | null },
  inboundFrom: string,
): boolean {
  if (person.whatsappVerifiedPhone === null) {
    return false;
  }
  const digits = toPhoneDigits(inboundFrom);
  if (digits.length === 0) {
    return false;
  }
  return person.whatsappVerifiedPhone === digits;
}

// Deliberately strict: once whitespace is removed, the WHOLE message must be exactly six
// digits. Two reasons, and the first is a safety property, not a style preference.
// (1) Treating a message as an enrolment code makes it TERMINAL in the webhook controller — it
//     never reaches the danger-sign matcher. A message that is nothing but six digits cannot
//     carry danger-sign language, which is what makes that safe; this is the same argument
//     Task 7 already makes for a bare YES. A looser rule such as "contains a six-digit run"
//     would swallow "I am bleeding 482915" and silently skip the escalation.
// (2) Predictability: the enrolment prompt tells her to reply with just the six digits, and
//     anything else falls through to the router and re-prompts, which restates the
//     instruction. "my code is 482915" is not a silent failure — it is a re-prompt.
export function looksLikeEnrolmentCode(text: string): boolean {
  return /^[0-9]{6}$/.test(text.replace(/\s+/g, ''));
}
