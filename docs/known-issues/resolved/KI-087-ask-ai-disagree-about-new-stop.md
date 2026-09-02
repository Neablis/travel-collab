### KI-87 — `/ask` and `/ai` disagree about a new stop's default `kind`, so the same model behaviour reads as unbooked on one door and booked on the other — RESOLVED
- **Severity:** cleanup (a recorded inconsistency between two AI doors, not a defect on the one that matters today)
- **Area:** `apps/web/src/server/ai/writeTools.ts` (`withDefaultKind`, `buildProposal`, `parseApprovedCommands`), `apps/web/src/server/ai/handleAiRequest.ts`, `apps/web/src/server/ai/batchResolver.ts`
- **The behaviour:** a stop created through `/ask` (the assistant's write tools) defaults to `hold` when the model states no `kind`, so it counts toward the Calendar's `N to book` (KI-86). The same stop created through the older `/ai` command endpoint still defaults to `planned`, and does not count. Two AI doors, two different answers to "did I just create something that needs booking" for the identical model output.
- **Why it is that way:** `handleAiRequest.ts` calls `resolveBatch` directly and never reaches `writeTools.ts`, so `withDefaultKind` — applied in `buildProposal` and again in `parseApprovedCommands` — never runs on that path. The seam that would fix it in one place, `batchResolver.ts` (`resolveBatch`), is deliberately pinned while M16/M9 is in flight: ADR-022 §4 requires the command path to stay untouched so write-tool work doesn't quietly reshape the endpoint both `/ai` and `/ask` share.
- **Why it is not urgent:** `/ai` is the older path — the assistant rail no longer calls it. `/ask` is what a user reaches today, and it already carries the fix.
- **Fix path:** whichever seam is right once the pin lifts, most likely `resolveBatch` itself so both doors agree by construction rather than by two independent copies of a default. `withoutFabricatedCost` (the zero-cost fix, M9) has the same `/ai`/`/ask` split already, for the same reason — worth closing both in the same pass.
- **Cross-reference:** KI-86 (the `needsBooking` rule a stop's default `kind` feeds), ADR-022 (the pin this is waiting on).
- **First noted:** 2026-08-29, while implementing M16/M9's create-time `kind` default. **Closed:** 2026-09-02.
- **Closed by construction, not by a fix (ADR-033 Decision 4).** There is no
  second door left to disagree with: `handleAiRequest.ts` and
  `POST /api/trips/:id/ai` are deleted, and every write the assistant makes goes
  through `writeTools.ts` — so `withDefaultKind` runs on the only path there is.
  Nothing in `writeTools.ts`, `batchResolver.ts` or `resolveBatch` changed; the
  entry closes because the divergent caller is gone.
- **What would reintroduce it:** a second caller of `resolveBatch` that skips
  `buildProposal`/`parseApprovedCommands`. The default still lives in
  `writeTools.ts` rather than in `resolveBatch`, so the fix path above remains
  the right one if that ever happens — `writeTools.ts` carries a note saying so.
- **The sibling did NOT close with it.** `withoutFabricatedCost` (KI-82) was
  filed as having "the same `/ai`/`/ask` split"; that half of it is gone for the
  same reason, but KI-82's own substance — the assistant cannot mark a stop free
  — is unrelated to the doors and stays open.
