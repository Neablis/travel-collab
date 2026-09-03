### KI-20260903 — The Notebook index says "Yours" for a collaborator's notebook

- **Severity:** correctness, cosmetic in effect — the line names the wrong
  person on a shared trip. Nothing routes, gates or writes off it.
- **Area:** `apps/web/src/lib/pageScope.ts` (`provenanceLabel`), rendered by
  `apps/web/src/components/pages/NotebookScreen.tsx`
- **What it does:** SPEC §7's provenance line has two designed strings —
  *"Comes with your trip"* and *"Yours"*. `provenanceLabel` chooses between them
  on the one fact a `PageSummary` carries: whether `actorId` is
  `SYSTEM_ACTOR_ID`. The seeded half is exactly right; the sentinel is a value
  this app writes and no person can hold. **The other half is a guess.** Any
  notebook not written by the seeder renders "Yours", including one a
  collaborator on a shared trip wrote.
- **Why it shipped that way rather than being fixed at the time:** saying who
  wrote a notebook needs a name, and `pages` has never joined `users`. That is
  the same gap `apps/web/src/lib/displayName.ts` describes at length for saved
  days — a `saved_days` row carries `owner_id` and nothing else — and the
  resolution there was to pass what exists and be honest about it rather than
  invent a public user record. Comparing `actorId` against the session's own
  `user.id` would fix the wording without a join, but it puts a `getSession()`
  round trip in front of a list that otherwise renders on one fetch, for one
  word; `AccountMenu.tsx:243-247` records the review that already caught a
  second session resolver being mounted for less.
- **What it would take:** either the session comparison above (cheap, fixes the
  wording, costs a round trip), or `PageSummary` carrying a resolved author name
  through `displayNameFor` (a contract change, and the right answer if any other
  surface ever needs to name a notebook's author). **Do not fix it by softening
  the copy to something vague** — the seeded/authored distinction is the thing
  the line exists to draw, and it is drawn correctly.
- **Not reached by a solo trip**, which is every trip in the e2e suite and most
  trips in use, so it will not show up in a walk that does not deliberately
  share a trip and have the other person write a notebook.
- **First noted:** 2026-09-03, in the commit that built the line (M14's
  navigation-and-index half). Recorded with the code rather than after it.
