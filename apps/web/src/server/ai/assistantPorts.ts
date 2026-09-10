// The app's side of the kernel's library ports (ADR-043 decision 1, P2).
//
// **This file exists because the import wall could not be true without it.**
// The wall ADR-043 first specified named five forbidden modules, and lint
// agreed the kernel was clean while `search_playbooks` reached Postgres through
// `@/server/playbooks` and `insert_playbook_day` through `@/server/savedDays` —
// both of which import `./db/client` one hop down, which ESLint does not
// follow. The wall is now deny-by-default over `@/server/**` with an
// allowlist, so those two imports are refused at the kernel's edge, and these
// two adapters are where they land instead.
//
// Each is deliberately thin. An adapter that computed anything would be tool
// logic outside the kernel — the audit property (`needs` names everything a
// tool may touch) survives only while the port is the whole of the reach and
// nothing decides anything on the way through.
import { discoverDays } from "@/server/playbooks";
import { readableSavedDay } from "@/server/savedDays";
import type { PlaybookLibrary, SavedDayLibrary } from "@/server/assistant/deps";

/**
 * `search_playbooks`'s corpus.
 *
 * **`scope: "everyone"`, not a third copy of the visibility clause.**
 * `scopePredicate` (playbooks.ts) spells `everyone` as *"published, or mine"* —
 * which is exactly `readableSavedDay`'s WHERE clause, the one the apply door
 * re-runs per day. A separate query would agree with it only until somebody
 * edited one of them, and the two directions that disagreement can go are both
 * bad: narrower proposes days that 404 on approval, wider enumerates what
 * people have kept private.
 *
 * Most-added first: the ledger is the library's own answer to "which of these
 * is worth taking", and it is the ranking Discover offers a person making the
 * same choice.
 *
 * It costs one extra `count(*)` (`publishedDayCount`) that this caller does not
 * read. That is the price of the shared query, and it is one indexed count over
 * a small table — cheap next to a second predicate to keep in step.
 */
export const playbookLibrary: PlaybookLibrary = {
  discover: async ({ cities, readerId }) =>
    (await discoverDays({ cities, scope: "everyone", sort: "most-added", budget: "any", season: null, readerId }))
      .days,
};

/**
 * `insert_playbook_day`'s row read, as the actor.
 *
 * Passed through with no narrowing: the guarantee IS `readableSavedDay`'s WHERE
 * clause, and every flavour of unreachable — never existed, not yours,
 * withdrawn, not even a uuid — has to keep answering with the same "no row"
 * (ADR-042's deliberate failure mode).
 */
export const savedDayLibrary: SavedDayLibrary = {
  readable: (savedDayId, readerId) => readableSavedDay(savedDayId, readerId),
};
