# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

**This file is live instruction only, and it is kept short on purpose.** It hit
1,779 lines on 2026-08-28, ~88% of it history, in the one file every session is
told to read first — so a first-read file became a file people skim. The rule
now: **at gate close, a phase's narrative moves to its milestone file or a retro
in the same commit, and this file keeps the pointer.** Everything that was here
before 2026-08-28 is in `docs/retros/2026-08-28-status-archive.md`, verbatim and
in order, with an index mapping each part to its durable home. Nothing was
deleted.

**It drifted back and was cut a second time, 2026-09-11** — to 1,418 lines, with
a `## Next action` section still naming M17 as the current work on the day M17's
gate closed. Length was the symptom; **the stale section was the defect**, and it
is the reason to distrust a long first-read file rather than merely resent it.
Lines 243-1188 are now `docs/retros/2026-09-11-status-archive.md`, same rule,
same verbatim treatment. If this file is over ~300 lines again, that is the
signal, not a style preference.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**M27 — THE SIMPLIFY PASS — IS THE CURRENT MILESTONE AS OF 2026-09-23**, placed
by Mitchell ahead of M12 to build the 2026-09-22 design pass (SPEC §35). All
ten links are built on `claude/admiring-goodall-librbf`; the gate's `[walk]`
boxes are open. Scope and the seventeen decisions:
`docs/milestones/M27-simplify-pass.md`. **M12 is next**, and what follows is
its placement, unchanged:

**M12 — REVIEWS AND MODERATION — WAS THE CURRENT MILESTONE FROM 2026-09-22**,
by **M13's gate closing at 10 of 10** — the second consecutive move made by a
gate rather than by Mitchell placing a milestone. Order:
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 ✓ → M21 ✓ → M22 ✓ → M25 ✓ → M23 ✓ → M26 ✓ → M13 ✓ → M27 → M12 → M24 → M14 → M19`.
Scope, seven links and thirteen boxes: `docs/milestones/M12-reviews-and-moderation.md`.
It needs **two migrations** (the reviews table, and `saved_days.countries`) and
has a data prerequisite: the content library carries `countryCode` on **none**
of its 1,375 locations. M12 exists to delete one line from `SPEC.md` §15 —
*"Until the reviews table exists, every rating here is fixture data"* — still
true in `main`.

**What M26's close does and does not assert** — including the two boxes closed
on attestation and the Definition-of-Done box ticked at 153/2 rather than green
— moved to `docs/milestones/M26-design-parity.md` on 2026-09-22, same gate-close
rule as the section below.

## DONE 2026-09-22 — M13 Collaboration, gate closed 10 of 10

**Moved to `docs/milestones/M13-collaboration.md`** — the five links, the
notebooks-in-the-event-log piece that came with them, and the retro. M13's gate
closed 2026-09-22 and this file's rule is that a phase's narrative moves to its
milestone file at gate close, leaving the pointer. Merged as `#201` (`99f32d3`),
green on CI at `18623fb`; the two-actor walk box is ticked **on Mitchell's
attestation**, recorded as such in the box.

**Four things in it are still live and are still instruction:**

1. **Read `KI-2026-09-22-c` before touching undo.** Wiring `diffPageStates` into
   `decideHistoryCommand` looks like two lines and would delete every notebook on
   a revert. A test pins the safe state; the entry has the trace and three answers.
2. **A page-only batch is deliberately NOT undoable.** `deriveUndoRedo` skips any
   batch with no trip events. Stacking one wedges undo entirely — the trip diff
   comes back empty, the command is rejected `nothing-to-undo`, nothing is popped,
   and every earlier change sits unreachable behind it. The same skip is why a
   notebook save no longer throws away the trip's redo. Both directions are tested.
3. **Any new reader of the log must skip the other aggregate's events BY NAME**,
   never by "whatever fails to parse" — that is what keeps a corrupt stream loud.
   `foldEnvelopes`, `foldPages` and both projections do it; the rebuild path was
   caught missing it only by the full int lane, as five failures that passed in
   isolation.
4. **`KI-2026-09-22-d`** — the notebook EDITOR still does not adopt a
   co-traveller's edit while you are typing in it, deliberately: a re-read would
   clobber in-progress work. It wants link 4's conflict-as-data shape.

## DONE 2026-09-20 — the shared day's map panel (M26 link 4b)

**Moved to `docs/milestones/M26-design-parity.md` on 2026-09-22**, verbatim,
under *The shared day's map panel (link 4b)* — M26's gate closed 2026-09-21, and
this file's own rule is that a phase's narrative moves to its milestone file at
gate close and the pointer stays here. **Two things in it are still live and are
still true**: `gaps[idx].label` is computed and not rendered, and the
3.5s/7.5s/11s recovery ladder is not wired into `SharedDayMap` — which is what
keeps M26 link 4 open rather than the rendering.

## Live rules that the code cannot enforce

Three standing facts, kept here because each is instruction rather than history and
nothing in CI will tell you when one is broken. The narrative each came from is in
`docs/retros/2026-09-11-status-archive.md`.

- **Merging does not apply a migration. Production is at `0020` and nothing pending.**
  `gh workflow run migrate-production.yml -f confirm=migrate`, from `main`, is the only thing
  that applies one, and the answer is checkable rather than remembered: 21 rows in
  `drizzle.__drizzle_migrations` on the production branch, which is `0000`-`0020`. *(This
  entry used to say `0018` was NOT applied; it was dispatched as run 19 on 2026-09-13 and the
  rule outlived its example. `0019`/`0020` went out as run 20 on 2026-09-14.)* Runbook:
  `docs/guidelines/content-bundles.md` for what `0018` unblocks (`--prune` against a bundle
  that has stopped declaring content).
- **The `ai-live` flag's dashboard fallthrough stays "Simulated" until release, then flips
  to "Live"** — ADR-019's **2026-09-13 amendment**, which reverses the 2026-09-08 rule that
  it must stay Simulated forever. Until the flip the old reasoning holds exactly: targeting
  only ever *widens*, a caller no rule matches falls through to the default, and that default
  is the only thing keeping anyone off. **The flip is safe only after M20's entitlement gate
  is live in production** — `selectAiModel` checks entitlement *before* the flag
  (`modelSelection.ts:215-218`), so a paid-account check becomes the spend control and the
  flag goes back to being an emergency disable. Flipping it early leaves an interval with no
  spend control at all. **That precondition was met 2026-09-14**: the gate is live in
  production and migrated, so the flip is now a decision rather than a dependency — and
  Mitchell's, not a session's. Note what it would expose today: every account that predates
  0019 holds a permanent `founder` grant, so the spend control binds on new accounts and not
  on those. After the flip, keep Production's rule list empty: a widening rule
  would make *the rule* load-bearing, and disabling in a hurry must stay one action. It lives
  in the Vercel dashboard and no test can assert any of it.
- **e2e refuses to start unless `AI_LIVE=false`.** `/api/health/ai-mode` reports
  `{ live, source }` and `e2e/global.setup.ts` requires `source: "env"` — an anonymous
  `live: false` from a *targetable* flag stopped being evidence about the signed-in user the
  specs sign in as, which had quietly broken what KI-25 bought. `.env.example` ships it; CI
  sets it in the workflow env.

## Blocking / broken right now

**Promoted out of the 2026-09-20 handoff on 2026-09-21.** These were live
inside a section that was 69% of this file, where nothing looks for a blocker.

* **Coordinates.** `KI-2026-09-20-d`. Every derivation above needs `lat`/`lng`
  and the seed has three. The gateway blocks the geocoder (403 to `CONNECT
  nominatim.openstreetmap.org:443`), so this cannot be closed from a cloud
  session. Two routes that do not need one: lift coordinates from the 19
  already-geocoded bundles under `content/` where the places overlap (Mexico
  City, Glen Coe, New York are plausible — CHECK, do not assume), or run the
  geocoder from a laptop per `docs/guidelines/content-bundles.md`.
* **The preview's database.** It has never had `content:import` run and is not
  reseeded by a deploy, so seed-side work stays invisible there until somebody
  with the credential reseeds it. Mitchell knows; it is his to do.

**1. The Map lens's tiles have still never been confirmed to paint — KI-49.**
From a cloud session the egress proxy blocks the tile host outright, so the
map's chrome can be walked and its tiles cannot. From a laptop the transport
verifies (M11's gate loaded the style, tilejson, sprites and glyphs from
`tiles.openfreemap.org` on the preview, and WebGL is real) and the **pixels
still do not**: the WebGL canvas captures blank in the screenshot pipeline, and
MapLibre fetches its data tiles from a worker the main thread cannot observe.
So neither environment has produced a picture of a rendered map. Nothing on the
roadmap is blocked by it; it bounds what a browser walk is allowed to claim,
from anywhere. A blank canvas is not a pass.

**Retired from this list at M11's gate, 2026-08-28** — all three were on it and
none of them is live any more:

- **Migrations 0006-0010 are dispatched to production.** The gate's blocker, and
  the preview walk signed in and wrote as two users against the migrated schema,
  which is exactly the `recordSignIn` upsert into `users` this entry warned
  would throw. The standing rule is unchanged: merging does not apply a
  migration — dispatch it (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`) and say so in the PR body.
- **`/s/featured`'s dead end is gone — KI-61.** PR #79 replaced it with `/demo`;
  see the `/demo` paragraph above. Walked on the preview: 14 days, 68 stops,
  read-only, 2 conflicts rather than the pre-KI-60 twelve.
- **The CSP's last unwalked environment, the Vercel preview, is walked —
  KI-66.** The entry's "never executed by a browser" half was already closed
  earlier the same day by a local production-build walk; the preview was the
  named remainder, and M11's gate covered it — as did a cloud session on
  2026-08-29, independently, finding the same violation. One preview-only
  behaviour is still worth knowing before it is mistaken for a defect: a
  Deployment Protection re-challenge of an in-flight XHR reaches the app as a
  bare "Failed to fetch". The other one M11's gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — was **not** "no app impact",
  and is fixed rather than documented; see the next section.

**A preview deployment is walkable from a cloud session, and the CSP defect that
found is fixed.** `pnpm --filter web walk:preview <url> [path ...]` —
`docs/guidelines/cloud-agent-sessions.md` carries the diagnosis, and that file's
old "the preview is NOT reachable from here" paragraph is gone; it was wrong and
it cost several runs. Three obstacles stacked: Deployment Protection, Chromium
not trusting the egress CA, and a TLS 1.3 ClientHello the `*.vercel.app` tunnel
cannot carry.

What the walk found is the point: **the CSP refused the Vercel Toolbar's loader
on every preview page**, which breaks the Flags Explorer — the documented way to
flip `ai-live` for one reviewer's session. M11's gate saw the same refusal and
filed it as harmless preview noise; it was not. The policy now admits the
Toolbar's origins on preview only, gated on `VERCEL_ENV`, with a test asserting
production's policy is untouched.

**One thing is still Mitchell's to do, and nothing unattended can test a preview
until it is done:** generate **Protection Bypass for Automation** (Vercel → the
project → Settings → Deployment Protection) and copy the value into a
`VERCEL_AUTOMATION_BYPASS_SECRET` repo secret.

**The `_vercel_share` fallback was tested on 2026-08-30 and is not a substitute
— tried while looking for M18b's gate evidence.** A freshly minted link gets
*past* Deployment Protection and is then stopped by `429 Vercel Security
Checkpoint` at the redeem step, twice, five minutes apart, before any app
response. That is Vercel's anti-bot interstitial challenging the client —
headless Chromium on a datacenter IP — not rate limiting and not the protection
layer. It suits a person in a browser; it does not reliably suit the automated
walk. The bypass secret is honoured before the checkpoint renders, which is why
it is the only dependable route. `docs/guidelines/cloud-agent-sessions.md`
carries the detail. Treat the secret like `FLAGS_SECRET`:
it unlocks every protected deployment this project has.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**M13 is the current milestone** (M26's gate closed 2026-09-21, 22 of 22). Read
`docs/milestones/M13-collaboration.md` before planning anything. M21's and
M22's gates closed 2026-09-19 on Mitchell's attestation — nothing of either is
owed.

**The prerequisite that used to stand here is DONE — 2026-09-21.** The
activity-field descriptor refactor, `KI-20260905-o`, ran as its own piece of
work at Mitchell's request rather than inside M13. Three milestones each add a
field to an activity (M13 link 5's `who`, M24's `mode`/`endLocation`, M19 link
1's cost kind), and ~21 non-test files hand-enumerated those fields with
nothing going red when one was missed. Now `ActivitySnapshot` declares the set
once, `ActivityState` is inferred from it, and `FIELD_EQUAL` in `equality.ts`
turns a ninth field into a compile error at every site — proven by adding one
and reading the errors. The entry is in `resolved/`; M13's gate box is ticked.

**Read this before writing link 5.** The read model `ActivityView` is
**deliberately not derived** from the snapshot. Deriving it carried write-path
length bounds onto a model that parses `trip_details.doc` straight off jsonb,
where a violating stored value would 500 the board rather than fail a write —
the #71 shape one field later. A key-parity assertion in `contracts/detail.ts`
keeps the compile-forcing instead, and it is weaker in exactly one way: it
forces the KEY to exist, not that its type matches. So adding `who` will break
the build until you add it to `ActivityView` too, and nothing will check that
you gave it the right type there.

**A second thing landed with it, and it is a behaviour change worth knowing
about**: a stop whose `kind` is `transit` is no longer a member of an
`impossible-geography` pair. Mitchell's case was a Lisbon→Porto train flagged
against its own destination at ~273 km. This is KI-60's explicitly rejected
weaker variant, added *alongside* the rule that replaced it rather than instead
of it; KI-60's entry now records that. The cost: a mistyped coordinate on a
transit stop is no longer caught by any rule.

**M22's last gate box closed 2026-09-19 on Mitchell's attestation**, but the
problem that blocked an agent from walking it is still open, and the next
tier-gated box on a preview will meet it: an account that can hold `api.tokens`
**on a preview**, which `KI-20260916-d` says is blocked by **`ADMIN_USER_IDS`** — injected at build, and
supplied by `playwright.config.ts` only to the local e2e server, so
`POST /api/admin/grants` answers 404 on a preview.

**That variable is bound to preview and production, and was created 2026-09-14
— two days BEFORE the walk that got the 404.** So the entry's fix sketch ("set
it in Preview and redeploy") describes a state that already held, and the cause
is more likely its **value**: `ADMIN_USER_IDS` takes `users.id` verbatim and
fails closed, and a dev-login operator's id is `dev-<username>`, not a Google
one. **Hypothesis, not finding** — the value is encrypted and was not read.
**The next step is a read**: check whether Preview's value contains the `dev-`
id `e2e/adminBootstrap.ts` grants through.

**Do not repeat the mistake this paragraph used to make.** Until 2026-09-19 this
line, `TODO.md` and two other places all said the blocker was
`API_TOKEN_PEPPER`. It is not, and never was: that variable is set on **all
three** Vercel targets, and `KI-20260916-d` does not mention it. The wrong name
survived in three status files because each copy read as confirmation of the
others, while the KI — the one document with the fact in it — went unread. When
these files and a known-issue entry disagree, **the entry is the one that was
written by somebody looking at the failure.**

*(This section has gone stale three times — it named M17 on the day M17's gate
closed, M9 on the day M20 was already built and merged, and M21 as unbuilt for
four days after all four of its phases merged. Read it with suspicion and check
it against `docs/milestones/README.md`'s Current milestone line, which is the
single source of truth.)*

**Two things are waiting rather than blocked, and both are Mitchell's.** Whether to flip
`ai-live` now that its precondition is met (above, with what it would expose), and whether
the three open questions M9 Phase 0 raised get answered before M21 prices anything — the
second of them, *which quota window a sold ceiling binds*, is the one M21 pays for if it is
left: it is implemented per-day and stated in no contract.

**M9's three real pieces of work are BUILT, and what is left of it is its gate.** Grounding,
conversation durability and the eval/replay harness all landed 2026-09-16 and relanded as
#188 — the section above carries it. What the gate still wants is what a build cannot
supply: a live model call, the Rochester re-run resting on one, and the browser walks. *(An
earlier version of this paragraph said "M9 stays paused behind M21" and listed all three as
unchanged. It had been wrong for two days.)*

**Phase 0 raised three questions that are Mitchell's, not a build's.** None blocks anything
current, and the second is the one that costs if it is left: whether the usage row carries a
`planVersionRef`; **which quota window a *sold* ceiling binds** (implemented per-day, stated
nowhere — M21 pays for this if it is not settled); whether the tier map is a Vercel Flag or an
env var.

## Landed in the last week

Compressed on 2026-08-28 and again on 2026-09-11. Each line names the durable
record; the long-form narrative is in `docs/retros/2026-08-28-status-archive.md`
and `docs/retros/2026-09-11-status-archive.md`.

- **The assistant became a kernel, 2026-09-11.** M9 Phase 0, `bbc5bdb` (#162) and
  `845fc48` (#163). ADR-043 and `docs/milestones/M9-ai-planning-partner.md`'s
  Phase 0 section carry it; KI-2026-09-05-t and KI-22 are resolved.
- **M17's gate closed 2026-09-11**, nine days after the code shipped — the retro
  on *that* gap is in `docs/milestones/M17-account-customization.md`, and it is
  the more useful half of the entry.

- **A binding operating contract for dispatched subagents, 2026-08-28.**
  `.claude/protocol/` — lifecycle, three exit states, a two-strike handback
  rule, a run-scoped board and a mechanically checked report shape, enforced by
  four fail-open hooks. `ADAPTER.md` and `adapter.json` hold every
  travel-collab-specific fact and a test enforces that the other three files
  name nothing about this repo. Start a run with `/dispatch`. Design:
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`. Known defects
  consciously left: KI-62, KI-63.
- **A travel day is no longer a false conflict, 2026-08-28 — KI-60.** The Japan
  demo went from 12 conflicts to 2 with no fixture change: `detectConflicts`
  compared every same-day located pair against a flat 150km and never read
  `kind`, so all ten `impossible-geography` warnings sat on the two days the
  trip relocates, each with the day's own shinkansen scheduled *between* the two
  stops. The rule now excuses a distance a transit stop crosses **in time**, on
  time order rather than stored order, and never excuses an untimed stop. Full
  reasoning, including the weaker rule that was rejected with evidence:
  `docs/known-issues/` KI-60.
- **One canonical Japan fixture, 2026-08-28 — ADR-030 (PR #74).**
  `@tc/fixtures` owns the 14-day/68-stop trip; the seed script, the preview
  branch's demo reset and `@tc/factories` all call the same commands, and
  `src/lib/japanTripImporter.ts` is deleted. The two copies that existed were
  identical by luck, and where they differed was live on preview: the reset
  produced a trip with **zero tags** the day before M18's tag chips shipped, and
  coordinates were 72/72 local against 51/72 preview with six wrong venues.
  `pnpm seed:verify` is the thing that keeps it true. Procedure for new
  features: `docs/guidelines/fixtures-and-seed-data.md`. Filed rather than
  fixed: KI-57, KI-58, KI-59.
- **M18's contract PR, 2026-08-27 (PR #63).** See "Where the work is right now".
  The trap worth remembering: `equality.ts`, `diff.ts`, `hydrate.ts` and
  `detail.ts` each hand-enumerate activity fields, so adding a contract field
  without touching all four compiles cleanly and is wrong at runtime — and
  because `decide.ts` gates `UpdateActivity` on `okUnlessNoOp`, a kind-only
  update was rejected as a no-op until equality learned the field. The shared
  property generator needed both fields too, or the diff property test would
  have kept passing while never generating either. The project review found the
  same class again in `Location.city`/`countryCode` (KI-54, since resolved), and
  §6.1's descriptor refactor is the standing fix.
- **M10's Wave-2 gate closed 2026-08-27, and M15's closed 2026-08-26 (PR #56).**
  Evidence, retros and the rules promoted out of the deleted phase plans:
  `docs/milestones/M10-visual-craft.md`, `docs/milestones/M15-front-door.md`.
- **Two full reviews, 2026-08-28.** `docs/reviews/2026-08-28-project-review.md`
  (seven dimensions, six parallel agents) and
  `docs/reviews/2026-08-28-m11-pr71-review.md`. Both are being worked through on
  the current branch; read the remediation plan for what is in scope and what
  was deferred with a reason.

## Where the history went

| What | Where it is now |
|---|---|
| Everything this file said before 2026-08-28, verbatim and in order | `docs/retros/2026-08-28-status-archive.md` |
| This file's lines 243-1188 as of `845fc48` — the phone assistant (2026-09-05), M14's builder half, the 2026-08-30 three-PR stack | `docs/retros/2026-09-11-status-archive.md` |
| M9 Phase 0 — what each phase landed, the squash-merge hazard, the open questions | `docs/milestones/M9-ai-planning-partner.md`, ADR-043, and the design spec |
| M10 Wave 2, per phase — what each shipped, what it deliberately did not, the landing gaps that cost time | that archive, plus `docs/milestones/M10-visual-craft.md`'s scope, exit gate and Wave-2 retro |
| M15's gate and its two resolved open questions | `docs/milestones/M15-front-door.md` |
| Every roadmap reorder and its reasoning | `docs/milestones/README.md`'s reorder notes, and ADR-018 / ADR-021 / ADR-022 |
| The 2026-08-23 design sync, its routing, and the 2026-08-26 UI audit | `docs/design-feedback/` |
| The feature-flag / AI-kill-switch insert (PR #24) | ADR-019 and `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` |
| The test-suite overhaul, Phases 0-4 | `docs/plans/2026-08-23-test-suite-overhaul.md`, `docs/testing-baseline.md`, `docs/testing-inventory.md` |
| Which known issues are open, and which were closed when | `docs/known-issues/` — authoritative, and the only place that list should be kept |
| The 2026-09-20 shared-day-map handoff (43,702 B) | `docs/retros/2026-09-21-status-archive.md` |
