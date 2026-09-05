# F-E05 — `getTripDetail` still returns the stored doc unparsed, typed by a Drizzle cast; six callers take it raw

- **Stream:** E Maintainability · **Severity:** LOW (latent) · **Confidence:** DOWNGRADED from PLAUSIBLE to "latent trap, no defect today" (verified)
- **Area:** `apps/web/src/server/projections.ts:61-64` (`return rows[0]?.doc ?? null`); `db/schema.ts:94` (`.$type<TripDetail>()` — the compile-time cast that makes the type true without a parse); raw callers `cloneTrip.ts:139,143,152`, `access/shares.ts:142`, `access/invites.ts:193,197,244`, `app/api/trips/[tripId]/members/[userId]/route.ts:39`, and `access/trip-access.ts:92` (the one KI-74 fixed downstream with `safeParse` + logged issues).
- **What is wrong:** KI-53, 71, 73, 74, 88, 92 are one class — "a value crossed a boundary typed but not parsed". KI-74 fixed the seam but left the source returning the lie, so every new caller starts wrong. Today every raw caller reads only day-one, non-defaulted fields (`status`, `members`, `name`), and clone re-reads activities from events, so no reproduction exists — hence LOW.
- **Suggested fix:** make `getTripDetail` return `TripDetail.parse(doc)` (or rename it `readRawTripDoc(): unknown` so the type stops lying), and delete the parse at the seam; comment `schema.ts:94` that `$type` is a cast, not a guarantee.
- **Scope of the fix:** `projections.ts` + 6 callers. No contracts. Check subset: `trip-access.int.test.ts`, `cloneTrip.int.test.ts`, `shares.int.test.ts`.
- **Test that should exist:** an int test that stores a pre-`kind` doc and reads it through `cloneTrip` — seen red first.
- **Cross-reference:** KI-71, KI-74 (resolved), AGENTS.md invariant 5.
- **Do not:** parse in each caller — that is the ad-hoc pattern KI-9 names.
