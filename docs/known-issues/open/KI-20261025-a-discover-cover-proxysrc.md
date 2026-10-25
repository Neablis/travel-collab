### KI-2026-10-25-a — Discover cards would show a URL cover as none: their read never mints `proxySrc`

- **Severity:** latent. Nothing is wrong today, because no saved day can hold a URL cover yet
  (ADR-081 item 7 gives saved days no URL setter). It becomes a visible defect the day one can.
- **Area:** `apps/web/src/server/playbooks.ts` (`discoverColumns` and every `db.execute<DiscoverRow>`
  read), `apps/web/src/server/savedDayCovers.ts` (`SAVED_DAY_COVER_JSON`),
  `apps/web/src/server/coverRows.ts` (`coverJson`, `withProxySrc`), `apps/web/src/server/discoverDay.ts`.
- **Symptom / What happens:** a URL cover reaches a browser only through its signed same-origin
  path, `proxySrc`, and a URL cover without one renders as no cover. `coverRows.ts` mints it in
  `coverJson`'s `.mapWith`, which drizzle runs only when it decodes a typed `select`. Discover
  embeds `SAVED_DAY_COVER_JSON` in raw `db.execute` SQL, where `mapWith` never runs, so a
  playbook day's URL cover would come back as the bare jsonb and every Discover card, profile and
  landing card would show it as none.
- **Why not fixed here:** M49 part 2 (PR 584) adds URL covers for trips only. Minting in the
  Discover read now would be code for a row that cannot exist.
- **Fix path / Tripwire:** whoever adds a URL setter for saved days (or playbook-day URL covers
  through the content importer) must, in the same change, pass Discover's `cover` through
  `coverRows.ts`'s `withProxySrc` (export it, or decode the row through `coverOf`) in
  `toDiscoverDay`, and add an int test that reads a URL-covered day back from `discoverDays` with a
  verifiable `proxySrc`.
- **Cross-reference:** ADR-081 items 3 and 7; PR 584's review, round 1, judgement call (c).
- **First noted:** 2026-10-25, on PR 584's review.
