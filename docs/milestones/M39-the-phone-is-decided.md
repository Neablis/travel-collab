# M39 — The phone layout is decided once, and Caesura installs like an app

**Status:** **Scoped 2026-10-08.** The critique was held as a decision table rather than a
live design-sync session (`docs/design-feedback/2026-10-08-M39-phone-tablet-critique.md`, PR #362),
and Mitchell answered every row on 2026-10-08: all as recommended **except the phone landing**,
where a trip keeps opening on Overview and Overview gets a phone-sized design. Two parts (the phone
Overview and the phone conflict state) need a design-sync artboard before they are built. Placed
after M38; minted from `docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 —
proposed: M37 to M47*).

## Why this exists

The phone layout has been settled piece by piece in KI fixes, and five open entries say they need
a layout decision rather than a fix. Mitchell, 2026-09-25: *"I want to do a design critique soon
too, so we can combine those layout issues."* The PWA candidate (2026-10-02: *"add the PWA to
potential future work"*) depends on that critique. Its second tier, *"feels like an app"*, is
mostly the same phone-layout work, and `viewport-fit=cover` exposes the missing top inset. The
phone's missing conflict state (DRIFT §8) is design-owed work on the same screens. These go
together because deciding them separately would give three answers to the question of what a
phone shows.

Candidates absorbed (each deleted by this gate):
- *Design critique: phone and tablet layout, decided once* (2026-09-25), which carries
  `KI-2026-09-24-i`, `KI-2026-09-25-f`, `KI-2026-09-24-j`, and `KI-048` items 3 and 5
- *Caesura installable as a phone app, as a PWA and not a store release* (2026-10-02): the
  **installable** and **feels like an app** tiers only
- *The phone has no conflict state* (2026-09-01)

## Decisions (answered 2026-10-08)

The full table, options and trade-offs are in the critique document; this is the answer only.

1. **The critique** was held as a decision table (above). The two parts that need a design get it
   through design sync before they are built; `.design-sync/**` is a build input.
2. **A trip opens on Overview on a phone, too**, and Overview gets a **phone-sized design**
   (`KI-2026-09-25-f`). *Not* the recommendation (Plan). SPEC §24 is unchanged; a phone rendering of
   Overview is added to it through the design sync. The `phoneAskContext` mapping
   (`TripBoardScreen.tsx:856`) is fixed in the same part.
3. **Tablets keep the 44px floor on any `pointer: coarse` device**, whatever its width; at 768–1100px
   the board stays desktop and **Ask opens as an overlay sheet**, moved off the stop costs
   (`KI-2026-09-24-j`, §13.5).
4. **The service worker caches static assets only**, never `/api/**`, `/s/**`, `/invite/**` or
   `/monitoring`. Hand-written (Turbopack). Offline trip data stays out.
5. **Push notifications stay out** until M46's chat.
6. **Phone header** (`KI-2026-09-24-i`): one pinned ~56px row (short title, overflow menu holding Add
   stop and History) with the day rail under it; status and dates scroll away; Unscheduled becomes a
   row at the end of the day instead of a fixed rack.
7. **Day chips** (`KI-048` item 3): an edge fade on the side with more, plus snap to whole chips.
8. **Trip-settings date editor** (`KI-048` item 5): inline, confirmed, with an e2e.
9. **Phone conflict state**: a count chip in the pinned row that opens a sheet, plus a marker on the
   affected stop card.
10. **`viewport-fit=cover`** ships together with the top-inset fix on the pinned header.

## Scope — the build, as six parts

Each part is one PR in a stack (`docs/guidelines/stacked-prs.md`). Sizes are the critique's
estimates. **Parts 1–4 can be built now; 5 and 6 wait on a design-sync artboard.**

| Part | What | Closes | Size | Needs |
|---|---|---|---|---|
| 1 | Day-chip fade + snap; inline date editor with its e2e | `KI-048` items 3, 5 | ~1 day | — |
| 2 | Phone header: one pinned row + day rail; Unscheduled as an end-of-day row | `KI-2026-09-24-i` | 2–3 days | — |
| 3 | Touch floor on `pointer: coarse`; tablet Ask as an overlay sheet, off the stop costs; a tablet e2e project with `hasTouch` | `KI-2026-09-24-j` | ~3 days | — |
| 4 | Installable: `app/manifest.ts`, PNG icons, `viewport` export with `viewport-fit=cover` and the top inset, static-asset service worker with a route-matcher unit test seen red | PWA gate boxes | ~1.5 days | Part 2 (the inset lands on its header) |
| 5 | Phone-sized Overview; `phoneAskContext` fix | `KI-2026-09-25-f` | ~2 days after design | Design-sync artboard |
| 6 | Phone conflict chip + sheet + stop-card marker, with a test seen red without it | conflict gate box | ~2 days after design | Design-sync artboard; Part 2's pinned row |

Then the gate: the e2e specs on `test:e2e:ci-like` including `phone`, Mitchell's walk on a real
iPhone and Android (sign-in, an emailed invite link, long-press drag), and the retro.

## Out of scope

- Offline trip data, push notifications, and app-store wrappers (TWA or iOS).
- *Save light: move Retry into a popover*, which stays a candidate.

## Exit gate

- [x] **The critique is held and every bullet has a recorded decision**, with links from each KI
      entry. *Ticked 2026-10-09: the decision table is in the critique (PR #362), and
      `KI-2026-09-24-i`, `-25-f`, `-24-j` and resolved KI-048 each carry a* Decided *line citing it.*
- [x] **`KI-2026-09-24-i`, `KI-2026-09-25-f`, `KI-2026-09-24-j` and `KI-048` items 3 and 5 are
      resolved** (moved to `resolved/`) or explicitly re-scoped by the critique. *Ticked
      2026-10-09: KI-048 resolved by Part 1 (PR #363), `-24-i` by Part 2 (PR #364),
      `-24-j` by Part 3 (PR #365) and `-25-f` by Part 5 (PR #367), all merged.*
- [x] **The phone shows a conflict state**, with a test seen red without it. *Ticked
      2026-10-09: Part 6 (PR #368, merged). A count chip in the pinned row opens a sheet of the
      trip's conflicts; `e2e/m39-phone-conflicts.spec.ts` failed with the chip removed
      (`Expected: "2 things to look at"`, element(s) not found), as did `ConflictsChip.test.tsx`.*
- [x] **Caesura passes Chrome's installability check**: a manifest with icons, a service worker
      and a viewport. An e2e or a Lighthouse assertion records this. *Ticked 2026-10-09: Part 4
      (PR #366, merged). `e2e/m39-installable.spec.ts` asks Chromium for
      `Page.getInstallabilityErrors` and expects none; it was seen red without `manifest.ts`
      (`no-manifest`). CI was green on the merged head.*
- [x] **The service worker never caches an API or token route**: a unit test over its route
      matcher was seen red with `/api/` allowed. *Ticked 2026-10-09: Part 4 (PR #366, merged).
      `src/lib/serviceWorker.test.ts` runs the real `public/sw.js`; with `/api/` allowed it
      failed with `expected 'cache-first' to be 'network'`. Since the hotfix #374 (merged
      2026-10-09, `KI-2026-10-09-e`) the worker has no `fetch` listener at all, so it answers no
      request: `serviceWorker.test.ts` now holds "registers no fetch listener", and
      `m39-installable.spec.ts` checks the worker answers nothing.*
- [x] **The e2e specs pass on `pnpm --filter web test:e2e:ci-like`**, including the `phone`
      project. *Ticked 2026-10-09: on `main` at `814f469` (#373's merge, the merged top of every
      M39 PR), 290 passed in 7.5m, none failed, flaky or skipped; 40 of them in the `phone`
      project.*
- [x] **[walk]** Installed to a real iPhone and a real Android home screen. Sign-in, opening an
      emailed invite link, and long-press drag on the board are each walked and recorded. These are
      the open questions from the PWA entry, and none of them has been walked on a device yet.
      *Ticked 2026-10-09 on **Android only**, by Mitchell's call. On his Pixel, against production
      with all of M39 merged, Caesura installed, and sign-in, an emailed invite link and long-press
      drag on the board all worked. **The iPhone half was not walked**: there was no iPhone to walk
      it on, and Mitchell accepted Android as enough to close. That half is open as
      `KI-2026-10-09-f`.*
- [x] A retro is appended at gate close. *Ticked 2026-10-09: below.*

## Retro — gate closed 2026-10-09 (8 of 8)

**What shipped.** The critique (#362), seven planned parts and four PRs the build turned up, all
merged 2026-10-09:
- **Part 1 (#363):** the day chips fade and snap, and dates are edited inline (KI-048 items 3 and 5).
- **Part 2 (#364):** the phone header is one pinned row plus the day rail, and Unscheduled is the
  day's last row (`-24-i`).
- **Part 3 (#365):** a 44px touch floor on `pointer: coarse`, Ask opens over the board on a tablet,
  and a touch-tablet e2e project (`-24-j`).
- **Part 4 (#366):** a manifest, icons, a `viewport` with `cover` and both insets, and a service
  worker. Chromium's installability check passes.
- **Part 5 (#367):** a phone-sized Overview, built from the §19 artboard (`-25-f`).
- **Part 6 (#368):** the phone shows conflicts as a count chip that opens a sheet. Suggestions
  became a count to fit the row.
- **Part 7 (#369, then #371):** safe-area insets on every pinned and fixed layer `-09-a` listed.
  #371 holds its self-review's fixes.
- **Found on the way:**
  - #372: the icons, favicon and OG card drew the old ◎. Mitchell saw it on his Pixel.
  - #374: a hotfix for lost edits, covered under *What did not* below.
  - #373: an *Install app* row in the account menu and a one-time phone nudge, Mitchell's
    option B. It came from his Pixel never offering to install.

**What held.**
- **The critique decided the layout once, and the build did not reopen it.** Where the plan had not
  anticipated something, the choice went to Mitchell as a question with a recommendation: Part 5's
  source, Part 6's row fit, the install entry points. Each PR lists the smaller choices for him to
  confirm.
- **Walking at 390px found what tests had not.**
  - Part 5's breadcrumb pushed the page to 532px wide.
  - Part 6's row squeezed the trip title to 44px.
  - Both were fixed before review, and each now has an e2e assertion.
- **"Flaky" was refused, and that found a data-loss bug.** `m6-unload-flush` started failing
  intermittently once Part 4 merged. It was investigated rather than retried.
  - The cause: the worker's `fetch` listener put the pagehide keepalive flush through the worker,
    and edits queued at a reload were lost in production (`KI-2026-10-09-e`).
  - #374 removed the listener. Its new test failed 9 of 10 runs on the old worker and passed 20 of
    20 with the fix.

**What did not.**
- **Part 4 shipped a worker that lost edits, and nothing caught it before production.** The
  worker's `fetch` listener never called `respondWith`. It looked inert, but it still put every
  request through the worker, including the unload flush. The existing unload test ran without a
  worker in control, so it could not see this.
  - **Next time:** a service-worker change is a change to every request. Any test of unload or
    offline behaviour runs with the worker controlling the page (`controller !== null`).
- **A review suggestion was applied without being checked, and it was wrong.** On CodeRabbit's
  suggestion, Part 7 removed `skipWaiting()`. Without it, an installed app never picks up an
  update. The self-review restored it in #371.
  - **Next time:** a bot finding is a claim to trace, not an order (`working-a-review.md`).
- **#369 merged before its self-review's fixes were pushed,** so they shipped separately as #371.
  - **Next time:** say on the PR that a self-review is in progress, so it isn't merged until the
    fixes land.
- **The icons drew a retired mark.** `scripts/generate-og-assets.mjs` still drew the ◎ in the old
  `#0e7c66`. No test knew which mark was current, so Part 4 passed with it and Mitchell found it
  on a device.
  - `brandIcons.test.ts` now holds the two-stroke mark, in both `icon.svg` and the OG card.
- **Parallel agents ran e2e on the same machine at once.** The install agent and the
  investigation agent overlapped, and their results had to be re-run. Also, `pgrep` matched its
  own command line until the `[p]laywright` pattern.
  - **Next time:** check `pgrep -af "[p]laywright/test/cli|next start"` in its own command before
    every e2e run.
- **The device walk covered Android only.** There was no iPhone. The iOS half is open as
  `KI-2026-10-09-f`, with what to walk.
