// Request-size ceilings shared by both AI entry points.
//
// Extracted from handleAiRequest.ts rather than re-declared in
// handleAskRequest.ts: two endpoints spending the same key off two copies of
// the literal 4000 is exactly the drift the "command path is not modified"
// rule exists to prevent, and the second copy is the one nobody remembers to
// change. The command endpoint's behaviour is unchanged — it reads the same
// number from here.

// Ceiling on a single prompt (security review 2026-08-28, H1). The prompt is
// re-sent to the provider on EVERY step alongside the whole envelope, so its
// cost is multiplied by the step budget — an unbounded prompt was an unbounded
// bill on someone else's key. 4,000 characters is ~1k tokens: several
// paragraphs, well past any real "plan me a week in Rome", and small enough
// that many steps of it is not the dominant term next to the envelope itself.
export const MAX_PROMPT_CHARS = 4000;

// /ask is multi-turn, so the same reasoning applies to the THREAD, not just to
// the newest message: every prior turn is re-sent on every step of every
// subsequent turn. Two more ceilings follow from that.

// Turns kept in one thread. 40 messages is ~20 exchanges — far past any real
// sidebar conversation, and the point at which re-sending the whole thread on
// every step stops being cheap. Conversation state is client-held (no
// migration in this plan), so this is the only place it is bounded.
export const MAX_ASK_MESSAGES = 40;

// Total serialized request body. `MAX_PROMPT_CHARS × MAX_ASK_MESSAGES` alone
// would permit 160 KB of text plus every message's parts scaffolding, and the
// per-message cap says nothing about a thread padded with thousands of empty
// parts. Measured on the raw body, before parsing, so a hostile body is
// refused without ever being deserialized.
export const MAX_ASK_BODY_BYTES = 128 * 1024;
