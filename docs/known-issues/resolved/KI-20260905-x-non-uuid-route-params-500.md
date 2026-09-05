### KI-2026-09-05-x — a non-UUID path segment reaches Postgres, so ~12 routes 500 instead of 404 and the board renders the literal text "Internal Server Error" — RESOLVED

- **Severity:** correctness (input handling on every id-bearing route; not a data or security hole, but every hit is a Sentry server-fault event and one is user-visible)
- **Area:** `apps/web/src/server/access/trip-access.ts:87-95` → `server/projections.ts:62` (`eq(tripDetails.tripId, tripId)` on a uuid column → pg `22P02 invalid input syntax for type uuid`); `server/eventStore.ts:75-80` (a second instance, reached only after the seam); `api/trips/[tripId]/pages/[pageId]/route.ts`; `access/invites.ts` (`revokeInvite`), `access/shares.ts` (`revokeShare`), `savedDays.ts`. The only `.uuid()` validators in `apps/web/src` are on request **bodies**.
- **Symptom / What happens:** signed in, `GET /api/trips/not-a-uuid` 500s; so do `/history`, `/pages`, `/pages/xyz`, `/access`, `/globals` and `POST /duplicate`; with a valid trip, `GET`/`PATCH pages/not-a-uuid`, `DELETE invites/not-a-uuid`, `DELETE shares/not-a-uuid`, `POST saved-days/not-a-uuid` and `/api/saved-days/not-a-uuid` GET/DELETE/publish all 500. Only `DELETE members/not-a-user` (a text column) 404s. Fifteen requests produced 33 pg errors in the server log. In the browser, `/trips/not-a-uuid` renders a `role="alert"` containing exactly "Internal Server Error" — so a mistyped or truncated shared link is a broken page rather than a "not found".
- **Why not fixed here:** found by a read-only review; no code was changed by it. **Measured live** against a production build (`next start`, dev-login cookie + curl) by the finding agent and reproduced independently by the verifier — stable across three runs by two agents, with the verifier naming `trip_details.trip_id`, `pages.id`, `saved_days.id` and `trip_shares.id` in the `22P02` output. Probe scripts are in the session scratchpad, not committed.
- **Suggested fix:** a `uuidParam` check at the access seam (`requireTripAccess` and the equivalent for page/invite/share/saved-day ids), answering 404 — not 400 — so a mistyped id is indistinguishable from one that does not exist. One insertion point covers most of the twelve.
- **Cross-reference:** [F-G01](../../reviews/2026-09-05-overnight-review/findings/F-G01-non-uuid-route-params-500.md) (LOW-MEDIUM, CONFIRMED live ×3); KI-92 (the same "500 where a 400 belongs" on the request-*body* surface); KI-2026-09-05-q (malformed JSON, the third member of the class); item 9 of the review's executive summary.
- **First noted:** 2026-09-05, overnight review stream G.

---

**RESOLVED 2026-09-05.** Reproduced first, at the seams rather than over HTTP:
a throwaway integration test called each of the ten id-taking functions with
`"not-a-uuid"` and every one of them threw, e.g.

```
getTripDetail(BAD): THREW code=22P02
  Failed query: select "trip_id", "doc" from "trip_details"
                where "trip_details"."trip_id" = $1
  params: not-a-uuid
Caused by: error: invalid input syntax for type uuid: "not-a-uuid"
  ❯ getTripDetail src/server/projections.ts:62:16
  ❯ requireTripAccess src/server/access/trip-access.ts:92:21
```

with the same `22P02` from `readStream`, `getPage`, `revokeInvite`,
`revokeShare`, `getSavedDay`, `readableSavedDay`, `setSavedDayVisibility`,
`deleteSavedDay` and `insertSavedDay`. That is the whole mechanism: Drizzle
hands a path segment to Postgres unchanged, and `eq(<uuid column>, "not-a-uuid")`
is a driver error rather than zero rows, so the throw escapes the handler.

**The fix** is one predicate, `isUuid` in the new `apps/web/src/server/ids.ts`,
applied inside each query function so that it returns **its own existing empty
answer** — `null`, `[]`, `"not-found"` — which every caller already handles. No
route gained a branch and no new status code exists: `requireTripAccess` reaches
its 404 by way of `getTripDetail` returning null, exactly as it does for a trip
that was deleted. The KI's suggested single insertion point turned out to be
five, because the saved-day and access ids never pass through
`requireTripAccess` at all. 404 and not 400, per the entry: a malformed id and
an id naming nothing are the same fact to whoever followed the link, and the
seams already refuse to let a caller tell "no such trip" from "not yours".

Sites: `server/projections.ts` (`getTripDetail`), `server/eventStore.ts`
(`readStream`), `server/access/invites.ts` (`revokeInvite`),
`server/access/shares.ts` (`revokeShare`), `server/savedDays.ts`
(`getSavedDay`, `readableSavedDay`, `setSavedDayVisibility`, `deleteSavedDay` —
`insertSavedDay` reads through `readableSavedDay`), and
`api/trips/[tripId]/pages/[pageId]/route.ts`. The pages guard sits at the route
because `getPage`'s only other caller, the assistant's page scope, already
parses its id with `z.string().uuid()`.

**Proven** by 15 new tests. The 14 integration ones were watched failing for the
right reason first — with `isUuid` stubbed to `return true`, all 14 fail with
`invalid input syntax for type uuid: "not-a-uuid"` while the 83 pre-existing
tests in the same six files still pass; restored, 97/97 pass. `server/ids.test.ts`
guards the opposite and quieter regression, a predicate that got stricter and
turned working requests into silent 404s: stubbed to `return false`, its
"accepts every id this system mints" case fails. Check subset: `pnpm --filter web
typecheck`, `pnpm --filter web lint`, `pnpm --filter web test:int` (40 files, 464
tests, all green — the whole lane rather than six files because the
`minimal-check-subset` skill says not to narrow when a projection is touched).

**Left standing, deliberately:** `server/pages.ts`'s `getPage`, `updatePage` and
`deletePage` still raise `22P02` if called directly with a non-uuid. Both of
their callers validate, so no request reaches them, but a new caller would
inherit the old behaviour — the one place in this bug's class where the guard is
in front of the query rather than inside it.

- **Correction, 2026-09-06 (review of PR #147):** the note above about `pages.ts`'s `getPage`/`updatePage`/`deletePage` being left unguarded is **out of date within the same PR** — they were guarded with `isUuid` before it merged. Do not read this entry as leaving that gap deliberately open.
