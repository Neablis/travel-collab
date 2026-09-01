# M11b — Playbooks becomes a public library

**Status:** Approved 2026-08-28 (carved out of M11's gate). **Scoped and placed
2026-08-30** by Mitchell, on the design handoff's `SPEC.md` §15 / `DRIFT.md`
§2b. Phase 2, running after M17 and **before M12**.

**Opened by:** M11's gate close, 2026-08-28 — Playbooks/templates stayed in
M11's file but none of its eight exit-gate boxes tested it and none of its six
links touched it, so it left as its own follow-on, *approved and unplaced*. It
stayed unplaced for one reason: it had no scope and no exit gate, and writing
those was a product decision rather than overnight work. **The 2026-08-30
design handoff is that decision arriving.**

## Status — scoped and placed, 2026-08-30

`SPEC.md` §15 turns Playbooks from a private grid with a city dropdown into a
**discovery surface over other people's days**, across four routes — `playbooks`
(Discover), `day`, `board` and `profile`, three of them new. That is the scope
this milestone had been missing.

**The scope line was drawn deliberately, and it is not §15's line.**
`docs/milestones/README.md` defines **M12 Community** as *"public gallery,
discovery, voting, reporting — all trust & safety scope quarantined here,
nowhere earlier"*, and §15 is a public gallery with discovery and voting. On
2026-08-30 Mitchell's explicit decision was: **M11b takes everything in §15
except reviews; M12 keeps reviews and moderation.** Everything below follows
from that, including the two deltas from the spec text and the invite-gate
precondition — both recorded rather than smoothed over.

## Why this exists

The four Playbooks surfaces have been shelled behind `<Preview>` since M10 and
tagged M11 in `preview-registry.ts` ever since — `home-playbooks-strip`,
`playbooks-route`, `insert-playbook`, `wizard-playbook-panel` — plus a whole
`/playbooks` route rendering mock cards
(`apps/web/src/app/(app)/playbooks/page.tsx`, 18 lines, entirely inert).
M11 link 6 built the data model they would stand on: `savedDays` is a real
table and `SavedDay` is a real contract (**ADR-029**).

What is missing is that a saved day is *personal*. It belongs to one person,
has no cities, no visibility and no way for anyone else to find it. This
milestone is the step from a private library to a public one.

## The shape of the problem

`DRIFT.md` §2b lists what a build needs first. Checked against the tree on
2026-08-30, **none of it exists**:

| Needed | Today |
|---|---|
| `cities: string[]` per saved day | Absent. `SavedDay` has `stops[]`, each with a nullable `location` — the cities are derivable but never derived. **The largest blocker on the list.** |
| A city search endpoint | Absent. The design asserts `GET /cities?q=` |
| Public visibility on a day | Absent. `savedDays` is keyed on `owner_id` and read nowhere else |
| Denormalised `adds` counter | Absent |
| An adds ledger keyed by (day, trip) | Absent — and the leaderboard's ranking rule is not implementable without it |
| A reviews table | Absent — **and stays absent. M12's.** |

`saved_days.stops` is `jsonb` on purpose (ADR-029: a saved day is a value,
copied in and out whole, never queried into). `cities` must therefore be its
own column, derived and stored at save time — a snapshot, on the same terms as
`source_trip_name`. Deriving it per query would mean querying into the jsonb
the ADR says is not queried into.

## Scope

**Link 1 — `cities: string[]` on a saved day.** Derived from the stops'
`location` at save time and stored as its own column; a snapshot, like
`sourceTripName`. Needs a migration and a backfill decision for existing rows.

**Link 2 — City search.** `GET /cities?q=` over a city index carrying region
and a day count, debounced. Four real states: loading, results, "no city
matches", and a failure state with **Retry**. **The static `<option>` city
dropdown is deleted and must not come back** — this is called out twice in the
handoff.

**Link 3 — Publishing.** Visibility on a saved day, **private by default**, with
the author able to publish and unpublish. *Unpublish is in scope here and not in
M12*: it is the author's control over their own content, it ships in the same
change as the ability to publish at all, and a publish button with no way back
is not a thing to ship. Reporting **someone else's** day is M12.

**Link 4 — The adds ledger.** Keyed by (day, trip), plus the denormalised `adds`
counter it feeds. The rule, verbatim from the design's own copy: *an add only
counts once per trip, and only after the trip has dates; copying your own day
into your own trip does not count.* `SPEC.md` §15 is blunt about why this is a
link and not a detail — **a build that counts raw inserts will produce a
different and gameable order**, and that rule is the whole credibility of the
board.

**Link 5 — Discover (route `playbooks`).** Replaces the shell. A day matches on
**any** city it contains — a Kyoto query returns the Uji day, matched city
filled and the rest outlined, with a per-card line ("Kyoto matched · also Uji").
Ranking is matched-city count first, then the chosen sort. Sibling chips surface
cities present in the result set but absent from the query, with counts, one tap
to add; an empty query shows a "busy right now" city row instead.
`Everyone / Yours / Saved` is a **scope segment, not a second page** — your own
library is a filter on this page (rule 5). Skeleton grid while fetching, an
`EmptyState` offering *Drop the filters* / *Search everywhere*.

**Link 6 — Shared day (route `day`).** Full stop list with per-stop notes and
city chips; author strip (name, days shared, how often their days were added)
linking into the profile; sticky rail with the facts — stops, window, budget
each, month, adds — and **Add to a trip** wired to the **existing** insert
dialog, not a new one. *(The rating, the 5→1 histogram and the review states are
M12 — see "Explicitly not here".)*

**Link 7 — Leaderboard (route `board`).** Ranks on link 4's ledger and nothing
else — not ratings, not post volume. The page **states the rule in copy**. Your
own row is tinted and badged, **never pinned to the top**. **Not in the top bar**
— it is trip-independent but not account scope, so it is entered from Discover
("Who shares the most"), per project rule 1. There is no empty state, because
the board cannot be empty while any day is shared.

**Link 8 — Public profile (route `profile`).** **Derived, never authored** —
every number is computed from that person's days, so a profile can never
disagree with Discover. No bio, no follow, no avatar upload, and **no public
user record**: a profile answers "is this person worth taking a day from" and
nothing else. "Knows" city chips run a Discover search scoped to that city.
Back links are contextual — the same page is reachable from `day`, `board` and
Discover, and returns to whichever it came from.

**All four `<Preview>` shells are deleted, not re-pointed.** They are the last
M11-tagged entries in `preview-registry.ts`.

## Explicitly not here

Everything below is **M12's**, by the 2026-08-30 scope decision:

- **Reviews** — the table, the stars, the ≤140-character note, the live average
  recompute, and the three review states (empty / offline-*Queued* / conflict).
- **Ratings anywhere** — the shared day's rating and 5→1 histogram, the
  `rating` / `reviewCount` counters, and the profile's average rating and
  reviews-received numbers.
- **Reporting and moderation** of another person's day — deliberately, because
  the population is invited and small. See "Moderation waits on the invite
  gate" for the precondition that makes that true.

### Three deltas from `SPEC.md` §15, and why

The first two are consequences of the reviews carve-out; the third is a data
model that does not exist. All three are recorded here so a build session does
not read them as an implementation miss:

1. **Discover ships two sorts, not four.** §15 specifies *most added / highest
   rated / most reviewed / newest*. Two of those have no data until M12. M11b
   ships **most added** and **newest**; M12 restores the full four.
2. **The rating floor filter does not ship.** §15 specifies four filters —
   rating floor, month, budget per person, sort. M11b ships **three**, and M12
   adds the floor with the reviews that make it mean something.

Shipping a rating floor over data that does not exist would be a control that
does nothing (project rule 2) and a number the product cannot stand behind.
§15 itself says *"until the reviews table exists, every rating here is fixture
data"* — this milestone's answer to that is to not ship the control, rather than
to ship it against a fixture.

3. **`GET /cities` returns `{ city, days }` and no region.** §15 shows a region
   beside each city ("Kyoto, Kansai"). **Nothing in the data model holds one**,
   and the gap is deeper than a missing column:

   * The only geographic qualifier on a `Location` is `countryCode`
     (`packages/contracts/src/activity.ts`) — country, not region.
   * The geocoder **does** have the data and discards it. LocationIQ is
     Nominatim-derived and its `addressdetails=1` response carries `state` and
     `county`; `apps/web/src/server/geocoding/locationiq.ts` reads only
     `country_code`, `city`/`town`/`village`/`hamlet` and
     `suburb`/`neighbourhood`/`quarter`/`city_district`. So closing this starts
     at the geocoder, not at the endpoint.
   * It would then need a contract field (its own PR, invariant 5), a
     **snapshotted column** — `stops` is jsonb ADR-029 says is never queried
     into, which is exactly why `cities` is a column and not a derivation — and
     a backfill, because every location already geocoded was captured without
     it.
   * `region` is already taken. It means a geocoding **bounding box** in this
     tree (`geocodeRegion.ts`, `TRIP_REGION_MARGIN_KM`). A second meaning would
     be a genuine ambiguity; `state` or `adminArea` is the name.

   Shipped without it deliberately. A field nothing can populate would be null
   in every demo, preview and screenshot — the M18 tag-chip failure the
   Definition of Done names by name — and the response shape extends without a
   breaking change whenever the chain above is built. **Mitchell's call,
   2026-08-31.** That chain is milestone-sized rather than a follow-up, and no
   milestone owns it yet.

### Moderation waits on the invite gate, not on good luck

**Raised before the decision and answered by Mitchell on 2026-08-30:** *"We will
gate on who we invite to platform, we dont need reviews shipping first, we need
a community before its a issue."*

That is the reasoning this split rests on, and it is sound — moderation tooling
built for a population that does not exist yet is tooling built against a guess.
This milestone publishes user-authored free text (stop titles and per-stop
notes) with no reader-facing report path until M12, and the control that makes
that safe is **who is let onto the platform at all**, not a report button.
Link 3's unpublish gives the author a way back; the invite gate is what bounds
who can post in the first place.

**One thing has to be true for that to hold, and today it is not.** There is no
gate on who signs up: any Google account that reaches `/signin` gets one. The
"Early access" line on the landing page (`LandingScreen.tsx:122`) is copy about
*trip* invites, which is M11's link-bearer work, not signup gating. So the
premise the scope split depends on is a **product intent that has not been
built**.

**The seam to build it already exists, which makes it small.**
`server/auth.ts` composes the Auth.js `signIn` callback out of
`server/users.ts`'s `recordSignIn`, which already returns a boolean and is
already documented as *"deliberately fail-closed on both paths, because the
point of the table is that no session can exist for a person who has no row"* —
returning `false` lands on the designed `/signin?error=` screen. And `users`
(ADR-025) is already the record of who has been here, so "never been to the app"
is *"has no `users` row"* and needs no new concept. The one genuinely fiddly
part is that OAuth leaves the site: a code has to be captured **before** the
browser goes to Google, so it rides a short-lived cookie that `recordSignIn`
reads and redeems.

**That gate is now M11a, and it runs immediately before this milestone.**
`M11a-invite-gate.md`, scoped and placed 2026-08-30 in the same session as this
file: three ways through — a pending M11 trip-invite token, a reusable super
code, and single-use codes — evaluated only when there is no `users` row. It is
placed first rather than folded in here for one reason: **publishing must not go
live on an open signup** while the plan of record says the population is
invited.

## Exit gate

- [x] A saved day carries `cities: string[]`, derived from its stops at save
      time, and existing rows are backfilled. **The migration is written,
      applied locally, and its production dispatch is called out in the PR
      body** — `gh workflow run migrate-production.yml -f confirm=migrate` from
      `main`. Merging does not apply a migration.
- [x] City search shows all four states against the real endpoint — loading,
      results, "no city matches", and failure with a working **Retry**. No
      `<option>` city list exists anywhere in the tree.
- [x] A query for one city returns a day that contains it **among others**, with
      the matched city filled, the rest outlined, and the per-card line present;
      results rank by matched-city count before the chosen sort.
- [x] A day is **private by default**; publishing makes it findable by another
      signed-in account, and unpublishing removes it from that account's
      Discover results. Walked as two actors.
- [x] **The add rule holds on all three negative cases**: the same day added
      twice to one trip counts once; an add to a trip with no dates does not
      count; the author adding their own day to their own trip does not count.
      Proven against the ledger, not the counter.
- [x] The board ranks on the ledger, states its rule in copy, tints and badges
      your own row **without pinning it**, and **is not reachable from the top
      bar** — only from Discover (project rule 1).
- [x] Every number on a profile is derived, and a profile's day count and adds
      **agree with the same person's numbers in Discover** — checked against a
      seed where they could disagree.
- [x] All four Playbooks `<Preview>` shells are **deleted** from
      `preview-registry.ts`, and no M11-tagged entry remains.
- [x] Each of the three new routes has a defined **empty, offline/sync-fail and
      conflict** state (project rule 6) — except the board's empty state, which
      §15 rules out by construction and which this gate therefore does not
      require.
- [x] **Publishing does not go live on an open signup** — **M11a's gate has
      closed**, so the platform is invite-gated before any day can be made
      public. This is the precondition the scope split rests on (see "Moderation
      waits on the invite gate"). It is a real box: if M11a slips, this
      milestone's publishing link waits rather than shipping past it.
- [x] The milestone's e2e script is green on `pnpm --filter web test:e2e:ci-like`
      **twice against a production build**, and the publish → discover → add
      flow is **walked in a browser** as two actors. A suite pass is not the
      gate; four consecutive milestones have had a defect the suite could not
      see.

## Prerequisites

- ~~**M17 closes first.**~~ **Amended 2026-08-30, and this is the one
  consequence of jumping M17 that costs something.** The reason for the
  prerequisite stands: link 6's author strip and link 8's profile both show a
  person's name, and M17's preferences half is what resolves `who` to a display
  name. With M17 moved to after this milestone, **both surfaces build against
  the identifier that exists today**, behind a single resolver seam — one
  function that today returns the identifier and after M17 returns the display
  name — so M17 fills it by changing that resolver rather than two routes.
  Accepted with the decision, not an implementation miss. Do not scatter the
  fallback across the two routes; if a second call site appears, the seam has
  been built wrong. Reorder note: `docs/milestones/README.md`.
- **M11a closes first**, and unlike M17 this one is a real dependency, not just
  sequencing — see the publishing gate box. `M11a-invite-gate.md`.
- **M11 link 6 is done** — `savedDays`, `SavedDay`, `SavedStop`, ADR-029.
- **`AGENTS.md` reserves the contracts step as its own reviewed PR.** Links 1
  and 4 both change contracts; expect that PR before the route work.

### `DRIFT.md` is stale in four places — read this before chasing an entry

The bundle's `DRIFT.md` was read from the build on **2026-08-26** and only §2b
was refreshed this pass. Verified against the tree on 2026-08-30:

- **D1** (rename to Caesura) is **closed** — `siteMetadata.ts:17` is `Caesura`.
  It is still §"Suggested order" item 1.
- **D2 / D8** (the landing page has no route) are **closed** — M15 shipped it at
  `(front)/welcome`, `LandingScreen.tsx`.
- **KI-47** (no `tags` field) is **resolved** — M18 landed it. §7 still lists it
  as blocking five surfaces, and §2b calls the missing `cities[]` *"bigger than
  the missing tags"* on that basis.
- **KI-43, KI-44, KI-45** are all **resolved**. §7 lists all three as open.

`D9` (Playbooks scope), the §2b prerequisite list and the §6 build-check list
are current, and D9 is what this milestone closes. **Feed the four stale entries
back to design** rather than editing their bundle — the folder is rewritten in
place by the design side, so a build-side edit is drift by construction.

## Gate closed — 2026-08-31

**All eleven boxes met.** `pnpm check` exit 0 (1915 web unit, 427 integration,
18 fixtures) and `test:e2e:ci-like` green against a production build; the
publish → discover → add flow walked as **two actors**, and the `cities`
backfill run against production. **M11a's gate closed first** — box 10 is not a
formality, it is the precondition the whole scope split rests on.

## Retro — 2026-08-31

**Nineteen review findings across the stack, and fourteen were the same defect:
a test that passes while proving nothing.** That number is the milestone's real
output. Every one of the nineteen was green locally, and `pnpm check` cannot
catch this class by construction — a test written by the same session as the
implementation inherits its assumptions, which is now the fourth consecutive
gate to say so.

**The fixture built to catch swapped numbers held a swappable pair of its own.**
`expectations.ts` claimed "no two numbers a bug could swap are equal" and then
listed only the CROSS-OWNER pairs, while `dev-alice`'s own days (3) and adds (3)
were equal — and the profile header renders exactly those two side by side. The
test underneath enforced only the cross-owner half, so three assertions passed
over it. This is the sharpest instance of the milestone's own theme: **the
artefact designed to prevent a class of defect contained one, because its
comment claimed more than its test enforced.**

**A second-order version of the same thing, in this session's own fix.** The
responsive test named three overlays and asserted two; the first fix for it
asserted the focus card's absence BEFORE any day was focused — a state where the
card never renders on any build — and its presence at desktop, where nothing is
focused on load. Both were vacuous or wrong, and `test:e2e:ci-like` caught it,
not review. **Writing an assertion about vacuous assertions is not immune to
being vacuous.**

**Stacked PRs and squash merges do not compose, and nobody had said so.** Each
branch merged its base forward, so when #99 squash-landed, `main` held M11a as a
commit sharing no ancestry with the branches carrying the same files: five
`add/add` conflicts on files neither side edited twice, and it would have
recurred for #101 and #102, growing each time. Rebasing each layer onto `main`
after the one below merged removed it entirely — and shrank #100's reviewable
diff from 39 files to 21, because the duplicated content stopped appearing as
branch additions. Worth a line in the guidelines rather than relearning at the
next stack.

**What the walk found that nothing else did.** M11b's own defect was a dialog
taller than the viewport hiding its own top, leaving the first row unreachable
by mouse, keyboard and Playwright alike — latent for every dialog in the app,
surfaced only because a leaking e2e spec had grown the saved-days library past
one screen. The leak was the bug's only witness.
