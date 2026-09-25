### KI-2026-09-17-b — LocationIQ pacing is per-invocation, so concurrent lookups can exceed the key's rate limit

- **Severity:** reliability (a 429 degrades a lookup to `unavailable`; it loses grounding for that query rather than corrupting anything)
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — owned by M9, not a gate box. Parked under Mitchell's 2026-09-01 rule that every open AI known issue belongs to M9; filed after that audit, so it had no owner until now. Listed in `docs/milestones/M9-ai-planning-partner.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/server/ai/assistantPorts.ts` (`createPlaceSearchPort`'s `vendorCalled` pacing), `apps/web/src/server/ai/geocodeEnrichment.ts` (`mapRateLimited`), `apps/web/src/server/ai/rateLimit.ts` (`REQUESTS_PER_SECOND = 2`), `apps/web/src/server/savedDayPins.ts` (`pinStops`, `MIN_INTERVAL_MS`)
- **Symptom:** both callers pace themselves correctly and neither paces against the other. `vendorCalled` is a local in one `search` invocation, and `mapRateLimited` sequences one enrichment call. Two turns in flight — or one turn's `search_places` overlapping another's enrichment — each honour two requests per second on their own while the shared LocationIQ key sees four. The vendor answers 429; `search` catches it and records `skipped: "unavailable"` for that query, so a grounded plan silently loses a citation.
- **Found by:** CodeRabbit, PR #188, with static analysis. M9's grounding is what made it reachable: before `search_places`, enrichment was the only door into the key.
- **Why it is filed rather than fixed in #188:** the proposed fix — one scheduler shared by both callers — is only a fix on a long-lived process. This app deploys to Vercel, where concurrent requests can land on separate instances that share nothing but the key, so a module-level queue narrows the window without closing it and would read as a guarantee it does not make. The honest fix is a distributed limiter (the same store `consumeQuota` already uses), which is a change to a shared dependency and its own piece of work.
- **What bounds the damage today:** `geocodeQuota` still caps total spend per actor, so this is a burst-shape problem rather than a cost one, and every failure mode is a missing lookup rather than a wrong one.
- **Fix path, if taken:** move the pacing behind the same counter store the quota uses, keyed on the vendor rather than the actor, and have both `createPlaceSearchPort` and `geocodeEnrichment` acquire from it. Delete `vendorCalled` and the `mapRateLimited` interval at the same time, or the two schemes will disagree.
- **Cross-reference:** KI-93 (resolved 2026-09-16 — every door charges the quota; this is the same two doors, for pacing rather than spend), `rateLimit.ts`'s own header.
- **First noted:** 2026-09-17, working CodeRabbit's review of PR #188.
- **A third caller, 2026-09-23 (M27 link 10).** `apps/web/src/server/savedDayPins.ts`
  (`pinStops`, `MIN_INTERVAL_MS`), called by `apps/web/src/server/savedDayPinBackfill.ts`
  after a Playbook read, paces lookups **within one pass** only. Two readers
  opening two unpinned Playbooks at once, or one Playbook on two instances
  (`inFlight` is per instance), each keep their own pace against the same key.
  Its failure mode matches the other two callers: a missed lookup leaves that
  stop unpinned for this pass, and nothing is written wrong. The fix path above
  is unchanged except that it now has three callers to move onto the shared
  limiter.
- **Re-verified 2026-09-25 (overnight sweep):** STILL TRUE, and the caller list is incomplete. The three paced callers are as described — `vendorCalled` local to one `search` (`server/ai/assistantPorts.ts:137-158`), `mapRateLimited` per enrichment call (`geocodeEnrichment.ts:508,592`), `pinStops`' per-pass sleep (`savedDayPins.ts:138`) with per-instance `inFlight` (`savedDayPinBackfill.ts:22`); `REQUESTS_PER_SECOND = 2` at `rateLimit.ts:24`. No shared/distributed limiter exists. Two more doors hit the same key with no pacing at all: `app/api/geocode/route.ts:19` (the user-typed `LocationInput` lookup) and the public API — `app/api/v1/trips/[tripId]/geocode/route.ts:62` and `server/public-api/locations.ts:67`. A shared limiter would need to cover all five.
