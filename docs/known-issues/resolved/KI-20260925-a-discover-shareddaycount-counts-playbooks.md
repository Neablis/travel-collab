### KI-2026-09-25-a — Discover's `sharedDayCount` counts Playbooks, not days (the `daysShared` misnomer's sibling) — RESOLVED

- **Severity:** cleanup. No wrong number is rendered: the only reader,
  `DiscoverScreen.tsx:736`, tests it `> 0` to decide whether the library is
  empty, and "any Playbook" and "any day" agree on that.
- **Area:** `apps/web/src/lib/playbooks.ts` (`DiscoverResponse.sharedDayCount`),
  `apps/web/src/server/playbooks.ts` (`discoverPage`, fed by
  `publishedPlaybookCount`), `apps/web/src/components/playbooks/DiscoverScreen.tsx`,
  and the `apiClient` / `NewTripWizard` / `DiscoverScreen` tests that build it.
- **Symptom:** the field is fed by `publishedPlaybookCount()`, which counts
  published `saved_days` rows — Playbooks since M23 — under a name that says
  days. The same defect class KI-2026-09-19-c fixed for `PublicAuthor`
  (`daysShared` → `playbooksShared`); it is the next reader of the count that
  will believe the name.
- **Why not fixed here:** found by KI-2026-09-19-c's fixer in the 2026-09-25
  overnight sweep; outside that entry's Area, and a separate response field with
  its own consumers and tests. Intended fix: rename to `sharedPlaybookCount`
  (app-internal wire only — not on `/v1`), or to a boolean if emptiness is all
  it is ever for.
- **Cross-reference:** `resolved/KI-20260919-c-daysshared-counts-playbooks-not-days.md`, ADR-048.
- **First noted:** 2026-09-25, overnight KI sweep.
- **Resolved 2026-09-25 (overnight sweep).** The field is now `DiscoverResponse.sharedPlaybookCount`. It is still a count, still fed by `publishedPlaybookCount()`. The schema docstring now says Playbooks, not days, and says that a three-day Playbook counts once. The rename covers `lib/playbooks.ts`, `server/playbooks.ts` (`discoverPage`'s return and its comment), `DiscoverScreen.tsx` (the leaderboard-link guard and its comment), and the mocks and assertions in `apiClient.test.ts`, `DiscoverScreen.test.tsx` and `NewTripWizard.test.tsx`. It also covers three int tests that read the key: `playbooks/route`, `reports/route` and `saved-days/[savedDayId]/route`. **Wire check first:** `server/public-api/discover.ts` returns `discoverPage(...)`, which is `DiscoverDay[]`. The `/v1` listing never carries the response envelope, so this field is not on it. `packages/contracts/src`, every `openapi.json` and `docs/guidelines/using-the-api.md` have no reference. So this is not a `/v1` break and no contracts CHANGELOG entry is owed. **Reproduction:** a new int test in `app/api/playbooks/route.int.test.ts`, *"counts a published three-day Playbook as one shared Playbook"*, publishes one Playbook spanning three days. Under the old key, the card's `dayCount` was `[3]` and `sharedDayCount` rose by exactly 1. Asserting what the name promised (`before + 3`) failed with `AssertionError: expected 1 to be 3`. **Red-then-green:** with the tests on the new key and `discoverPage` put back to emit `sharedDayCount`, the int test fails with `ZodError: [{ "code": "invalid_type", "expected": "number", "received": "undefined", "path": ["sharedPlaybookCount"], "message": "Required" }]`. `tsc` fails with `TS2322 ... 'sharedDayCount' does not exist in type`. With one `apiClient.test.ts` mock put back to the old key, `searchPlaybooks`' zod parse rejects it, and the test fails with `AssertionError: expected false to be true`. Restored, all of these are green. **Checks:** `pnpm --filter web typecheck` and `pnpm --filter web lint` are clean. The unit tests (`apiClient`, `DiscoverScreen`, `NewTripWizard`) pass 218/218. The int tests `playbooks/route`, `reports/route` and `saved-days/**` pass 74/74 across 6 files.
- **Decision (2026-09-25 overnight sweep):** renamed to `sharedPlaybookCount` and kept as a count. Rejected alternatives: (a) a boolean such as `libraryHasPlaybooks`, because it changes what the field means, not just its name. The only reader tests `> 0` today, but narrowing the field to a boolean is a separate decision, and this entry is a misnomer. (b) Emitting both keys during a transition, because the only consumer is this app, which ships in the same deploy (the same call KI-2026-09-19-c made).
