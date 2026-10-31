# M43 plan — A trip's notebooks keep up with their templates

Milestone: `docs/milestones/M43-notebooks-keep-up.md` (decisions 2–5 answered 2026-10-31).
Deleted in the gate-close commit. Part 0 is `ccr-96adddf8-iksgbh` (prose only, merges last).

Every part targets `main` and merges on its own. **Order:** parts 1 and 3 start together.
Part 2 waits for part 1 on `main` (it reads the Overview through `pages.kind`); part 4 waits for
part 3 on `main` (same widget module). Migration number: **`0070`** (part 1 only; the journal's
last entry is `0069_oauth_and_hmac_secrets`). Part 1's migration is Mitchell's to apply with
`migrate-production` after merge.

## Part 1 — The Overview's identity is a column (D2) · `claude/m43-part1-overview-kind-column`

Theme: `pages.kind` replaces `PageContext.kind`; two Overviews on a trip is a constraint
violation; no person can set a page's kind.

Files and entry points:
- `apps/web/drizzle/0070_*.sql` + `meta/_journal.json`: add `pages.kind text`, backfill from
  `context->>'kind'` choosing one winner per trip as `0032` did, strip `kind` from stored
  `context`, partial unique index `pages_overview_unique` on `(trip_id) WHERE kind = 'overview'`.
- `apps/web/src/server/db/schema.ts:548-579` (`pages`).
- `packages/contracts/src/pages.ts:271-298,340,426,450`: drop `PageContext.kind`, add
  `Page.kind`; never in `CreatePageInput`/`UpdatePageInput`. `docs/contracts/CHANGELOG.md` entry.
- `packages/contracts/src/pageEvents.ts:210` (`seedKeyOf`, legacy events still carry the marker).
- `packages/domain/src/trip/pageState.ts:179,280-284,307-332` (`pageStatesEqual`,
  `undeletableReason`, CreatePage refuses a person-sent kind).
- `packages/pages/src/templates.ts:236-244,589-602` (`buildContext`, `isOverviewPage`,
  `OVERVIEW_KIND`, `isUndeletablePage`), `packages/pages/src/savedTemplate.ts:53-79`.
- `apps/web/src/server/projections.ts:155-161`, `server/pages.ts:73-107,223` (`toSummary`,
  `seededRow`, lazy seed), `server/pageCommands.ts:340,510-537`.
- Both create routes: `app/api/trips/[tripId]/pages/route.ts:39`,
  `app/api/v1/trips/[tripId]/pages/route.ts:73`.
- Readers: `components/lenses/OverviewLens.tsx:46`, `pages/editor/LinkTargetPicker.tsx:83`,
  `lib/overviewPage.ts:31`, `server/tripFirstData.ts:50`, `NotebookScreen.tsx:714`,
  `mocks/handlers.ts:733`, `packages/fixtures/src/bundle/toNotebooks.ts:14`.

Tests: new int test in `server/pages.int.test.ts` — a raw second insert with `kind='overview'`
is refused by the index, and an editor POST with `context.kind='overview'` creates an ordinary
page (both seen red first). Update `defaultNotebooks.int.test.ts`, `pageCommands.int.test.ts`,
`tripFirstData.int.test.ts`, `pages/route.int.test.ts`, `pages/defaults/route.int.test.ts`,
`saved-notebooks/route.int.test.ts`, `undeletablePages.contract.test.ts`,
`packages/pages/src/templates.test.ts`, `packages/contracts/test/pages.test.ts`,
`OverviewLens.test.tsx`, `LinkTargetPicker.test.tsx`, `ResetToDefault.test.tsx`,
`test-support/tripFirstData.ts`. Gate box: *no application code reads `context.kind`* —
`grep -rn "context.kind\|kind: \"overview\"" apps packages --include=*.ts*` shows only the legacy
event reader and the migration.

Preview: open a trip, Overview still first and still undeletable; *Add missing default
notebooks* adds nothing on a complete trip.

## Part 2 — The Overview's title follows the trip (D3) · `claude/m43-part2-overview-title`

Waits for part 1 on `main`.

Theme: an Overview whose stored title is a default reads as `Overview — <trip name>`.

Files and entry points:
- `packages/pages/src/templates.ts`: a pure `overviewDisplayTitle(storedTitle, tripName)`
  (derived when stored is `Overview` or a legacy seed title from `pageEvents.ts:185-189`).
- `apps/web/src/server/pages.ts:73-176,228,144`: `listPages`, `listPageEntries`, `getPage`,
  `demoPageRows` join the trip name and apply it (feeds the app, the public API and MCP
  `list_notebook_pages`/`get_notebook_page`, `app/api/mcp/tools.ts:199-222`).
- `components/.../PageTitle.tsx`: editing an Overview's title starts from the displayed title;
  saving the derived text unchanged must not freeze it (store `Overview` or skip the edit).
- `server/pageCommands.ts:564-607` (reset still writes `Overview`).

Tests: unit for the helper (`templates.test.ts`); int in `pages.int.test.ts` and
`defaultNotebooks.int.test.ts` (trip renamed → title follows; user-renamed Overview kept; reset
derives again); `public-api/surface.int.test.ts` if it pins titles; e2e in
`e2e/m30-notebooks-and-links.spec.ts` (rename the trip, the Overview's title follows).

Preview: rename a trip, its Overview reads `Overview — <new name>`; rename the Overview, it keeps
that name; Reset to default brings the derived title back.

## Part 3 — *What needs you* is the design's rows (D4) · `claude/m43-part3-open-rows`

Theme: `open` emits `{ label, sub, right, tone, act }` items rendered as linked rows.

Files and entry points:
- `packages/pages/src/registry-types.ts:299-355`: a new `Rendered` kind (e.g. `items`) with
  `tone: "warning" | "info" | "plain"` and `act: LinkTarget` (ADR-037 amendment 2026-10-31).
- `packages/pages/src/macros/primitives/open.ts`: rows per conflict (`<label> on <day>`, sub
  `<date> · <city>`, *Fix in Plan*, warning, act = that day in Plan), per empty day
  (`<day> has nothing on it`, *Plan it*, info), and **one** parked row (`N ideas are parked`,
  first two titles, *Place them*, plain); the design's empty line.
- `packages/pages/src/linkTarget.ts`, `blocks/linkHref.ts:19` (reuse; add a target only if the
  backlog has none).
- `apps/web/src/components/.../MacroView.tsx:241+`: render the new kind (tokens for tones; the
  colour wall forbids raw hex), desktop panel and phone sheet.
- `packages/pages/src/presets.ts:621` if the preset's sample changes.

Tests: `macros/primitives/open.test.ts` (seen red against the table), `MacroView.test.tsx`,
`registry.test.ts:41,454`; e2e `e2e/m14-notebook-widgets.spec.ts:1564-1589` (replaces the table
geometry walk) and `e2e/m7-solo-delight.spec.ts:145,232`.

Preview: a trip with an overlap, an empty day and parked ideas — *What needs you* shows the
three row kinds with tints, and each action navigates.

## Part 4 — *What needs you* filters by class and by days (D5) · `claude/m43-part4-open-filters`

Waits for part 3 on `main`.

Theme: a class filter (conflict, empty day, parked) and the `dates` dimension, following the
notebook's date scope when no Days filter is set.

Files and entry points:
- `packages/pages/src/macros/primitives/open.ts`: params (class set + `filterParams` dates),
  `selection` so `followsDateScope` (`dateScope.ts`) applies; remove the "declares no filters"
  comment.
- `packages/pages/src/registry-types.ts:373-400`: a `WidgetInput` for the class set (closed
  vocabulary of three, not `Conflict.kind`), its stored param shape in contracts
  (`packages/contracts/src/pages.ts`, ADR-037 decision 9).
- `packages/pages/src/filters.ts:134,160`, `select.ts:104` (reuse).
- `apps/web/src/pages/editor/widgetBind.tsx:56-74`, `editor/WidgetSettings.tsx` (one component in
  the desktop column and the phone bind sheet), a class control beside `DaysFilter.tsx`.

Tests: `open.test.ts`, `registry.test.ts`, `widgetBind.test.tsx`, `WidgetSettings.test.tsx`,
`dateScope` test; e2e in `e2e/m14-notebook-widgets.spec.ts` for both filters on desktop and phone
(`m14-mobile-notebook.spec.ts` if the phone path lives there).

Preview: open *What needs you*'s settings, hide parked ideas, then pick two days — rows narrow;
on the During-the-trip notebook it follows the date scope.
