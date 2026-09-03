### KI-20260903 — The Notebook index says "Yours" for a collaborator's notebook — **RESOLVED 2026-09-03, same day, in the PR that filed it**

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

---

**RESOLVED 2026-09-03 (PR #126), and the entry's own reasoning was the thing that
was wrong.** This was filed on the premise that saying whose notebook it is needs
a `users` join `pages` has never had, with the session comparison dismissed as
"a `getSession()` round trip in front of a list that otherwise renders on one
fetch". Copilot's review pointed out the premise was false: the list route
**already** resolves the reader from its own `guard(tripId, "viewer")` call, so
`g.userId` was sitting there the whole time. The GET now returns `viewerId`
alongside the pages, and `provenanceLabel` takes it — no join, no extra request,
no session resolver in the client.

The distinction it draws is exactly the one that can be drawn honestly: seeded
("Comes with your trip"), the reader's own ("Yours"), and somebody else's ("From
another traveler"). It never names the other person, which IS the part that would
need the join. When `viewerId` is unknown the wording stays author-neutral rather
than guessing, because "Yours" on somebody else's notebook is the precise error
this exists to stop.

**The lesson worth keeping:** a known issue is a claim about the code, and this
one's claim was not checked before it was written down. "It needs a users join"
was inferred from `displayName.ts`'s account of saved days — a genuinely
different surface, which has no guard call in the same request — and carried over
without opening the route. A filed KI buys the right to move on; it does not buy
the right to skip the ten seconds of reading that would have shown there was
nothing to file.
