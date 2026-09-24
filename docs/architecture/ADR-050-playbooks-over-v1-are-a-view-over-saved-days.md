# ADR-050: Playbooks over v1 are a view over saved days

**Status:** **Accepted — 2026-09-23.** Mitchell approved building Phase 1 ahead
of M12, in the conversation that asked for it.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-048** (a Playbook is a sequence of days — the row this serves),
**ADR-029** (the Library; one insert is one batch and one undo), M22's public
API design (`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`)

## Context

M23 made a Playbook an ordered set of days stored as one `saved_days` row
(ADR-048), and the app can keep several days and apply them to a trip. The public
API could do neither. `POST /v1/library` takes a singular `dayId` on purpose — it
was published before M23 and M23's scope said nothing about `v1` — so an
integrator could keep one day at a time and could not apply anything at all.

Everything needed already existed server-side: `saveDay` takes `dayIds`, and
`insertSavedDay` is the one construction of "append this sequence to a trip" —
one `executeTripCommandBatch`, fresh ids, the adds ledger in the same
transaction, `readableSavedDay` deciding whose Playbooks you may take.

## Decision

1. **`/v1/playbooks` is a second `v1` view over `saved_days` rows**, not a new
   resource. `GET`/`POST` on the collection and `GET`/`PATCH`/`DELETE` on one
   Playbook, with the library's scopes (`library:read`, `library:write`). The
   `POST` body is the contract's own `CreateSavedDayInput` *(superseded by
   decision 6, Pass A, before either was merged)*. Both trees declare
   through one module (`server/public-api/library.ts`), so they cannot drift.
2. **`/v1/library` is frozen as it is.** Same body, same answers, same
   `openapi.json` entries — the regeneration that added `/v1/playbooks` changed
   no line of them.
3. **Applying is `insertSavedDay` over `v1`**:
   `POST /v1/trips/{tripId}/playbook-applications`, `trips:write`, `editor` on
   the destination. Atomic, append-only, one history entry, one undo, fresh ids.
   Somebody else's private Playbook is a 404, as it is in the app.
4. **It answers id lists in Playbook order, not maps.** `dayIds[i]` is the
   Playbook's day `i`; `activityIds[i]` is its `stops[i]`. A `SavedStop` has no
   stable key of its own, so a `{ sourceKey: newId }` map would have to invent
   one — position is the key the DTO already has. The lists are read from the
   batch `insertCommands` built, so they are the ids that landed, not a second
   minting. `historySeq` is that one entry's `toSeq`.

## Rejected

- **A `playbooks` table.** ADR-048 refused a second publishable object type, and
  M12's moderation, reviews and reports all key on `saved_days`. A second table
  is a second place for all of it.
- **Widening `/v1/library` to `dayIds`.** Breaks every existing caller, or leaves
  two shapes for one question — the thing `CreateSavedDayInput` refused for
  itself.

## Pass A — 2026-09-24

Mitchell approved building the deferred phases ahead of the current milestone.
Pass A adds composition, content edits and cross-owner reads to
`/v1/playbooks`. A Playbook is still one `saved_days` row; nothing here adds an
object type.

5. **Two columns, both defaulted.** `saved_days.version` (NOT NULL DEFAULT 1)
   and `saved_days.summary` (nullable), migration `0026`. `SavedDay` gains both
   with `.default()`, so a DTO or row written before them parses as "version 1,
   no summary". A content bundle's `summary` is now stored rather than read and
   dropped.
6. **Creating takes exactly one of two bodies**, a union of two strict objects:
   *from a trip* (`source: { tripId, days: [{ dayId, activityIds? }] }`) or
   *inline* (`days: [{ stops }]`, each stop `SavedStop.omit({ dayIndex })`).
   From a trip, `activityIds` narrows a day to some of its activities, kept **in
   the trip's order**, and an id not on that day is a 400 naming it. This is an
   optional filter on `stopsForDays`, which the app never passes, so the app's
   keep is unchanged. `saveDay` is now `captureDays` + `storeSavedDay`, so the
   API can run a step between them; the app calls the same composition as
   before. `zod-to-json-schema` renders every union as `anyOf`, so the
   reference says "exactly one" in the description rather than as `oneOf`.
7. **An inline Playbook's `source_trip_id` is a freshly minted uuid** naming no
   row, and `source_trip_name` is the caller's `sourceName`, or the Playbook's
   name. The column is NOT NULL and was never a foreign key — it is a snapshot
   (ADR-028/029), and the content importer already stores a declared id that
   names no row. A fresh id per Playbook means no two inline Playbooks claim a
   common source.
8. **Calendar-date anchors are stripped on the way in, in both modes, and
   reported** as `warnings: [{ code: "date-anchor-removed", stopIndex, title,
   message }]`. A Playbook has no dates (ADR-029), and a `dateRange` anchor is a
   date by another name. Weekday, time-of-day and public-holiday anchors
   describe the place and are kept. **The app's keep does not strip them**:
   changing what the UI saves was outside this pass, and doing it silently
   would contradict the warning this API gives. That gap is open.
9. **Content edits are versioned by one guarded UPDATE.** Changing `name`,
   `summary` or `days` requires `expectedVersion`; the UPDATE matches only
   `version = expectedVersion` and sets `version = version + 1` in the same
   statement, so there is no read-then-write window. No match → the row is
   re-read, under the same owner scope, only to say why: 409 `conflict` with
   `details: { currentVersion }`, or 404. A visibility-only patch needs no
   version and bumps none. Replacing days recomputes every derived column
   through `sequenceColumns`, the helper `newSavedDayRow` now uses too, so an
   insert and a replace cannot derive `cities`, `countries` or `day_count`
   differently.
10. **Days can only be replaced while private.** Reviews (M12) rate the
    published content, so replacing it under them would leave ratings on stops
    nobody reviewed. Unpublish, edit, republish. The check is a predicate on the
    same UPDATE, against the stored visibility. Name and summary may change
    while published: they describe the content rather than being it.
11. **`GET /v1/playbooks/{playbookId}` is `readableSavedDay`**: yours, or anyone's
    published and unmoderated Playbook; everything else is the same 404.
    `GET /v1/playbooks` takes `?visibility=` over your own.
12. **`/v1/library` stays frozen, including against the new fields.** It
    declares over `LibraryDay = SavedDay.omit({ version, summary })`, and its
    `PATCH` still takes only `{ visibility }`. Its `openapi.json` entries are
    byte-identical to Phase 1's, and its answers carry neither new key. The
    library and Playbook item routes now share only `DELETE`.

Also: at most 500 stops per Playbook written over `v1` (the 366-day bound was
already there), and `PublicApiError` can carry `details` into the envelope.

## Pass B — 2026-09-24

The apply, finished. `POST /v1/trips/{tripId}/playbook-applications` takes
`{ playbookId, version?, placement?, expectedTripSeq? }`; a bare
`{ playbookId }` still appends exactly as decision 3 describes.

13. **`version` pins the Playbook.** If it is not the stored `version`, 409
    `conflict` with `details: { currentVersion }` and nothing is written. The
    answer carries `playbookVersion`, the version actually applied. The check is
    against the row the insert read, and the insert applies that row's stops, so
    the version reported is the content that landed.
14. **`expectedTripSeq` is threaded into the batch's own concurrency check**, not
    read-then-checked in the route. `executeTripCommandBatch` takes an optional
    `{ expectedSeq }` and compares it with the stream it read inside its
    transaction; the append then insists on that same head, so a stale caller is
    refused (409, `details: { currentSeq }`) and a race after the read still
    loses at the unique index. Internal callers pass nothing and are unchanged.
15. **Placement is `append` (default) or `startingAt: { dayId }`, and
    `startingAt` merges** — Mitchell, 2026-09-24. Playbook day `k` goes onto the
    trip day `k` places after `dayId` via `AddActivity`; only the days that run
    past the end of the trip are added with `AddDay`. Still one batch, one
    history entry, one undo. `dayIds` lists the day each Playbook day landed on;
    `createdDayIds` only the new ones. An unknown `dayId` is a 400 — unless a stale
    `expectedTripSeq` came with it, which is answered first (409): the day may be
    gone because the trip moved.
    `insertCommands` takes the days to merge onto (`[]` = append), so there is
    still one construction of "materialise saved stops into trip days". Merging
    reads the trip's days with the stream head and pins the batch to that head,
    so a day added or removed in between is a 409, never a stop on the wrong day.
16. **`Idempotency-Key`** is honoured here — a generic `route()` opt-in, ADR-051.
17. **`warnings`**, never refusals (invariant 3): `conflict` for each conflict
    the apply introduced that involves a new stop (conflict ids absent from the
    gate's pre-apply read), and `weekday-mismatch` for a stop anchored to
    weekdays that landed on a dated day that is none of them. The engine also
    raises its own `anchor-violation` for that stop, so it arrives as both.
18. **One `api.playbook.apply` log line per outcome** — `ok`, `rejected` with a
    reason, or `replayed` — ids, counts and placement mode, never titles or
    notes.

**Rejected: `afterDay` / inserting between days.** The domain has no positioned
`AddDay` — a day is always added at the end — and adding one is a planning
command change this pass does not make. Merge-only is what the existing
commands can say.

**Coordinates are never replaced on the way in.** The apply runs no geocoder;
`AddActivity` stores the location it is given. The only automatic geocoding
of Playbook stops (`savedDayPins.ts`, M27) fills a stop only when it has no
plausible coordinate.

## Pass C — 2026-09-24

A Playbook as a file, Discover over `v1`, and a keyed create. Still one
`saved_days` row; nothing here adds an object type or a column.

19. **`GET /v1/playbooks/{playbookId}/export` is a `content-bundle/v1` file with
    exactly one entry in `playbooks`**, readable on decision 11's terms. The
    bundle schema never required a trip (`trips` defaults to `[]`), so no
    variant of the format was needed: `PlaybookExportBundle` pins the other
    sections empty, as `TripExportBundle` does for its own, and the converter
    (`playbookToBundle`) lives beside `toPlaybooks.ts` in `@tc/fixtures`. It
    writes the authored `days` form, every day to `dayCount` (rest days as
    `{ stops: [] }`), each stop through the trip export's own `toBundleStop`
    (retyped over the eight fields it reads, so `SavedStop` fits it — no second
    translation). `BundleStop` already carries every `SavedStop` field; the one
    it does not, `dayIndex`, is the day's position. `BundlePlaybook` gains an
    optional `version`.
20. **What the file leaves out:** the adds ledger (other people's activity),
    reviews and rating (other people's words), the source trip's **id** (a
    pointer into somebody's trip history, possibly private — the name is the
    credit and is kept), and `keptOn`. `ownerId` is written: the format
    requires it and every reader of the Playbook already sees it.
21. **A stop the format cannot say is a 409, not a trimmed file.** `SavedStop`'s
    `title` and `notes` are unbounded; `BundleStop`'s are `AddActivity`'s
    (1..200, <= 2000). The export refuses naming the path rather than trimming.
    **[closed before merge]** Pass A's inline `StopInput` first inherited the
    unbounded ones, so such a stop could be written and then neither applied nor
    exported; it now takes `AddActivity`'s `title` and `notes` bounds, so the
    409 is reachable only by a row written some other way.
22. **`POST /v1/playbooks/import` takes one playbook and no trips** (400 naming
    the count otherwise), `library:write`, `Idempotency-Key`. The file is
    content, never authority: owner = the caller, **private** (a `public` file
    adds a `visibility-reset` warning; publishing is a `PATCH`), **version 1**
    (the file's is echoed as `sourceVersion`), a fresh `sourceTripId`, the
    ledger ignored. Its `origin` is kept, as `authorKind` — it only says who
    wrote the words, and an AI-written file uploaded by a person is still
    AI-written; `storeSavedDay` takes an optional `authorKind` for it. The
    stops take the importer's conversion (`toSavedSequence`), then the create
    path's `withoutDateAnchors` and `storeSavedDay` → `newSavedDayRow`, so there
    is still one construction of a row. Not `resolvePlaybook`: it derives ids
    from the bundle's keys, which is right for authored content and would let
    two uploads of one file collide.
23. **`GET /v1/discover/playbooks` is the app's Discover, published only, as
    `DiscoverDay` cards** — the same predicates (`matchPredicate`), the same
    row → card boundary (`toDiscoverDay`), `publishedOnly` so a caller's own
    private Playbooks never appear. **Not `discoverDays` itself**: that answers
    a screen — a 200-row candidate window, the budget band applied after it in
    application code, 24 cards and no way past them — and none of it pages.
    `discoverPage` pages by keyset over `rankKeys`, `orderBy`'s ranking spelled
    as ascending keys; an int test holds the two to one order for every sort.
    The cursor is the last card's `savedDayId`, and the next page ranks after
    that row's keys **as they are now**: no duplicate or skip while the ranking
    holds still, and a day whose counters move between requests can cross the
    boundary — true of any page over a live counter; `newest` holds still.
    **The budget band is not offered** (it cannot be a predicate, and filtering
    a page after the fact would end it early). `city` and `country` take one
    value each: the wrapper reads one value per query key.
24. **`POST /v1/playbooks` takes `Idempotency-Key`** (`idempotent: true`).
25. **The trip export is unchanged.** `tripToBundle`'s `playbooks: []` is right
    for a TRIP file. The proposal asked to replace `TripExportBundle`'s
    `playbooks: maxItems 0` so a Playbook could leave the system as a file; a
    playbook export of its own does that without making a trip file carry
    something a trip import reads past.

## Deferred, and deliberately not done

- **Applying some of a Playbook's days.**
- **`afterDay` / a positioned insert** — Mitchell, 2026-09-24: merge-only
  (decision 15, and the rejection above it).
- **Per-day labels.** ADR-048 keeps a Playbook's days unlabelled; `BundleDay.label`
  is read and dropped on import, and an export writes none.
- **Deprecation headers on `/v1/library`.** Only after its clients have moved to
  `/v1/playbooks`; announcing it before then would warn callers with nowhere
  better to go for the one thing `/v1/library` still does alone (keep by a
  singular `dayId`).

## Consequences

- **A confined token cannot keep a Playbook**, even from a trip it names. Neither
  collection declares `trip`, so `route()` refuses a trip-confined token before
  the handler's hand-written trip gate runs — as it already did on
  `POST /v1/library`. The hand gate's confinement check is reachable only by a
  session today.
- `insertSavedDay` returns `minted` on success. The internal
  `POST /api/trips/:id/saved-days/:savedDayId` picks its own fields and is
  unchanged.
