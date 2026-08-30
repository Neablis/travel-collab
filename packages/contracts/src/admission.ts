import { z } from "zod";

// The invite gate's refusal vocabulary (M11a link 6).
//
// Cross-boundary by construction: `apps/web/src/server/admission.ts` produces
// one of these, `recordSignIn` puts it in the `/signin?error=` query string,
// and the front door's copy map turns it into a sentence. Two consumers on
// opposite sides of the UI/server wall means it belongs here as one Zod schema
// with the type inferred, not as a string literal spelled twice (AGENTS.md
// invariant 5).
//
// A closed enum rather than free text is the point: an arbitrary string in the
// `error` query parameter cannot masquerade as a refusal this app produced.

/**
 * Why the gate refused. Exactly three, because there are exactly three things
 * that can be wrong with an admission credential:
 *
 * - `MISSING_INVITE_CODE` — nothing was presented at all.
 * - `INVALID_INVITE_CODE` — something was presented and is not recognised.
 * - `SPENT_INVITE_CODE`   — a single-use code that has already been redeemed.
 *
 * Admission itself is not in this enum: a success is not a refusal, and
 * modelling it as one would let a caller forget to distinguish them.
 */
export const AdmissionRefusal = z.enum([
  "MISSING_INVITE_CODE",
  "INVALID_INVITE_CODE",
  "SPENT_INVITE_CODE",
]);
export type AdmissionRefusal = z.infer<typeof AdmissionRefusal>;
