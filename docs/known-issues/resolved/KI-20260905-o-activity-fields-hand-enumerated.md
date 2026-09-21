### KI-2026-09-05-o — activity fields are hand-enumerated in ~21 files; nothing went red when one was missed — RESOLVED

- **Severity (as filed):** correctness (a recurrence class that had already bitten three times, each time as a silently dropped field)
- **Area:** `packages/contracts/src/activity.ts`, `packages/contracts/src/detail.ts`, `packages/domain/src/trip/state.ts`, `packages/domain/src/trip/equality.ts`.
- **Symptom (as filed):** every new activity field had to be added by hand at ~21 sites and **nothing went red when it was not**. The class had shipped three times with the same shape: KI-1 (day order), KI-54 (`city`/`countryCode` invisible to equality, so city-only edits were rejected as a no-op), and M18's editor sheet dropping `kind`/`tags`. Scheduled on 2026-08-28 as "one overnight batch", never built, and filed only on 2026-09-05 because it was in neither the register nor `TODO.md`.

- **Fix (2026-09-21):** the entry's own proposed fix, in two halves.

  1. **`ActivitySnapshot`** — the eight stored fields declared once as an exported `z.object` in `activity.ts`, same validators, same nullability, same `.default()`s, **same key order** as the private `ActivityPayloadFields` it replaces. Both event payloads `.extend(ActivitySnapshot.shape)`; `ActivityState` is `z.infer<typeof ActivitySnapshot>` instead of a hand-written mirror.
  2. **`FIELD_EQUAL`** in `equality.ts` — a `{ [K in keyof ActivityState]: (a, b) => boolean }` mapped record replacing the boolean chain, so a ninth field is a **missing-key compile error** in the one function whose silence caused KI-54.

- **Seen to fail** (CLAUDE.md rule 3), which for this entry is the whole deliverable — the fix IS a compile error, so proving it fires is proving the fix. A ninth field (`bookingRef`) was added to `ActivitySnapshot` and `tsc --noEmit` run:

  ```
  src/trip/equality.ts(91,7): error TS2741: Property 'bookingRef' is missing in type
  '{ title: …; timeWindow: …; location: …; … 4 more …; }'
  but required in type '{ …; bookingRef: (a: string | null, b: string | null) => boolean; }'.
  ```

  Every derived site went red with it: `contracts/src/detail.ts` (the parity assertion below), `domain/src/trip/{decide,diff,equality,evolve,hydrate}.ts`, `factories/src/{legacy,trip}.ts`, `ActivityEditorSheet.tsx`, `mocks/handlers.ts` and ~27 test files. Reverted; `grep -c bookingRef` → 0.

- **`ActivityState`'s identity was proven, not assumed.** A throwaway module held the pre-change hand-written type verbatim and asserted `Equals<Old, ActivityState>` with the `<T>() => T extends X ? 1 : 2` trick — which *does* distinguish `k?: T` from `k: T | undefined`. It compiles; flipping the assertion to `false` errors, so it is not vacuous. Four negative controls (optional `kind`, nullable `kind`, missing `cost`, extra `placeRef`) all correctly evaluate `false`. Confirmed directly that `z.infer` is the OUTPUT type, so `.default()` resolves to non-optional.

- **The read model was deliberately NOT derived, and this is the one place the fix is weaker than the entry proposed.** Deriving `ActivityView` was built and measured, then backed out on Mitchell's call. `ActivitySnapshot` carries write-path bounds the read model does not (`title` 1..200, `notes` ≤2000), and `getTripDetail` parses `trip_details.doc` straight off jsonb — so a stored value violating one would not fail a write, it would **500 the board on read**. That is the #71 shape (a required `kind` taking out every untouched pre-M18 trip), one field later. Measured, the derivation moved `ActivityView`'s parse behaviour five ways: `cost` and `anchors` absent became permissive; `title` empty, `title` >200 and `notes` >2000 became failures.

  Instead `detail.ts` carries `ActivityViewCoversSnapshot`, a key-parity type assertion. It fires on the same ninth field (`src/detail.ts(59,3): error TS2344: Type 'false' does not satisfy the constraint 'true'.`) with **zero** behaviour change. **Weaker in exactly one stated way:** it forces the key to exist, not that its type matches the contract's.

- **`SavedStop` is a deliberate non-target**, noted in `ActivitySnapshot`'s doc comment so nobody "tidies" it later. It looks like the same eight fields but its header states a different rule (every field added from 2026-09-19 carries `.default()`) and its `kind`/`tags` are required, not defaulted; deriving it would change how already-saved `saved_days.stops` jsonb parses.

- **Wire identity measured, not argued.** A fingerprint harness parsed the same inputs against `ActivityAddedV1`, `ActivityUpdatedV1`, `ActivityView` and `SavedStop` before and after: zero diff on all four. `openapi.json` regenerates byte-identical. No migration.

- **Check subset:** typecheck across all seven packages; `@tc/domain` 240, `@tc/contracts` 310, `@tc/fixtures` 102, `@tc/factories` 360, `@tc/pages` 172, web unit 3457/1 skipped, `scripts` 280; `pnpm seed:verify`; `pnpm lint`; `pnpm --filter web test:int` 793. Full Tier-3 `pnpm check` and `test:e2e:ci-like` on the branch — see the PR.

  One environmental failure on the way, recorded rather than retried past: the integration lane first came back 86 failed / 700 passed on `ApiTokenPepperMissingError`. Per CLAUDE.md rule 2 that was grepped before it was theorised about — **KI-2026-09-19-a**, a freshly bootstrapped local env with no `API_TOKEN_PEPPER`, with the probe in `docs/guidelines/cloud-agent-sessions.md:208-218`. Passed through the environment rather than by editing `.env.local`; 793/793 after.

- **Unblocks M13.** This ran as M13's stated prerequisite — link 5 adds `who` to an activity, and `docs/milestones/M13-collaboration.md`'s gate carries a box for this entry. It is shared with M24 and M19 link 1.

- **Found by:** a read-only overnight review, 2026-09-05 (streams E + F). **Scheduled and skipped:** 2026-08-28. **Resolved:** 2026-09-21.
- **Cross-reference:** [F-E01](../../reviews/2026-09-05-overnight-review/findings/F-E01-activity-fields-hand-enumerated.md) (also filed as F-F01), resolved KI-1, resolved KI-54, the 2026-08-28 review §6.1, `docs/milestones/M18-stop-kind.md:261-275`, `docs/milestones/M13-collaboration.md`, `docs/contracts/CHANGELOG.md` (2026-09-21).
