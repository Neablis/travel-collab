# M13 — Collaboration

**Status:** Scoped 2026-09-01. Placed **after M12** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until now
— a table row and nothing else.

**Narrowed twice, and both subtractions are load-bearing:**

- **2026-08-27 — invites, roles and revocation moved to M11**, because they are
  the same `AccessPolicy` change as share links and opening that boundary twice
  costs twice. M11 shipped them. Read the old scope with that removed.
- **2026-08-30 — it acquired per-stop attribution**, when M11b's shell sweep
  retagged `rack-provenance` to sit beside `add-stop-who`. **M19's link 3
  depends on this milestone landing that field**, which is the whole reason M19
  is placed after it.

**It needs an ADR before it opens** — the realtime transport. And it will need a
migration for per-stop attribution.

**Moved ahead of M12, 2026-09-18, by Mitchell.** This file already said it sat
after M12 *"because M12 is smaller and finishes a surface that is already live,
not because of a dependency"* — so the move costs nothing and buys three things:
link 3 closes **KI-90 and KI-5's `applyOutcome` precondition**, which are
single-player data-loss
defects live in the app today rather than realtime work; link 5 lands the
attribution field **M19 link 3 and M14's two cut person widgets both wait on**;
and the transport ADR stops blocking. **M23 runs before it** — see
`docs/milestones/README.md`'s 2026-09-18 note.

**One correction from the conversation that placed it: *"websockets"* is not a
decided transport.** Link 1 is explicitly SSE *or* WebSockets *or* polling with a
cursor, decided against this project's constraints — and on Vercel's serverless
runtime a long-lived WebSocket needs a service this project does not run. The ADR
decides it; the word in the request does not.

**It acquired a prerequisite it does not own, 2026-09-18: the activity-field
descriptor refactor (`KI-20260905-o`), which runs once before this milestone and
is shared with M24 and M19 link 1.** Link 5 adds a field to an activity, and
**21 non-test files hand-enumerate activity fields today** with nothing going red
when one is missed — a class that has already bitten three times (KI-1, KI-54,
M18's editor sheet dropping `kind`/`tags`). It was scheduled once already, on
2026-08-29 as *"one overnight batch"*, and did not happen. It is a gate box here
rather than a promise elsewhere, for that reason.

## Why this exists

Two people can already be on a trip. M11 shipped memberships, roles, invites and
revocation, so the access half is done. What is missing is that **the second
person's edits do not arrive.** A trip is fetched, folded and rendered; nothing
pushes. Two people editing the same trip today diverge silently until one of them
reloads.

This is the largest remaining architectural lift in the project, which is why it
waited until something needed it. Two things now do: M12's library is built out
of days people share with each other, and the optimistic-update loss class below
had three open entries against it. *(Two of the three are closed as of
2026-09-22 by link 3 — see the table, which is kept as the statement of the
problem this milestone opened against.)*

### The loss class is already documented, and the fix is already named

`TripProvider`'s optimistic overlay predicts every mutation locally and drains a
send queue in the background. Three open known issues describe the same seam:

| KI | What is lost |
|---|---|
| **KI-5** | Commands still queued when the tab navigates away are lost, with no error surfaced |
| **KI-90** | A unit enqueued *while an undo/redo/revert is in flight* is discarded by the reconcile's unconditional `pending: []` |
| KI-90's second site | `enter` (the history preview) reads a render-time `pending`, so a preview can be entered in the same tick as an enqueue — nothing is lost, noted rather than filed |

**KI-90 names the fix and says why it was not done in a line:** widening
`confirmHead` into a general *"adopt this outcome, re-predict what is queued"*
reducer *"is the shape that would fix [KI-90], KI-5's `applyOutcome` precondition
and this at once, and that is a design pass, not a line."*

**That design pass is this milestone.** A reducer that re-predicts queued work
against an authoritative outcome is exactly what a remote edit arriving mid-queue
also needs — which is why doing realtime first and the reconcile afterwards would
build the same machinery twice.

## Scope

Five links. Link 1 is an ADR and gates the rest.

1. **The transport ADR.** Server-Sent Events, WebSockets, or polling with a
   cursor — decided against this project's actual constraints, not in the
   abstract: Vercel's serverless runtime, an event log that is already an
   ordered sequence with a `global_seq`, and a client that already reconciles
   against a fetched head. **`events.global_seq` is the obvious cursor and the
   ADR should say why it is or is not.** ADR due here, per the roadmap table
   since 2026-07-28.
   **WRITTEN AND ACCEPTED 2026-09-22 — `ADR-049`** (accepted on Mitchell's
   instruction to begin implementation; the ADR's status line records that
   basis). It decides the cursor is **per-stream `seq`** and **rejects
   `global_seq`** on a correctness argument rather than a preference: a
   `bigserial` is assigned at `INSERT` and visible at `COMMIT`, so a reader
   polling `global_seq > cursor` can advance past an event that commits late
   and never see it again. Per-stream `seq` has no such window, because writing
   `seq` N+1 requires having read N committed rows in that stream. Transport is
   **polling with a cursor**, and the ADR's argument is that on this runtime
   **SSE without a broker is not push** — a handler cannot learn of a commit
   made by another invocation, so it polls the database itself while you also
   pay to hold it open. SSE, WebSockets, a hosted broker and `LISTEN`/`NOTIFY`
   are each rejected with a reason, and the transport sits behind a seam
   because **the cursor is the durable decision and the transport is the
   swappable one**. Two things the ADR found that links 2-5 should not
   rediscover: `EventEnvelope` does not carry `globalSeq` at all, and ADR-027
   already pins share links to per-stream `seq` and replays to it — so the
   coordinate is in production, not new.
2. **Broadcast.** Committed events reach other viewers of the same trip. The
   command pipeline does not change — this is a read-side push, and
   `AccessPolicy` decides who receives, the same object that decides who reads.
   **DONE 2026-09-22, both halves.** Server:
   `GET /api/trips/:tripId/events?after=<seq>` → `{ headSeq, events, resync }`,
   `requireTripAccess(..., "viewer")`, no new index and no migration. **The
   steady-state poll costs one index-only lookup** — at the head it returns
   before the range scan runs, so only a poll with news pays for a second
   query. Client: `context/broadcast.ts`, the ADR-049 Decision 3 seam — 5s while
   visible, nothing while hidden, an immediate poll on returning, and no
   interval at all for a solo trip or a board previewing an older seq.
   **Two decisions inside it worth not re-litigating:** the poll is a change
   *signal* and the detail comes from a **refetch, not a client-side fold** (the
   server projects with `serverConflictContext()`, so folding here would let
   `confirmed` disagree with the server about which conflicts exist — link 4's
   whole subject); and the refetch **invalidates the read cache before it
   reads**, because `cachedRead`'s 5s window and the poll's 5s interval are the
   same order of magnitude, so otherwise the refetch is answered out of the very
   entry the poll just proved stale. Received events go through `adoptOutcome`
   (link 3), never around it.
3. **The re-prediction reducer.** `confirmHead` widened to "adopt this outcome,
   re-predict what is queued", per KI-90. **Closes KI-90 and KI-5's
   `applyOutcome` precondition.** This is the link that makes a remote edit
   arriving mid-edit safe rather than lossy.
   **DONE 2026-09-22.** `confirmHead` and the new `adoptOutcome` share one
   `rePredictOnto` body and differ in one thing: whether the outcome is the
   answer to the unit at the head of the queue. Both `{ confirmed: X,
   pending: [] }` sites call it. `adoptOutcome` **preserves `failure`** where
   `confirmHead` clears it — retaining the queue while dropping the failure
   would unlatch the sender's gate and re-fire a rejected head (`failHead`
   measured 41 sends in 300ms the last time that gate was missing).
   **Two corrections to this link's own scope, both recorded rather than quietly
   absorbed:** it does **not** close "the same-tick preview read" — `enter` still
   reads a render-time `pending`, nothing is lost when it races, and KI-90's
   resolved entry says so; and it closes **two** things, not three, because the
   "KI-77" this file carried was KI-90's own pre-renumbering number.
4. **Concurrent-edit conflicts as resolvable data.** Two people editing the same
   stop is not an error dialog — it is a conflict the domain can already
   express. The soft-conflict engine (M1) and `detectConflicts` are the shape to
   reuse; a concurrent edit is another kind of thing the trip knows is wrong,
   not a modal.
   **DONE 2026-09-22.** `context/concurrentEdits.ts` produces ordinary
   `Conflict` values, merged by `activeDetail` into the same array the board
   already renders — so `ConflictBanner` shows them with **no new surface**.
   **It is NOT a rule in `detectConflicts`, and that is the interesting part:**
   every rule there is `(state, ctx) => Conflict[]`, a pure function of the
   trip, and this one cannot be. A stop two people edited looks completely
   ordinary in the resulting state; what makes it a conflict is something the
   trip does not contain — the caller's own unsent queue. So it is computed at
   the overlay, in `adoptOutcome`, the one reducer where an authoritative
   outcome replaces the base while a queue still exists.
   **Two things worth not rediscovering.** Equality is the domain's
   `activityStatesEqual`, reached through the `@tc/predict` entrypoint because
   the lint wall lets only `src/server` and `src/app/api` import `@tc/domain` —
   which also means the detector inherits `KI-2026-09-05-o`'s compile-forcing
   field set rather than keeping a second copy. And these conflicts are
   deliberately **not dismissible**: dismissal persists as a command and their
   id is stable per stop, so one click would permanently suppress every future
   collision on that stop. They need no dismissal — they are derived from the
   queue and leave when it drains (`pruneResolved`, on every `confirmHead`).
5. **Per-stop attribution — who a stop is for.** `add-stop-who` and
   `rack-provenance` in `preview-registry.ts`, both blocked on the same absent
   field: *"no field records who a stop is for"*, and *"who parked a stop, and
   which day it came from"*. Participation against the trip's existing members.
   **M19's link 3 builds splits on this field and must not add its own** — that
   is the drift `AGENTS.md` invariant 5 exists to stop.
   **DONE 2026-09-22, and it is TWO relations rather than the one this link's
   own wording implies.** M19 link 3 records the decision (Mitchell,
   2026-09-03): *"we need activities to have owners (and i think participants
   that are going to that activity)"* — who **booked** a stop is not who is
   **going** to it, and **M19's splits need the participants, not the owner**.
   A single `who` would have satisfied `add-stop-who`'s wording and been wrong
   for every split built on it, so link 5 landed `bookedBy: string | null` and
   `participants: string[]`. Named `bookedBy` rather than `owner` because
   `owner` is already a `TripRole` and the `saved_days.owner_id` column.
   **Both registry entries are gone**: the editor's "Who is in" is a real
   control over the trip's members, and the rack line says who parked a stop.
   **Half of `rack-provenance` was NOT built** — which day a parked stop came
   from is not modelled, because `MoveActivity` carries `toDayId` and nothing
   about where it left; that half is in `docs/candidates.md` rather than left
   as a placeholder that reads as a promise.
   **`SavedStop` deliberately does not carry either field**, asserted by name
   in `packages/contracts/test/saved.test.ts`: a saved day is publishable, so
   copying attribution in would publish the originating trip's member ids.

## Exit gate

- [x] **The transport ADR is written, accepted, and names what it rejected and
      why** — including whether `events.global_seq` serves as the cursor.
      *(**`ADR-049`, written and accepted 2026-09-22.** It names six rejections
      with reasons and answers the `global_seq` question with a **no**, on a
      commit-order-visibility argument. **Accepted on Mitchell's instruction to
      begin implementation**, not on a separate written review — the basis is
      recorded in the ADR's own status line rather than left implied, the same
      way M21's, M22's and M26's attested boxes are. Decision 2, the transport,
      is explicitly open to reversal; Decision 1, the cursor, is the one that
      would be expensive to change.)*
- [x] Two browsers on the same trip: an edit in one appears in the other without
      a reload, **walked in a real browser as two real actors**, the same
      standard M11's gate held itself to.
      *(**The code is built and unit-covered as of 2026-09-22 — this box is
      about the walk, and it is deliberately NOT ticked.** `TripProvider.test.tsx`
      proves a co-traveller's edit is adopted without a reload and that the
      user's unsent work survives it, but a jsdom test is not two browsers. The
      walk needs a Vercel preview and therefore a PR; the repo's own answer is
      to dispatch `phase-verifier` against it.*
      *
      **That answer was tried on 2026-09-22 and does not reach this box.** The
      verifier drove the preview successfully, but a two-actor walk needs a trip
      with two members, and an agent cannot make one there: `POST
      /api/trips/:id/invites` returns **402** without the owner's
      `trip.collaborators` entitlement, and granting it is an admin action a
      sandboxed agent is refused. The collaboration path had to be exercised
      locally instead, against a second member inserted straight into
      `trip_memberships` — which proves the code and is not the walk this box
      asks for.
      **So this box is Mitchell's or it needs an entitled preview account**, and
      that is a fact about the environment rather than about the code. Recorded
      here because the box's own instruction above sends the next person at a
      wall that is now measured.)*
      *
      **TICKED 2026-09-22 on Mitchell's attestation.** He walked the preview
      himself — the two-actor collaboration path and the undo-past-a-notebook
      path — after `#201` merged, and reported both done. **This is his
      attestation, not an agent observation**, and it is recorded that way on
      purpose: no agent in this session saw two browsers, and the 402 wall
      above is still there for the next one. What an agent did verify is
      underneath it — `TripProvider.test.tsx` for adoption without a reload,
      `events/route.int.test.ts` for revocation between polls, and the
      collaboration path exercised locally against an inserted
      `trip_memberships` row.)*
- [x] A viewer who loses access mid-session stops receiving updates — the
      broadcast path honours `AccessPolicy`, and there is a test that fails if
      it stops doing so.
      *(**Done 2026-09-22.** Structurally, not by a teardown path: every poll is
      a fresh request through `requireTripAccess`, so revocation bites on the
      next one and there is nothing to remember to tear down. The test is
      `events/route.int.test.ts`, *"stops serving a member whose membership is
      revoked between polls"* — 200, revoke through the members route, 403.
      Deleting the route's `if ("error" in access) return access.error` fails it
      along with the 401 and stranger cases: `expected 200 to be 403`.)*
- [x] **A command enqueued while an undo/redo/revert is in flight survives it**
      — KI-90's reproduction fails before the change and passes after, and the
      entry is moved to `resolved/` with its proof line.
      *(**Done 2026-09-22.** The reproduction is `describe.each` over all three
      `HISTORY_TYPES` — the branch is keyed on set membership, so a regression
      reachable through Redo but not Undo would otherwise pass, the same reason
      KI-70's sibling suite is shaped that way. The history send is held open,
      the edit is dispatched into that window, and the send settles with a
      **different** trip from the one the edit was predicted against, so the
      assertion proves the unit was RE-PREDICTED rather than merely preserved.
      Restoring `{ confirmed: result.value, pending: [] }` fails all six with
      `expected '2' to be '3'`.)*
- [x] Two people editing the same stop produce a **conflict the UI can show and
      a person can resolve**, not a lost write and not a modal.
      *(**Done 2026-09-22.** Shown: an ordinary `Conflict` in `ConflictBanner`,
      warning severity, naming the stop and what happened to it. Resolvable: it
      carries the two real options as `resolutions` — send yours and overwrite,
      or undo yours and keep the server's — and **no write is lost either way**,
      because the queue survives via `adoptOutcome` (link 3) rather than being
      cleared. Not a modal: AGENTS.md invariant 3 holds unchanged.
      Deleting the raise in `adoptOutcome` fails four tests; swapping
      `activityStatesEqual` for identity fails two; making them dismissible
      again fails two more.)*
- [x] A stop records who it is for, set through the UI and read back off the
      API; `add-stop-who` and `rack-provenance` are wired up or deleted, and no
      M13-tagged entry remains in `preview-registry.ts`.
      *(**Done 2026-09-22.** Set through the UI: two controls in
      `ActivityEditor` over the trip's own member list — toggles for who is
      going, a select for who booked it — covered by
      `ActivityEditor.test.tsx`. Read back off the API:
      `route.int.test.ts` runs a real `AddActivity` carrying both and reads
      them off `GET /api/trips/:id`; `ActivityView` is also a public v1
      response shape, so `openapi.json` was regenerated. Both registry entries
      deleted and `grep 'milestone: "M13"' preview-registry.ts` returns
      nothing.)*
- [x] **`KI-20260905-o` is resolved before link 5 adds its field** — the
      activity-field descriptor refactor has landed, the entry is moved to
      `resolved/` with its proof line, and adding an activity field now fails
      the typecheck at every site that must move rather than compiling green.
      *(Added 2026-09-18. It is a box here because it is shared with M24 and
      M19 link 1 and was already scheduled once, on 2026-08-29, without being
      done. If Mitchell decides it runs as its own piece of work instead, this
      box is satisfied by that landing — not by this milestone doing it twice.)*
      **DONE 2026-09-21, as its own piece of work** — the second half of that
      parenthesis, which is why this box is ticked before the milestone opens.
      Mitchell asked for it directly, ahead of M13 and alongside M26's gate
      close. `ActivitySnapshot` in contracts, `ActivityState` inferred from it,
      `FIELD_EQUAL` in `equality.ts`; proven by adding a ninth field and
      reading the errors at `decide`/`diff`/`equality`/`evolve`/`hydrate`,
      `detail.ts`'s parity assertion, factories, mocks and ~27 test files.
      **One thing link 5 must know:** the read model `ActivityView` is
      deliberately NOT derived, so `who` has to be added to it by hand — the
      key-parity assertion in `detail.ts` will fail the build until you do,
      which is the point, but it forces the KEY and not the TYPE. The resolved
      entry says why the derivation was backed out.
- [x] **The attribution migration is written, applied locally, and its
      production dispatch is called out in the PR body.**
      *(**There is no migration, and that is the finding rather than a skipped
      step — 2026-09-22.** This box was written at scoping time, before the
      design, on the reasonable assumption that a new per-stop relation means
      DDL. It does not here: an activity lives in jsonb at every layer that
      stores one — `events.payload`, `trip_details.doc`, `saved_days.stops` —
      so `bookedBy` and `participants` are new keys in documents that already
      exist, exactly as `kind` and `tags` were in M18. What stands in for a
      migration is the pair of `.default()`s on every schema that parses stored
      data, and that is **asserted rather than assumed**:
      `route.int.test.ts` strips both keys from a stored `trip_details.doc` and
      reads the trip back, expecting `{ bookedBy: null, participants: [] }`.
      Removing the defaults turns that test into `expected 500 to be 200` —
      the #71 shape, one field later. **Nothing to dispatch to production.**)*
- [x] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
      *(**Done 2026-09-22, on CI's run rather than a local one, and the basis
      matters.** Tier 3 asks for `pnpm check`, `test:e2e:ci-like` because a user
      flow changed, and `seed:verify` because contract fields changed. Locally:
      `pnpm typecheck`, `pnpm lint` (36 walls), the unit lane, `pnpm test:int`
      811/811, `pnpm seed:verify` 102/102 and `pnpm content:verify` — all green.
      **The e2e verdict is CI's `integration-e2e` job on the current head
      (`0da8313`, run 35757734392), green** — re-established there rather than
      left citing `4e41b79`, because two code commits landed after that run
      (`42c74c1`, the Board adapter completion, and `0da8313`, which deleted
      those adapters and moved the form-to-command mapping into
      `activityCommands.ts`). An e2e verdict names a commit; when the commit
      moves, so does the verdict, or the tick is about code that no longer
      exists. That job is `pnpm --filter web build` then `pnpm --filter web
      test:e2e`, and GitHub sets `CI=true`, so
      `playwright.config.ts`'s `webServer.command` resolves to `pnpm start`
      against the built app — which is exactly what `test:e2e:ci-like`
      (`pnpm build && CI=true pnpm test:e2e`) reproduces locally. The `ci-like`
      script is named for being the local proxy of that run; CI is the thing it
      proxies, so this is the stronger evidence, not a substitute for it. It is
      also the only lane that can render MapLibre — `KI-49` means the two map
      specs cannot pass in an agent container, which is what M26's gate box had
      to name as 153/2.)*
- [x] Retro appended at gate close. Below.

## Deliberately not here

- **Invites, roles and revocation.** Shipped in M11 (link 3, ADR-025). If this
  milestone finds itself touching `AccessPolicy`'s membership rules, that is the
  drift signal `AGENTS.md` names, not a scope discovery.
- **Cost splits.** M19's, built on link 5's field. This milestone lands *who*; it
  does not divide money by them.
- **Presence, cursors, typing indicators.** Not designed. §8 of `SPEC.md` lists
  what is deliberately undesigned and the collaboration surface is not in the
  handoff at all — designing it is a separate ask.

## Prerequisites

**M11, and it is closed.** Memberships, roles and `AccessPolicy` all exist; this
milestone swaps the implementation behind them and adds a push.

**Nothing else.** It is placed after M12 because M12 is smaller and finishes a
surface that is already live, not because of a dependency.

**One thing it owes forward:** M19's link 3. If this milestone ships without
link 5, that link returns to M19 and M19's file says so.

## 2026-09-19 — the design surfaces waiting on link 5's field

Recorded here by M26's design-parity survey so that **per-stop attribution has
one list of consumers rather than three half-remembered ones**. M13 link 5 lands
`who` on a stop; these are the surfaces that draw it, and all of them are
blocked until it does. Scope: `docs/milestones/M26-design-parity.md`.

**Two `<Preview>` shells, both correctly tagged to this milestone.**
`preview-registry.ts` holds six entries now — not the eleven `DRIFT.md` §3 still
lists — and two of them are M13's:

- **`add-stop-who`** (`ActivityEditor.tsx:348`) — the stop editor's "who is this
  for" control.
- **`rack-provenance`** (`UnscheduledRack.tsx:251`) — who parked a stop and which
  day it came from. The same absence seen from the parked side.

**And a third consumer the registry does not show**, found by the same survey:
the Notebook's widget vocabulary declares a **`person` input type**
(`packages/pages/src/registry-types.ts:245-256`) and the file says plainly that
nothing links an activity to a person — no `assignee`, `paidBy`, `participant`
or `share` on `ActivityView`. So `person` is **vocabulary with no dimension
behind it**, and SPEC §18's two person widgets (*"what one person is in for"*,
*"a line for everything one person booked"*) cannot be built. On the page today
this surfaces as an `EmptyChip` reading *"needs a person field"* — honest, and
still a hole.

**This does not widen M13.** Link 5 lands the field; the three surfaces above
are M26's and M14's to draw once it exists. What this note asks of M13 is only
that **the field's shape be chosen with three consumers in view rather than
one** — the stop editor, the parked rack, and a Notebook widget binding to a
person the way it binds to a day.

**And the standing warning stays in force**: M19 link 3 depends on this field
too, which is why M19 runs after M13. If M13 ships without it, that link returns
to M19 and these three surfaces go with it.

## Retro — M13, closed 2026-09-22

Ten boxes, five links, and a sixth piece nobody planned. The transport was
right on the first try and never moved; the aggregate boundary was right on
the second. What went wrong was almost entirely **tests that reported more
coverage than they had**, and the milestone found six of them.

### The decision that paid for itself

**One stream, two aggregates, skipping by name.** Notebook events share the
trip's stream, so `headSeq` moves on a save and the cursor, batch grouping and
undo targeting all worked untouched. They do *not* join `TripState`, and the
reason is mechanical rather than aesthetic: `hydrate.ts` is the documented
inverse of the projection under a round-trip property test, which makes
`TripDetail` a strict superset of `TripState`. A `pages` field on one is a
`pages` field on the other — stored whole in `trip_details.doc` and refetched
every 2s by the very poll this milestone built. The alternative shipped every
notebook's full ProseMirror document on the hot path to keep a document nobody
was reading up to date.

The skip being **by name** rather than by try/catch is the part that would have
been easy to get wrong and impossible to notice. A `catch` would have swallowed
a genuinely corrupt envelope and folded to a plausible wrong state; the by-name
skip keeps `foldEnvelopes` loud. There is a test that fails if anyone swaps it.

### Two things that were true before anyone built them

- **No migration was needed, twice, for different reasons.** Link 5's `bookedBy`
  and `participants` needed none because an activity lives in jsonb at every
  layer that stores one. The page backfill needed none because `listPages` had
  *always* seeded lazily on read — so genesis events could be written the first
  time a page is commanded, which cannot miss a trip created between deploying a
  migration and running it. Neither was a step skipped; both were findings.
- **The 402 wall is about the environment, not the code.** An agent cannot build
  a two-member trip on the preview, so the two-actor gate box could not be
  self-served however the code behaved. Measuring that precisely — and saying so
  in the box rather than substituting a local proxy and calling it the walk —
  is what let Mitchell close it in one pass.

### What actually went wrong, and the pattern under it

**Six mutations changed nothing.** Every one was a test that looked like
coverage and was not, and the pattern was the same each time: *a negative
assertion with nothing establishing that the path under test ran at all.*

1. Nothing covered `TripProvider` bumping `remoteRevision`. Deleting the bump
   passed a 39-test suite.
2. The re-read test used a *failing* fetch, and `cachedRead` stores only
   `ok: true` — so the cache was never warm and the invalidation could not
   have mattered.
3. It then asserted on the page *list* rather than the page *document*, which
   is the thing that goes stale.
4. The first regression test for the editor re-sync flipped the mode without
   typing, so the editor never diverged from `value`, the broken code
   short-circuited, and **both implementations passed**.
5. `"does not bump when the poll finds nothing"` never checked the poll ran. A
   dead `enabled` gate made it true for the wrong reason — found by CodeRabbit,
   confirmed by killing the gate.
6. **The worst one asserted the bug.** `"makes a notebook edit undoable without
   deriveUndoRedo knowing about pages"` pinned a page-only batch as the undo
   target — which is precisely the state that wedged undo forever. The bug had
   a comment defending it *and* a test enforcing it.

The through-line: rule 3 says a test is not done until you have seen it fail,
and five of these six were written by someone who believed that and skipped the
step anyway. The sixth was caught by a reviewer. **Watching it fail is not a
formality at the end; it is the only thing that distinguishes a test from a
comment that runs.**

Three more defects reached CI or a preview, each a claim that outran the code:

- **The projection rebuild broke for every trip on the instance.** Both
  projectors parsed every envelope as a `TripEvent`, and a rebuild reads every
  stream — so one trip with a notebook event took out the rest. It surfaced as
  five failures that passed in isolation, which is the shape of a shared-database
  accident rather than a unit bug.
- **The public API was a divergence bug.** `/api/v1`'s page routes still wrote
  the table after the BFF routes moved to commands, so a v1 edit changed the row
  without an event and the next command decided from a stale copy.
- **The live-update fix broke leaving edit mode.** `content` is a mount-time
  option of `useEditor`, and the first fix keyed its re-sync on the `editable`
  flip rather than on the prop changing — so "Done editing" pushed a
  fetch-stale document over everything just typed. Caught by two e2e specs,
  one desktop and one phone, which is the lane that exists for exactly this.

### One process note worth keeping

A claim about the day-columns scroll regression was posted publicly with
`origin/main` stale in the working tree — #200 had moved the base and the two
commits blamed were already on it. The correction is kept in the PR body rather
than deleted. **Fetch before attributing a regression to a diff**, and prefer
"this is in the diff" to "this is from this work" when the two differ.
