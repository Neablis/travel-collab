# M3 design — Place & time

**Date:** 2026-07-09 · **Status:** Approved by Mitchell (decisions 1–7 below)
**Companions:** ADR-006 (conflict evaluation context), ADR-007 (maps &
geocoding commodity), foundation design §4/§6, ADR-005 (compensating events),
`docs/milestones/M3-place-and-time.md`, `AGENTS.md`

## 1. Goal

Turn the board's ordinal days into real calendar dates, and make "place and
time" first-class: three alternate lenses over the same projection (map,
timeline, calendar), and **date-anchored activities** whose constraints become
soft conflicts when the trip's dates move. This is the first milestone that
builds breadth on the M2 substrate — every new behavior (date shifts, anchor
edits) flows through the same one command pipeline and is undo/revert-correct
for free.

Nothing here weakens an invariant: the domain core stays pure (external facts
are injected, never fetched — §4), geocoding is bought commodity confined to
`src/server` (§6), and conflicts stay data (§4).

## 2. Decision log (all explicitly made by Mitchell, 2026-07-09)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | **Day↔date is derived, not stored.** `startDate` pins day 1; every day's date is `startDate + ordinal`. The projection computes it; no new event. Clearing the date makes days ordinal again and anchors **dormant** | store a date per day (redundant, needs its own events); pin an arbitrary day / end-date-driven range (bigger interaction, YAGNI) — noted reversible |
| 2 | **Anchors: a 4-kind union on activities.** `dayOfWeek`, `dateRange`, `timeOfDay` evaluate live to `warn` conflicts; `publicHoliday` ships in the shape but is **inert** in M3 (a permissive stub) | evaluate holidays now (drags in a holiday dataset + the boundary before it's needed); ship fewer kinds (the shape is cheap and forward-useful) |
| 3 | **The pure conflict engine gains an injected `ctx`** (holiday oracle + timezone) so it can evaluate external/temporal facts without I/O — the "time is passed in" precedent (ADR-006) | bundle a holiday dataset into the domain (breaks "depends only on contracts"); fetch inside the engine (breaks purity) |
| 4 | **Anchors ride on the existing activity commands/events** as another snapshot field — undo/revert-correct for free via `diffTripStates` | a separate `SetActivityAnchors` command/event (new event type + new diff logic, no independent lifecycle) |
| 5 | **The derived per-day date is exposed on `TripDetail`**, not recomputed in the UI | UI recomputes from `startDate` (leaks derivation into the client) |
| 6 | **Geocoding is a server-internal `Geocoder` port + pre-command enrichment**; the domain never geocodes. Vendors: **OpenFreeMap** tiles, **LocationIQ** geocoding (ADR-007) | domain-side geocoding (breaks purity); a bundled single vendor with worse storage terms (MapTiler/Mapbox forbid persistence) |
| 7 | **Two things stay out:** the M1 geography rule stays crude (defer travel-time); geocoding is resolve-on-submit (no autocomplete) | cash in the "travel-time in M3" code comment (needs routing + the cross-zone work we deferred); autocomplete (polish) |

## 3. Dates: day ↔ calendar-date derivation

`SetTripStartDate` / `TripStartDateSet` already exist ([trip.ts](../../packages/contracts/src/trip.ts)) — M3 adds **no new event for dates**. It only makes the domain *read* what M1 already stored (its "display-only until M3" comment is retired).

- **`deriveDayDates(startDate, dayCount) → (string|null)[]`** (pure, in
  `packages/domain`): `startDate = null` → all `null`; else day `i`
  (0-indexed) = `startDate + i` calendar days. Plain ISO-date arithmetic — **no
  timezone** (a `YYYY-MM-DD` day date is a calendar fact, not an instant).
- The projection populates `TripDetail.days[].date` from this. Removing a
  middle day shifts later days' dates by one (inherent to ordinal→date) — the
  desired "the rest of the trip slides up" behavior.
- **"Drag the vacation"** = one `SetTripStartDate` to a new value; all days
  re-derive rigidly and the conflict engine re-runs (dates are recomputed on
  every projection, so this is automatic). Undo/revert of a shift is the
  existing M2 machinery with zero additions — `TripStartDateSet` is already
  diffable.
- **Cleared → dormant:** `startDate = null` → date-based anchors produce no
  conflict (see §4 preconditions). No error, no `info` object — just quiet.

## 4. Anchors: shape, evaluation, and the injected context

**Shape** — an activity gains `anchors: Anchor[]` (all must hold; each
unsatisfied anchor is one `warn` conflict). `Anchor` is a discriminated union
on `kind`:

| kind | data | violated when | precondition (else dormant) |
|---|---|---|---|
| `dayOfWeek` | allowed weekdays (e.g. Mon–Fri) | derived weekday ∉ allowed | activity on a day **and** trip dated |
| `dateRange` | `{ from, to }` inclusive ISO dates (`from == to` = a single date, e.g. Halloween) | derived date ∉ `[from, to]` | activity on a day **and** trip dated |
| `timeOfDay` | `{ window: HH:mm–HH:mm }` (e.g. market open 08:00–13:00) | activity's own time window ⊄ this window | activity has a `timeWindow` (date-independent) |
| `publicHoliday` | `{ country: ISO-3166-alpha2 }` | derived date is not a public holiday there | **inert in M3** (see stub below) |

**Evaluation** is a new pure rule registered in
[`conflicts.ts`](../../packages/domain/src/trip/conflicts.ts) alongside the
existing overlap/geography rules. The rule signature for all rules becomes
`(state, ctx) => Conflict[]`, so `detectConflicts(state, ctx)`.

**The injected `ctx`** (ADR-006) — a read-only bag of facts the pure engine
cannot compute itself:

```ts
type ConflictContext = {
  // M3: fed a permissive stub `() => true` so publicHoliday anchors are
  // always satisfied (never a conflict). The rule genuinely calls this, so
  // wiring `date-holidays` later is a one-line swap with no rule change.
  isPublicHoliday: (countryCode: string, isoDate: string) => boolean;
  // M3: hard-coded "America/Los_Angeles"; plumbed but read by no rule yet.
  // Reserves the seam so future time-aware rules don't reshape the signature.
  timezone: string;
};
```

`ctx` is built in `src/server` and passed in — the domain does no I/O and reads
no wall clock, exactly as with time today.

**The anchor-violation conflict** keeps M2's content-derived-id contract so
dismissal works: `kind = "anchor-violation"`, `subjects = [activityId]`,
`id = anchor-violation:<activityId>:<anchorKind>:<paramsDigest>` (stable per
`(activity, anchor)`, **not** encoding the derived date — a dismissal persists
across shifts while the same anchor stays broken, and resurfaces only if the
user edits the anchor). `description` names the day and its derived date for
context; `resolutions` offer "shift the trip's dates / move the activity /
edit the anchor." Severity `warn` — never blocks a write.

## 5. Undo / revert interaction (no new machinery)

Both new state surfaces are already covered by ADR-005's diff:

- **Date shifts:** `TripStartDateSet` is a normal, diffable event. Undo/revert
  of a shift re-derives dates and re-runs anchors automatically.
- **Anchors:** they ride on `AddActivity`/`UpdateActivity`, and
  `ActivityUpdatedV1` is already "a snapshot of the full field set after the
  update" ([activity.ts](../../packages/contracts/src/activity.ts)) that
  `diffTripStates` already emits. Anchors become undo/revert-correct for free
  **provided `equality.ts` includes anchors in its compare** — which also
  makes a same-anchors edit a rejected `no-op` (M2). This is the one place the
  diff/equality code must change; it is a fill-in, not a redesign.

## 6. Geocoding & maps (bought commodity, confined to `src/server`)

Refines ADR-002's one-line maps note; recorded in full as ADR-007.

**Boundary.** Geocoding is a **pre-command enrichment**, not a domain concern.
Flow: user types "Colosseum, Rome" → a server route calls the geocoder →
resolves `{ lat, lng, canonicalName, countryCode? }` → the server issues
`AddActivity`/`UpdateActivity` carrying a fully-resolved `Location`. The pure
domain only ever stores coordinates it is handed — as today. Unlike the
`AccessPolicy` seam (which the pipeline calls), the `Geocoder` port is
**server-internal** (`src/server/geocoding/`) and the domain does not know it
exists.

```ts
interface GeocodeResult { lat: number; lng: number; canonicalName: string; countryCode?: string; }
interface Geocoder { forward(query: string, opts?: { limit?: number }): Promise<GeocodeResult[]>; }
```

- **Adapter:** `LocationIQGeocoder` (env `LOCATIONIQ_API_KEY`; 5k/day free;
  terms permit storing results). Only the adapter knows the vendor; callers
  depend on the interface, so a swap is a one-line wiring change. We store the
  **normalized** `GeocodeResult` (never raw vendor payloads) → a provider
  switch is zero data-migration.
- **Endpoint:** a thin `GET /api/geocode?q=…` returning `GeocodeResult[]`; the
  activity location input calls it, the user picks a result, the chosen
  `Location` rides the normal command. Resolve-on-submit — no autocomplete.
- **Tiles:** **OpenFreeMap** (keyless, no cap, ready MapLibre styles). Pure UI
  concern — a style URL in the map component; OSM attribution shown. Escape
  hatch if its donation-funded uptime ever bites: Protomaps PMTiles on Vercel
  Blob (no code reshaping — still a MapLibre style URL).

## 7. The three lenses (UI, same projection)

All three read the **same** `TripDetail` — no new read models, matching the
foundation's "alternate lenses over the same projections" (§6). Built against
contract-derived MSW mocks first, then wired — the M1/M2 pattern.

- **Map** (MapLibre GL JS + OpenFreeMap): a pin per located activity;
  fit-bounds to the trip; day grouping surfaced (e.g. color/label). Activities
  without coordinates are listed off-map.
- **Timeline:** days in derived-date order along an axis; timed activities
  placed by their `timeWindow`; untimed activities stacked under their day.
- **Calendar:** a month/multi-week grid; each trip day sits in its derived-date
  cell with its activities; a start-date control (and drag-to-shift as the
  target affordance) issues `SetTripStartDate` — this is where "drag the
  vacation" lives. Clearing the date returns the trip to ordinal days.
- **Anchor editing** on the activity: add/remove anchors per kind; violations
  render in the **existing** conflict banner/list and are dismissable via the
  existing M2 `DismissConflict`.

## 8. Contracts surface (additive; one changelog entry)

- `activity.ts`: add `Weekday` + `Anchor` union; `AddActivity` /
  `UpdateActivity` gain `anchors` (omitted = unchanged; an explicit array
  replaces the whole set, `[]` clears); `ActivityAddedV1` /
  `ActivityUpdatedV1` payloads gain **`anchors: z.array(Anchor).default([])`**
  — the default makes previously stored events (which lack the field) parse as
  empty, so `TripEvent.parse` still accepts all prior events (non-breaking,
  upcasting-lite). `Location` gains `countryCode?` (ISO-3166-alpha2).
- `detail.ts`: `ActivityView` gains `anchors: Anchor[]`; `TripDetail.days[]`
  gains `date: string | null`.
- `conflict.ts`: unchanged — `anchor-violation` is just a new `kind` value.
- **No new commands or events.** Dates reuse `SetTripStartDate` /
  `TripStartDateSet`; anchors reuse the activity events.

## 9. Server & API

- **`ConflictContext`** built in `src/server` (`isPublicHoliday: () => true`,
  `timezone: "America/Los_Angeles"`) and threaded into every `detectConflicts`
  call site (projection step 7). No change to append or optimistic concurrency.
- **Projection** computes `TripDetail.days[].date` via `deriveDayDates`.
- **`src/server/geocoding/`**: the `Geocoder` port + `LocationIQGeocoder`
  adapter + the `/api/geocode` route. The only new I/O in M3.

## 10. Testing

- **Property (fast-check):** `deriveDayDates` — shift `+N` then `−N` is the
  identity on derived dates, length preserved; anchor evaluation for the three
  live kinds; `diffTripStates` round-trip **with anchors present** (undo/revert
  reproduces state exactly, anchors included).
- **Golden rebuild (extended):** a log with start-date shifts and anchored
  activities drops-and-rebuilds to identical state, conflicts included.
- **Contract:** new schemas validate; old stored `ActivityAdded/Updated`
  events still parse (the `.default([])` guarantee); MSW mocks regenerate.
- **Integration:** the `LocationIQGeocoder` adapter (mocked HTTP); the
  projection computes dates; a date shift recomputes anchor conflicts; the
  `/api/geocode` route.
- **E2E (Playwright), one new script:** the §gate demo flow. M0/M1/M2 scripts
  stay green untouched.

## 11. Out of scope

`publicHoliday` live evaluation (inert stub; wire `date-holidays` later);
per-activity IANA timezones and cross-zone / travel-time math (the geography
rule stays the M1 distance heuristic — its "belongs in M3" comment is updated
to point past M3); arbitrary-day pinning / end-date-driven ranges; geocoding
autocomplete/typeahead; external calendar sync (M9); costs (M4); realtime (M6);
trip rename/delete; styling beyond functional defaults.
