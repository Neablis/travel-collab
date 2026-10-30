### KI-2026-10-30-a — world place search adds an `external_data_cache` row per distinct query, and nothing sweeps them

- **Severity:** slow table growth; no user-visible effect. Each row is about 1 KB.
- **Area:** `apps/web/src/server/places.ts` (`worldPlaces`, the `locationiq:autocomplete:<sha256>`
  key), `apps/web/src/server/external/cache.ts` (`readThrough`, the table's sole writer), the
  `externalDataCache` comment in `apps/web/src/server/db/schema.ts`.
- **Symptom / What happens:** weather and normals keys are rounded points that recur, so their
  rows are overwritten in place. A world place search key is one per distinct typed query, and most
  queries never recur, so an expired row is only replaced if the same query is typed again. At the
  global ceiling (`WORLD_PLACE_SEARCH_RATE_LIMIT_GLOBAL_DAILY`, 1,000 misses a day) that is up to
  1,000 new rows a day, about 365k rows (roughly 0.4 GB) a year. The keys are hashed (PR 639), so
  the rows hold no typed text, only the vendor's place rows.
- **Why not fixed here:** a sweep needs a scheduled job and a decision on where it runs (the cron
  routes or a `readThrough`-side delete); PR 639 was a review fix to the search itself.
- **Fix path / Tripwire:** delete `external_data_cache` rows whose key starts
  `locationiq:autocomplete:` and whose `expires_at` (and `backoff_until`) is past, on a daily
  schedule, through `cache.ts` so it stays the table's one writer (`external.soleWriter.test.ts`).
  Tripwire: the table passes 100k rows.
- **Cross-reference:** ADR-052 (the external data cache); review of PR 639, finding 6.
- **First noted:** 2026-10-30, review of PR 639.
