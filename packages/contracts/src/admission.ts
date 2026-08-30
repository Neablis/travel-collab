import { z } from "zod";

/**
 * Why the invite gate refused an otherwise-valid sign-in (M11a link 6).
 *
 * A closed set, not a string, and that is the point. The code makes a round
 * trip through a URL the browser controls — `server/admission.ts` decides it,
 * `recordSignIn` returns `/signin?error=<code>`, and the sign-in screen reads
 * it back off `?error=`. Anything on that path is untrusted input by the time
 * it is read, so the reader `safeParse`s it against this enum rather than
 * looking it up in a map: an arbitrary string fails the parse and can never
 * reach the copy.
 *
 * Cross-boundary by construction — produced in `src/server`, consumed by the
 * front door — so it lives here as one Zod schema with the type inferred,
 * never a literal spelled twice on either side of the wall (AGENTS.md
 * invariant 5).
 *
 * The three members are the three refusals the gate can actually produce, and
 * they are distinct because the next action differs — get a code, fix the one
 * you have, or ask for a new one. Auth.js's own error codes (`AccessDenied`,
 * `Configuration`, `Verification`, `OAuthAccountNotLinked`) travel on the same
 * query param but are not ours; they stay PascalCase and are handled
 * separately, so the two sets can never be confused for one another.
 *
 * Consumers render exhaustively: `apps/web`'s copy map is typed
 * `Record<AdmissionRefusal, string>`, so adding a member here without writing
 * copy for it is a typecheck failure rather than a screen that silently shows
 * a generic message in production.
 *
 * Admission itself is deliberately not a member: a success is not a refusal,
 * and modelling it as one would let a caller forget to distinguish them.
 */
export const AdmissionRefusal = z.enum([
  // Nothing was presented — no invite code, no pending trip-invite token.
  "MISSING_INVITE_CODE",
  // Presented, but not a code or token this deployment recognises.
  "INVALID_INVITE_CODE",
  // A single-use code that has already been redeemed by someone else.
  "SPENT_INVITE_CODE",
]);
export type AdmissionRefusal = z.infer<typeof AdmissionRefusal>;
