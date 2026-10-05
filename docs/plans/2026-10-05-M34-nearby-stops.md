# M34 — nearby stops in the add-stop sheet: build plan

Gate: `docs/milestones/M34-nearby-stops.md` § *Exit gate*. Decisions are numbered there and cited
here as D1–D15. Delete this file at M34's gate close (`docs/plans/README.md`).

## The stack

Three parts, each on its own branch, merged 1 → 3 with merge commits
(`docs/guidelines/stacked-prs.md`). All open as drafts. **Nothing merges without Mitchell.**

| Part | Branch | Theme | Tier |
|---|---|---|---|
| 1 | `claude/charming-tesla-8d0oj7` | M33 closed, M34 minted, this plan | 1 (prose) |
| 2 | `claude/charming-tesla-8d0oj7-server` | contract, ranking, query, route, client function, mock | 2 |
| 3 | `claude/charming-tesla-8d0oj7-ui` | the sheet lists, filters and fills; Preview retired; e2e | 2, then 3 on the top |

Part 2 is based on part 1 and part 3 on part 2. **On the preview, what does a person click to
see this?** Part 2: nothing (a route and no screen, so its body says so). Part 3: Add a stop on a
day in a city the library covers.

## What is true today

Surveyed 2026-10-05. Re-check the line numbers before trusting them.

- **The placeholder**: `apps/web/src/components/board/ActivityEditor.tsx:74-80`
  (`SUGGESTED_MATCH_SHAPE`) and `:285-305` (`<Preview id="add-stop-suggestions">`). Registry
  entry: `apps/web/src/lib/preview-registry.ts:101`. `preview-registry.test.ts` fails on an
  unused registered id and on a used unregistered one. `components/ui/preview.test.tsx:31-118`
  uses `add-stop-suggestions` as its fixture id; it moves to `wizard-assistant-draft`, the only
  entry left.
- **The editor's one production caller** is `components/trip/editor/ActivityEditorSheet.tsx:189`.
  The sheet has `useTrip().activeTrip` (`TripDetail`) and `useEditor().state.prefill`
  (`{dayId?, location?{name,lat?,lng?}, timeWindow?}`). The editor itself gets no trip id.
  Openers: `Board.tsx:669` (a day), `TripHeader.tsx:382` (no day), `MapLens.tsx:500` (a
  coordinate, no day).
- **Editor state**: `setTitle`, `setLocation`, `setKind`, `setTags`, `setDurationLabel`
  (`ActivityEditor.tsx:123-195`). "How long" exists only in create mode (`:352-366`). The extra
  "drawn" option (`DRAWN`, `drawnOption`, `:72`, `:136-141`) is derived from
  `initial.timeWindow`, not held in state. `DURATION_OPTIONS`, `closestDurationLabel` and
  `durationMinutes` are in `board/activityDuration.ts`.
- **Contracts**: `Location` (`packages/contracts/src/activity.ts:81-160`; `lat`/`lng` as a
  pair, `city`, `countryCode`, `precision` `venue|area|city`). `SavedStop`
  (`saved.ts:56-135`) has no duration; length is `timeWindow.end - start`.
  `SavedDayVisibility` is `private | public`.
- **The library**: `saved_days.cities` is `text[]` with a GIN index (`db/schema.ts:596`, `:744`),
  written at save time by `citiesOfSequence`. The published filter is spelled in
  `server/playbooks.ts`: `notDeleted` (`:225`), `notModerated` (`:239`),
  `d.visibility = 'public'`, and `d.cities && ${sql.param(cities)}::text[]` (`:289-321`; **use
  `sql.param`**, a bare array becomes one placeholder per element). Rows are parsed with
  `parseSavedDayColumns` (`server/savedDayRow.ts:88`), which drops and logs a bad row.
- **Cities of a trip day**: `citiesOfDay(detail, dayIndex)` in `@tc/domain`
  (`packages/domain/src/trip/cities.ts:213`), the rule Discover uses. Server code may import
  `@tc/domain`; the UI may not.
- **Distance**: `haversineKm` in `@tc/domain` (`trip/conflicts.ts:75`) for the server.
- **Trip access**: `requireTripAccess(tripId, "viewer", …)` as in
  `app/api/trips/[tripId]/globals/route.ts:20`. It returns `{ error }` or the access with
  `detail` and `userId`.
- **Client**: typed functions in `lib/apiClient.ts` returning `ApiResult<T>`; `searchPlaces`
  (`:895`) is the model. No react-query.
- **Mocks**: `mocks/handlers.ts` factory functions (`makePlaceSearchHandler`, `:801-812`).
  `server/public-api/exposure.ts` needs a key per route directory (`exposure.test.ts:91`).
- **Tests to copy**: `server/playbooks.places.int.test.ts:19-31` inserts saved-day rows
  directly (public, moderated, deleted, private variants). `app/api/places/route.int.test.ts`
  builds through the real routes with `vi.mock("@/server/auth")`.
  `ActivityEditorSheet.test.tsx` mocks `@/lib/apiClient` with `vi.mock`, so a new client
  function needs an entry there. The network guard rejects any unhandled fetch.
- **E2E specs that type into "What or where"**: `m1-board.spec.ts:30,43`,
  `m2-history.spec.ts:47`, `m3-place-and-time.spec.ts:81`, `m4-money-and-lenses.spec.ts:44`,
  `m8-make-it-real.spec.ts:68`, `suggester.spec.ts:103`, `m14-notebook-widgets.spec.ts:110`.
  The list must not cover a control they click next.

## Part 2 — server

### 2.1 Contract (`packages/contracts/src/nearbyStops.ts`, exported from the index)

```ts
export const NearbyStop = z.object({
  title: z.string(),
  location: Location,               // a candidate always has a place
  kind: ActivityKind,               // planned | pending (D7: never transit)
  tags: z.array(ActivityTag),
  lengthMinutes: z.number().int().positive().nullable(), // null: the stop had no time window
  savedDayId: z.string().uuid(),    // the published day it was taken from (D10)
  savedDayName: z.string(),
  playbookCount: z.number().int().positive(), // published days carrying the same stop (D9)
  distanceKm: z.number().nonnegative().nullable(), // null: not ranked by distance (D1)
});
export const NearbyStopsResponse = z.object({ stops: z.array(NearbyStop).max(40) });
```

Plus a `docs/contracts/CHANGELOG.md` entry (added, not breaking; consumer: `apps/web`). Check the
real names of the kind and tag schemas in `activity.ts` before writing this. `kind` is the
**current** kind enum, not `StoredActivityKind`: the parse at read has already mapped retired
kinds.

### 2.2 Ranking (`apps/web/src/server/nearbyStops.ts`, pure part)

`rankNearbyStops(input)` is pure (no I/O, no clock), so it is unit-tested without a database.

Input: the candidate days (`{ savedDayId, name, stops: SavedStop[] }[]`, already filtered by the
query to public, not deleted, not moderated, not the reader's), the cities to match, an optional
anchor `{lat, lng}`, and the titles already on the day.

Rules, in order:
1. Keep a stop only if its `location?.city` is one of the cities (case-insensitive) and it has a
   location (D1).
2. Drop `kind === "transit"` (D7).
3. Drop a stop whose title matches one already on the day, case-insensitively and trimmed (D8).
4. Collapse duplicates by `(title, location.name)`, case-insensitive. Keep the first day's
   copy, preferring a copy with venue/area coordinates, and count distinct days (D9).
5. `distanceKm` = haversine(anchor, stop) when there is an anchor, the stop has `lat`/`lng`, and
   `precision !== "city"`; otherwise null (D1).
6. Sort: non-null distance ascending first, then null; ties by `playbookCount` descending, then
   title (stable and deterministic).
7. Take 40 (D5). `lengthMinutes` comes from the time window, using the codebase's
   end-of-day rule (`toEndMinutes`: a stop ending 23:59 counts to midnight) if one is
   reachable from server code; otherwise plain end minus start, and say so.

**Unit tests (`nearbyStops.test.ts`), each seen red.** For each rule, a mutation and the
failure it produced go in the PR body:
- another city's stop excluded; a stop with no location excluded;
- transit excluded;
- a stop already on the day excluded, regardless of case;
- duplicates collapse to one with `playbookCount: 2`;
- closest first, and a `precision: "city"` stop gets `distanceKm: null` and sorts after a
  venue stop that is further away;
- the 40 cap;
- `lengthMinutes` from the window, null with no window.

### 2.3 The query (same file, I/O part)

`nearbyStopsFor({ detail, dayId, anchor, readerId })`:
1. Day: `detail.days` by `dayId`. Cities = `citiesOfDay(detail, index)`; if empty (or no day),
   use the trip's cities (the union over days, the same rule). If still empty, return `[]` with
   no query.
2. Anchor: an explicit `lat`/`lng` wins. Otherwise use the centroid of the day's stops that have
   venue/area coordinates. Otherwise none.
3. SQL: `select id, name, stops, visibility, author_kind, day_count from saved_days d where
   d.visibility = 'public' and d.deleted_at is null and d.moderated_at is null and d.owner_id
   <> ${readerId} and d.cities && ${sql.param(cities)}::text[] order by d.published_at desc
   nulls last limit 200`. Reuse the `notDeleted`/`notModerated` fragments if they can be
   exported without churn; otherwise spell them the same way and cite them.
4. Each row goes through `parseSavedDayColumns`. A row that fails is skipped, as Discover does.
   Then `rankNearbyStops`.

A reader who is not signed in (`demo-visitor` / `invite-visitor`) still gets an id from
`requireTripAccess`. Excluding that id is harmless. Check what `access.userId` is for those
readers, and write it down in the code.

### 2.4 Route `app/api/trips/[tripId]/nearby-stops/route.ts`

`GET ?dayId=<uuid>&lat=<n>&lng=<n>` (all optional; `lat` and `lng` as a pair, else 400).
`requireTripAccess(tripId, "viewer", { allowDemo: false, inviteToken: inviteTokenOf(request) })`,
then `NearbyStopsResponse.parse(...)` before responding. Validate the query with zod. Register
`"trips/[tripId]/nearby-stops": PLANNED("Undecided — library stops near a trip day (M34)")` in
`exposure.ts`.

**Integration tests (`route.int.test.ts`, real Postgres), each seen red:**
- another user's public day in the day's city: its stop is returned;
- the same stop in a private, a deleted and a moderated day, and in the reader's own public
  day: not returned;
- a public day in another city: not returned;
- a non-member: the trip-access refusal (the status `requireTripAccess` gives).

Build the trip with `executeTripCommand` and `locationFactory.build({ city })`, as
`places/route.int.test.ts` does. Insert saved days directly, as `playbooks.places.int.test.ts`
does. Clean up in `afterAll`.

### 2.5 Client and mock

- `fetchNearbyStops(tripId, { dayId?, lat?, lng? }): Promise<ApiResult<NearbyStopsResponse>>` in
  `lib/apiClient.ts`, shaped like `searchPlaces`.
- `makeNearbyStopsHandler(stops)` in `mocks/handlers.ts`, and a default handler returning
  `{ stops: [] }` if the default handler list needs one. Check how the place-search handler is
  registered.

**Part 2's check subset** is the `minimal-check-subset` skill's output. A contracts change
widens it (the skill says not to narrow under `packages/contracts/src`). Expect `pnpm check`
for this part, or say why not.

## Part 3 — UI

### 3.1 Wiring (`ActivityEditorSheet.tsx`)

In create mode only (D12), the sheet calls `fetchNearbyStops(activeTrip.tripId, { dayId:
prefill?.dayId ?? defaultDayId, lat/lng: prefill?.location })` once on mount, and passes the
result to the editor as a new optional prop: `nearbyStops?: NearbyStop[]`, defaulting to `[]`, so
existing callers and tests are unchanged. A failed fetch is an empty list: suggestions are a
convenience, and a failure must not block adding a stop. Guard against a late response after
unmount. Should the list refetch when the Day select changes? It is better if it does, but
only if that is cheap to do cleanly. Otherwise leave it, and record the limit in the PR
body.

### 3.2 The list (`ActivityEditor.tsx`)

- Replace the Preview block. With `nearbyStops` empty, render **nothing** (no empty state, so
  the existing e2e flows see no new element).
- Visible while the title does not equal a picked stop's title. Picking hides it until the
  title is edited again.
- With the title empty: the first 4. While typing: stops whose `title` or `location.name`
  contains the typed text (case- and accent-insensitive: `normalize("NFD")` and strip marks),
  first 6. No match: render nothing.
- A row is a button: the name, then one muted line: `<place> · <length> · from "<day name>"`,
  plus ` · in N playbooks` when N > 1, and the distance when non-null (`0.4 km`). Label the list
  `aria-label="Nearby stops from the library"`. Keep the design's existing row markup and
  tokens from the placeholder (`ghost` Button rows, `divide-hairline`); no new colours.
- **A pick** (D2): `setTitle(stop.title)`, `setLocation(stop.location)`, `setKind(stop.kind)`
  (and the pending default reason if the form needs one for `pending`), `setTags(stop.tags)`,
  and the length (D11). Start time and cost are untouched.
- **D11, the length**: if `lengthMinutes` matches one of `DURATION_OPTIONS`, choose it.
  Otherwise add the same extra option M29 adds for a drawn length, and choose it. This means
  `drawnOption` must come from state (or a picked length) instead of `initial.timeWindow`
  alone. Keep M29's behaviour exactly: a drawn prefill must still produce its option. If
  `lengthMinutes` is null, leave the length as it is.

### 3.3 Retire the Preview

Delete the registry entry, leaving a one-line comment in the registry's existing style that
says M34 replaced it. Delete `SUGGESTED_MATCH_SHAPE` and its comment. Move
`preview.test.tsx` to `wizard-assistant-draft`. (`M9-ai-planning-partner.md:516` was already
updated in part 1.) **Do not edit `.design-sync/**`** (a build input; AGENTS.md's Tier 1 trap). Note
`.design-sync/handoff/DRIFT.md:178` in the PR body instead.

### 3.4 Tests

- **`ActivityEditor.test.tsx`**, each seen red:
  - no list when `nearbyStops` is empty;
  - the first 4 shown with an empty title;
  - typing filters by name and by place, accent-insensitively;
  - a pick fills title, location, kind and tags, keeps the start time and cost untouched, and
    the saved value (via `onSave`) carries them;
  - a 90-minute pick saves a 90-minute window (D11);
  - a drawn prefill still shows its option (an M29 regression guard);
  - no list in edit mode.
- **`ActivityEditorSheet.test.tsx`**: mock `fetchNearbyStops`. Create mode calls it with the
  day; edit mode does not; a rejected fetch still renders the form.
- **E2E `apps/web/e2e/m34-nearby-stops.spec.ts`**: sign in as user A and publish a day with a
  stop in a city (use whatever helper existing library specs use to publish; find one before
  writing one). Sign in as user B, make a trip whose day has a stop in that city, open Add a
  stop on that day, see A's stop in the list, pick it, Save, and the board shows the stop
  with its place. **Run it only on `pnpm --filter web test:e2e:ci-like`** (CLAUDE.md rule 1),
  along with the add-stop specs listed above.

## Done means

- Part 2 and part 3 each have their check subset recorded, each test seen red with the
  mutation and the failure text, and the PR template filled in.
- Tier 3 runs once on part 3 (the top): `pnpm check`, and the ci-like e2e for the specs listed.
  The result is recorded in part 1's body (stacked-prs §5).
- The gate boxes the stack satisfies are ticked with evidence, on part 3. The walk box stays
  Mitchell's.
- When a part's code is final and its CI is green, mark it ready and comment
  `@coderabbitai review`. Mitchell asked for that on 2026-10-05. Then push nothing to that part
  for ~21 minutes. Nothing merges.
