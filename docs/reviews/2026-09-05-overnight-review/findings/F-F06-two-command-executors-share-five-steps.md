# F-F06 — The two command executors spell five of their seven steps twice; the history DTO is built twice

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/commands.ts:69-133` vs `:197-263` — load+fold (`:71-72`/`:199-200`), members+forbidden (`:81-84`/`:206-209`), append+conflict (`:107-121`/`:233-247`, differing only in `origin`), project (`:125-130`/`:250-255`); `TripHistory` literal `commands.ts:49-54` vs `history.ts:25-30`.
- **What is wrong:** the invariant-1 sequence (`command → validate → append → project`) is written twice; a change to the append/projection tail must be made in both.
- **Suggested fix:** `appendAndProject(tx, { tripId, history, events, origin, actorId, members })` used by both executors; a domain `tripHistoryOf(tripId, envelopes)` used by `projectAndHistory` and `getTripHistory`. ~32 lines removed.
- **Scope of the fix:** `commands.ts`, `history.ts`, `packages/domain/src/trip/history.ts`. No contracts. Check subset: `commands.int.test.ts` (all 19 cases, especially `:229` rebuild equality and `:284,:303` batch atomicity), `history.int.test.ts`.
- **Do not:** reorder step 8 (`alsoInSameTransaction`, `:257-260`) relative to projection.
- **Risk:** low-medium — this is the invariant-1 path; keep step order and let the int suite be the proof.
