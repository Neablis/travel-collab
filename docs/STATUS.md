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

**M20 — AN ACCOUNT KNOWS WHAT IT MAY DO — IS THE CURRENT MILESTONE, OPENED 2026-09-13.**
Mitchell's reorder the same day, asked for directly: **the commercial pair M20 → M21 runs
ahead of M9's remaining work.** Order:
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 → M21 → M12 → M13 → M14 → M19`.

**ALL SIX PHASES ARE BUILT, MERGED AND DEPLOYED TO PRODUCTION.** `#174` (`2b5f759`)
squash-merged the six-phase branch on 2026-09-14 and `#175` (`492c685`) landed the
read-through cache on top; production serves `492c685`. `claude/milestone-m20-build-h2mw7b`
is spent history — the same squash-merge trap M9 Phase 0's retro records, so do not continue
it. The six phases, one per phase of `docs/plans/2026-09-13-M20-M21-commercial.md`:

1. the entitlement vocabulary in `packages/contracts` and the three launch plans as a
   committed file, with the no-spread/no-extend/no-display-order test written here
2. migration **0019** (`entitlement_grants`, `users.plan_id`/`plan_version`/`is_admin`),
   the founder backfill, the signup trial, and `entitlementsFor(userId)`
3. **403 → 402** with the tier named, and per-tier ceilings (`plus` 50·400,
   `premium` 200·1600) from the pinned version
4. the collaboration gate, capped on read in `effectiveMembers`
5. migration **0020** (`ai_usage`) and the dated model-rate file
6. the operator console, the referral loop, and the fourth-plan proof (`studio`)

**The plan said one branch and one PR per phase; the build session's branch requirement said
one branch.** The branch requirement won, so #174 is six phases in one squash — each of its
25 commits is reviewable as one, and its body describes link 1 only.

**What is proven, re-run on `492c685` on 2026-09-14** (the tree in production, not the build
branch): typecheck 0, lint 0 with every wall green, **2,686 web unit tests** plus 1,114 across
the packages and 182 script tests, **580 integration tests** (48 files), and
**`pnpm --filter web test:e2e:ci-like` — 125 passed, 0 failed, 0 flaky**, which is the only
e2e verdict that counts (`test:e2e` serves `pnpm dev` and produces timeouts CI does not have —
CLAUDE.md rule 1). `e2e/m20-entitlements.spec.ts` walks eleven of them, including the
milestone's most important negative (a free account plans a whole trip with no gate anywhere),
a grant biting on the next request with no re-authentication, and the three surfaces added to
the gate on 2026-09-14 — the plan section and its meters, minting a referral code, and the
shelled plan chooser.

**The full run earned its cost once**: an earlier pass failed three `m11-invites` tests on an
*Invite role* select that link 6 correctly no longer renders for a `free` owner. The gate
working, not a flake — and something no narrower lane would have found.

**BOTH MIGRATIONS ARE DISPATCHED AND APPLIED TO PRODUCTION — 2026-09-14, `migrate-production`
run 20 from `main` at `492c685`, success.** Checked against the database rather than the run
log: `drizzle.__drizzle_migrations` carries 21 entries, `users` carries
`plan_id`/`plan_version`/`is_admin`, `entitlement_grants` and `ai_usage` exist, and **the
founder backfill minted a permanent `premium@v1` grant for each of the two accounts that
predate it** — which is the gate's "loses no capability" box, true in production rather than
in a fixture. The preview branch was already at 21; it migrates itself at build
(`scripts/vercel-build-migrate.mjs`), production never does.

**The exit gate is not ticked, and exactly one thing blocks the demo: production has no
operator.** A gate closes on a deployed demo, through `docs/milestones/README.md`'s
gate-close checklist, in one commit. Everything else is deployed and migrated; `/admin` is
reachable by nobody, so the console half of the demo cannot be walked by anyone yet — see the
bootstrap paragraph below for the one value that fixes it.

**One thing the milestone did not name and the build needed: an operator bootstrap.**
`/admin` is gated on `users.is_admin` and nothing in the product sets that column, so the
first operator could only be made with a psql session. Two ways in now, and neither is a
database write: `ADMIN_USER_IDS` (`.env.example`, `lib/adminBootstrap.ts`), read at sign-in,
and the **`admin-console` feature flag** (2026-09-14, Mitchell's ask), targeted per account
from the Vercel dashboard with **no deploy and no sign-out**. Both only ever promote;
revoking is clearing the column. The flag fails closed, so the env var is the break-glass
path that survives the Flags service being unreachable — and the only path locally and in
CI, where no adapter is configured. **Neither is set in production yet, and that is now the
single blocker on M20's gate demo.**

**What setting it takes, so the next session does not re-derive it.** `ADMIN_USER_IDS` is a
comma-separated list of `users.id` **exactly as stored** — a Google account is
`google-<sub>`, never an email, so the value is
`select id from users where email = '<the operator>'` against the production branch (Neon
project `sweet-firefly-79114130`, branch `production`). It is set in the Vercel dashboard
(Project → Settings → Environment Variables), needs the Production scope for the production
demo and Preview as well if the console is to be walked on a preview, and **takes effect on
that account's next sign-in** — it promotes `users.is_admin`, it does not replace the read.
No code change and no session in this repo can set it: the Vercel MCP surface here has no
environment-variable write, so this one step is Mitchell's. Preview has no operator either —
`dev-admin` exists on the preview database with `is_admin = false`, which is what an unset
variable looks like from the inside.

**The one thing to know before touching this milestone:** *a plan is a set, not a rank.* Code
asks `can(ent, "ai.ask")` and nothing compares plans. `accessPolicy.ts:11`'s `RANK` is the
right shape for roles inside a trip and the wrong shape here; copying it is the obvious move
and it is a one-way door. The buyer's ladder is presentation only.

**M9 is paused, not cancelled**, and keeps its place immediately after M21. Its Phase 0 is
below, unchanged, because it is what M9's three real pieces of work are still built on.

**M9 PHASE 0 — THE ASSISTANT KERNEL — IS COMPLETE, 2026-09-11.** Two PRs, both merged:
P0-P5 as `bbc5bdb` (#162) and P6 as `845fc48` (#163). It closed **KI-2026-09-05-t** and
**KI-22**, and ticked **no gate box**, by design — it is what M9's three real pieces of work
are built on.

**The narrative is not here.** What landed phase by phase, what it cost, the squash-merge
hazard that cost the most, and the three open questions it raised for Mitchell are in
`docs/milestones/M9-ai-planning-partner.md` under "Phase 0". Decision and the five rules:
**ADR-043**. Design, corrections and measurements:
`docs/specs/2026-09-10-assistant-kernel-design.md`.

**The one-line version, because it is the thing to know before touching the assistant:**
`handleAskRequest()` went **455 -> 105 non-comment lines** while the comment record grew
**634 -> 996**; a tool is now a module with a required output schema and declared
dependencies, a scope is a grant of (domain, effect) pairs and the tool set is a *filter*,
admission is a nine-stage array whose order a test asserts, tool-returned user content is
fenced in `⟦…⟧` inside the system instruction, and a turn returns a `TurnLedger` shaped as
M20 link 9's `ai_usage` row — with **model identity and cost as variable inputs**.

**Four known issues were filed by doing the work** and are open: `KI-2026-09-11-a` (a
`userId` in Sentry breadcrumbs), `-b` (`simulatedModel`'s unchecked cast), `-c` (two
`modelSelection` tests read `serverConfig` at module load), `-d` (`TurnMeter.toolCalls()`
hands back its live array).

**Two fixture trips are still on the preview database** from #162's browser walk: `Kyoto
pass 162` and `Blank slate 162`.

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
  spend control at all. After the flip, keep Production's rule list empty: a widening rule
  would make *the rule* load-bearing, and disabling in a hurry must stay one action. It lives
  in the Vercel dashboard and no test can assert any of it.
- **e2e refuses to start unless `AI_LIVE=false`.** `/api/health/ai-mode` reports
  `{ live, source }` and `e2e/global.setup.ts` requires `source: "env"` — an anonymous
  `live: false` from a *targetable* flag stopped being evidence about the signed-in user the
  specs sign in as, which had quietly broken what KI-25 bought. `.env.example` ships it; CI
  sets it in the workflow env.

## Blocking / broken right now

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

**The current work is M20's gate close** — the code is merged, deployed and migrated, and
what is left is the demo and the one commit that flips every flag
(`docs/milestones/README.md`'s gate-close checklist). *(This section named M9 as the current
work until 2026-09-14, on the day M20 was already built and merged — the second time this
file's most-read section went stale while its length stayed respectable. The section above is
the live one; this one exists to say what happens next, not where the work is.)*

**In order:** set `ADMIN_USER_IDS` in Vercel (above — Mitchell's, nothing here can do it),
sign in once so the bit is written, then walk the deployed demo: the console's four answers,
a grant from an account's row, and the account sheet's plan, meters and referral code. Then
tick 32 boxes, `TODO.md`, the milestone table's **Current milestone**, and this file, in one
commit. Then M21 — and note the two M20 surfaces M21 finishes: the four-number revenue strip
and the per-tier panel's MRR and median-margin columns, which M20 deliberately ships without.

**M9 stays paused behind M21**, and its three real pieces of work are unchanged, per the
2026-09-01 audit (`docs/reviews/2026-09-01-milestone-audit.md`):

- **Grounding** — a `SearchPlaces` read tool, with `AddActivity`/`UpdateActivity` citing a
  `placeRef: N` against that turn's search cache instead of a free-text `location`. This is
  what makes the model *structurally incapable* of naming a place it did not search for, and
  it is the reason `ai-live` is still dark. Closes KI-81/KI-15.
- **Conversation durability** — no conversation table exists, so a reload loses the thread.
- **An eval/replay harness** — KI-11, inherited from M16's gate.

**Phase 0 raised three questions that are Mitchell's, not a build's.** None blocks starting
the above, and the second is the one that costs if it is left: whether the usage row carries a
`planVersionRef`; **which quota window a *sold* ceiling binds** (implemented per-day, stated
nowhere — M20 pays for this if it is not settled); whether the tier map is a Vercel Flag or an
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
