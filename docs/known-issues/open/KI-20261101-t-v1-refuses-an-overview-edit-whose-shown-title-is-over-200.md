### KI-2026-11-01-t — v1 and MCP refuse an Overview edit that sends back its shown title when the trip's name is over 189 characters

- **Severity:** correctness, narrow. A client doing the documented read-edit-write round trip gets a
  400 on an edit that changed only the content.
- **Area:** `apps/web/src/app/api/v1/trips/[tripId]/pages/[pageId]/route.ts` (`V1UpdatePageInput`),
  `packages/contracts/src/pages.ts` (`UpdatePageInput`, `PAGE_TITLE_MAX`).
- **Symptom / What happens:** a trip name may be 200 characters, so the Overview's shown title
  `Overview — <trip name>` can reach 211. `GET` hands that out; a `PATCH` (or MCP
  `update_notebook_page`) sending it back with new content is refused before the handler runs:
  `400 invalid-request`, `too_big … maximum 200 … path ["title"]`. Under 190 characters the title is
  accepted and dropped as no rename (`executePageCommand`, M43 part 2).
- **Why not fixed here:** the refusal is the route's body schema, and the fix brief for PR 662 scoped
  that route to tests only. Relaxing it changes the public API's published body (OpenAPI `maxLength`).
- **Fix path / Tripwire:** give `V1UpdatePageInput` a title without the max, and apply
  `PAGE_TITLE_MAX` in the handler only when the title is not the page's shown one (the page
  `ofThisTrip` already reads carries it), with a CHANGELOG line. Or cap trip names at 189. The
  reproduction is the v1 test in `apps/web/src/server/pages.int.test.ts` with a 200-character
  `CreateTrip` name. Tripwire: any change to `UpdatePageInput` or the trip-name cap.
- **Cross-reference:** M43 decision 3; review of PR 662 at `db8b246`, finding 1 (related edge).
- **First noted:** 2026-11-01, fixing PR 662.
