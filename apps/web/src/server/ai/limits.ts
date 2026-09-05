// Request-size ceilings for the AI entry point.
//
// Extracted here when there were two endpoints, rather than declared twice:
// two doors spending the same key off two copies of the literal 4000 was
// exactly the drift that produced KI-67, and the second copy is the one nobody
// remembers to change. ADR-033 Decision 4 left one door, and these stay in
// their own module anyway — `handleAskRequest` is not the only reader
// (`apiClient` mirrors nothing, but the caps are quoted in the route's error
// strings), and a ceiling is easier to find by name than inside a 700-line
// handler.

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

// Turns kept in one thread — see `@/lib/askLimits` for the number and the
// reasoning. Re-exported here so both AI entry points still read their ceilings
// from one import.
//
// It lives in `src/lib` rather than here because the CLIENT has to know it too:
// this cap was a server 400 with no counterpart in the rail, so the 41st message
// failed the turn with "a thread may hold at most 40 messages" and nothing on
// screen said that New conversation was the way out (final branch review,
// 2026-08-29, finding 2). `src/lib` is the one place UI and server may share a
// value — the same split `authConfig.ts` uses, and for the same reason.
export { MAX_ASK_MESSAGES } from "@/lib/askLimits";

// Total serialized request body. `MAX_PROMPT_CHARS × MAX_ASK_MESSAGES` alone
// would permit 160 KB of text plus every message's parts scaffolding, and the
// per-message cap says nothing about a thread padded with thousands of empty
// parts. Measured on the raw body, before parsing, so a hostile body is
// refused without ever being deserialized.
export const MAX_ASK_BODY_BYTES = 128 * 1024;
