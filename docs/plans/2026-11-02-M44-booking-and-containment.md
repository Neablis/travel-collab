# M44 plan — A stop knows what was booked, and what it sits inside

Milestone: `docs/milestones/M44-a-stop-knows-what-was-booked.md` (decisions D1–D5, answered 2026-11-02). ADR: `docs/architecture/ADR-086-a-booking-is-for-editors-and-containment-is-not-a-conflict.md`.
Part 0 is the prose-only tracking PR on `claude/next-milestone-5o3kip`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `6a6d446`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

One stack (`docs/guidelines/stacked-prs.md`). Every part's PR is a draft; CI runs once, on the
top part's PR retargeted to `main`.

| Part | Branch | Base | PR targets |
|---|---|---|---|
| 1 Containment is not a conflict | `claude/m44-part1-containment` | `main` | `main` |
| 2 `booking` on the contract and domain | `claude/m44-part2-booking-contract` | part 1 | part 1 |
| 3 A code never leaves for a viewer | `claude/m44-part3-booking-redaction` | part 2 | part 2 |
| 4 The editor and the card | `claude/m44-part4-booking-editor` | part 3 | part 3 |
| 5 The booked list | `claude/m44-part5-booked-list` | part 4 | part 4 |

Part 1 is independent of the rest and goes first because it is the smallest. Shared files: none
between part 1 and the others; parts 2–5 build on part 2's contract.

Facts the parts share (the survey, 2026-11-02):
- `flightNumber` (M52) is the template for a new defaulted activity field, end to end:
  `packages/contracts/src/activity.ts:302,456,510,662`, `detail.ts:59`, `saved.ts:135`;
  `packages/domain/src/trip/{decide.ts:273-344, evolve.ts:92-117, equality.ts:101-120, diff.ts:130,159, hydrate.ts:55}`;
  the replay test `packages/domain/test/m52-flight-number.test.ts`; the changelog entry
  `docs/contracts/CHANGELOG.md:527-548`.
- No migration: activities live in event payloads and the `trip_details.doc` projection. Latest
  migration is `0072`; M44 adds none.
- Access: `server/accessPolicy.ts:16` (`RANK`), `:55` (`roleAtLeast`). There is no field-level
  role rule today; part 3 adds the first (ADR-086 decision 2).
- Share views spread every activity field except the ones nulled at
  `server/access/sharedView.ts:50-55`; saved days use the explicit list in `lib/savedStops.ts:41-60`;
  export uses the `StopFields` Pick in `packages/fixtures/src/bundle/fromTrip.ts:87`.
- Public API version: `server/public-api/openapi.ts:42` (`2.0.0`), fingerprint test
  `openapi.test.ts:61-71`; `app/api/v1/openapi.json` is generated.
- Tool-schema size baseline: `server/ai/contextBudget.baseline.json` moves when contract schemas
  change.

## Part 1 — Containment is not a conflict (~6 files)

**Theme.** D4. `time-overlap` is not raised when one window fully contains the other and the
inner stop is at most 120 minutes or tagged `meal`. Nothing about `booking`.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/domain/src/trip/conflicts.ts` | `timeOverlapRule` :97-130, `windowsOverlap` :70 | containment check, using the snapshot's `tags` and `timeWindow` | `packages/domain/test/conflicts.test.ts` |
| `packages/domain/test/conflicts.test.ts` | time-overlap cases :66-150, fast-check :378-500 | property: contained-and-short or meal never warns; partial overlap always warns (seen red with the rule removed) | itself |
| `packages/fixtures/src/` **New** Rochester-shaped fixture (or a factory in `packages/factories`) | — | a three-day trip shaped like `apps/web/scripts/db-seed.ts:156-207`: a meal inside a day-long stop each day | `packages/domain/test/m44-rochester-containment.test.ts` **New** |

Gate boxes: *a short stop inside a long one raises no overlap* (property, seen red); *the
Rochester-shaped fixture produces no `time-overlap` warnings*.

**Preview walk:** on a trip, add a 10:00–17:00 museum stop and a 12:00–13:00 lunch on the same
day: no overlap banner. Move lunch to 16:30–18:00: the overlap banner appears.

## Part 2 — `booking` on the contract and domain (~20 files)

**Theme.** D1, D3. `booking: { confirmation?, provider?, url? } | null` on the contract, the
domain, factories, bundle schema and the contracts changelog, mirroring `flightNumber`. No
redaction (part 3), no UI (part 4).

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/contracts/src/activity.ts` | `AddActivity` :406, `UpdateActivity` :463, `ActivitySnapshot` :576, events :668, :682 | `Booking` schema (url validated, strings bounded), defaulted `null` | `packages/contracts/test/m44-booking.test.ts` **New** |
| `packages/contracts/src/detail.ts`, `saved.ts` | `ActivityView` :59, `SavedStop` :135 | carry `booking` (saved stop: provider only, see part 3) | same |
| `packages/domain/src/trip/decide.ts`, `evolve.ts`, `equality.ts`, `diff.ts`, `hydrate.ts` | as `flightNumber` | set, clear, compare, diff, `?? null` | `packages/domain/test/m44-booking.test.ts` **New** (old log replays equal to stored projection) |
| `packages/factories/src/trip.ts`, `legacy.ts` | :101; :77,95,113 | `booking` defaults | — |
| `packages/fixtures/src/bundle/schema.ts` | :84 | optional `booking` | `packages/fixtures/src/bundle/schema.test.ts` |
| `docs/contracts/CHANGELOG.md` | top | the M44 entry | — |

Full thread for `flightNumber` is in the survey facts above; follow it for every site that
destructures or lists activity fields (`server/cloneTrip.ts:272`, `server/ai/writeTools.ts:220`,
`components/access/previewContext.ts:130`), and regenerate the landing-demo JSON if its check
asks.

Gate box: *a trip replayed from a log written before the change equals its stored projection*.

**Preview walk:** nothing on screen. Verify with the domain replay test and an API
`PATCH /api/v1/trips/{id}/activities/{id}` with a `booking` body returning it.

## Part 3 — A code never leaves for a viewer (~18 files)

**Theme.** D2. One seam, `redactBookingFor(role)`, at every read below editor; share links and
published days drop the code and link; export strips them unless the caller is editor+; the
assistant reads `booked` and `provider` only; public API minor version.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/access/bookingRedaction.ts` **New** | `redactBookingFor` | the seam | `server/access/bookingRedaction.test.ts` **New** |
| `server/tripViews.ts` | member trip read | apply by role | `server/access/trip-access.int.test.ts` |
| `server/access/sharedView.ts` | `toSharedView` :50-55 | drop code and link | `server/access/shares.int.test.ts` |
| `lib/savedStops.ts`, `server/savedDays.ts`, `server/playbooks.ts`, `server/sharedDayView.ts` | `stopsForDay` :41-60, `saveDay` :125, `PublishedDay` :981 | provider at most, never the code | `server/savedDays.stops.int.test.ts`, `server/sharedDayView.test.ts` |
| `packages/fixtures/src/bundle/fromTrip.ts`, `app/api/v1/trips/[tripId]/export/route.ts` | `StopFields` :87, :152 | strip unless editor+ | `server/public-api/export.int.test.ts`, `packages/fixtures/src/bundle/fromTrip.test.ts` |
| `server/public-api/openapi.ts` | `API_VERSION` :42 | minor bump, regenerate `openapi.json` | `server/public-api/openapi.test.ts` |
| `server/assistant/tools/read.ts` | :538-673, :1259 | `booked`, `provider` (fenced) only | `server/assistant/tools/read.test.ts` |

Gate box: *a confirmation number never reaches a share link or a published day* — an integration
test reads both, seen red with the strip removed.

**Preview walk:** as an owner, set a booking through the API; open the trip's share link and a
published day from it: no code. Export the trip as a viewer: no code; as the owner: the code.

## Part 4 — The editor and the card (~12 files)

**Theme.** D1's interaction: a collapsed *Booking* section (Confirmation, Provider, Link) in the
stop editor; a *Booked · Provider* chip on the river card; editor+ tap copies the code or opens
the link; below editor the chip is inert. The milestone's e2e spec.

| File | Entry point | Change | Test |
|---|---|---|---|
| `components/board/ActivityEditor.tsx` | :58, :374, :484-496, :671 | Booking section | `components/board/ActivityEditor.test.tsx` |
| `components/board/activityCommands.ts` | :76, :100, :137, :160 | set and clear | same |
| `components/trip/editor/ActivityEditorSheet.tsx` | :102, :399-402 | Booking section on the phone sheet | `components/trip/editor/ActivityEditorSheet.test.tsx` |
| `components/board/RiverBlock.tsx` | :95-100 | the chip | `components/board/RiverBlock.test.tsx` (**New** if absent) |
| `apps/web/e2e/m44-booking.spec.ts` **New** | — | add a booking, see it on the card, open the share link, see no code | itself, on `test:e2e:ci-like` |

Gate box: *the e2e spec passes on `pnpm --filter web test:e2e:ci-like`* (read on CI on the top).

**Preview walk:** open a stop, expand *Booking*, enter `ABC123`, `Hotel Okura`, a link; save: the
card shows *Booked · Hotel Okura*; tap it: the code is copied. Clear all three: the chip goes.
Open as a viewer: the chip shows, the tap does nothing, the editor shows no code.

## Part 5 — The booked list (~8 files)

**Theme.** D5. `stop.rows { only: "booked" }` beside `needsBooking`, a *Booked* list under
*Still to book* in the templates that carry it; rows show provider, and the code for editor+.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/pages/src/macros/primitives/rows.ts`, `block.ts` | the `only` filter | `booked` | `packages/pages/src/macros/primitives/rows.test.ts` |
| `packages/pages/src/booked.ts` **New** (beside `needsBooking.ts`) | `isBooked` | the rule | `packages/pages/src/booked.test.ts` **New** |
| `packages/pages/src/templates.ts` | :~360, :~480 (*Still to book*) | add *Booked* | `packages/pages/src/templates.test.ts` |
| `packages/pages/src/registry.test.ts`, `writeCheck.test.ts` | — | the new filter value | themselves |

**Preview walk:** with two booked stops on a trip, open the notebook that has *Still to book*:
a *Booked* list below it with both, each with its provider (and the code, as owner).

## Gate

Boxes 2–5 are carried by parts 2, 3 and 1 (unit/integration, each seen red); box 6 reads CI on
the top part's head (`m44-booking.spec.ts`). Mitchell walks the top part's preview: parts 1, 4,
5's walks above, then the share link from part 3.
