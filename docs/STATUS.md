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

- **Migration `0018` (`saved_days.source_bundle`) is NOT applied to production.** It is
  what makes `--prune` answerable for content a bundle has stopped declaring, so the
  production content import is incomplete until it is dispatched. Merging does not apply a
  migration: `gh workflow run migrate-production.yml -f confirm=migrate`, from `main`.
  Runbook: `docs/guidelines/content-bundles.md`.
- **The `ai-live` flag's dashboard fallthrough must stay "Simulated".** Entity targeting
  (ADR-019's 2026-09-08 amendment) only ever *widens* who gets live AI, and a caller no rule
  matches — every signed-out visitor included, since `identify` publishes no `user` for them
  — falls through to the default. That default is the kill switch, it lives in the Vercel
  dashboard, and no test can assert it.
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

**The current work is M9 — the assistant cites what it plans**
(`docs/milestones/M9-ai-planning-partner.md`), now that Phase 0 is complete. M17's gate
closed 2026-09-11; the order `M17 ✓ → M9 → M20 → M21 → M12 → M13 → M14 → M19` is unchanged.

**The exit gate is 0 of 10 ticked.** Three of the original six were annotated as satisfied by
shipped code in the 2026-09-01 audit and deliberately **not** ticked — ticking is part of a
gate close, which that was not. So the gate is smaller than 0/10 makes it look, and the
milestone file says which.

Three real pieces of work remain, per the 2026-09-01 audit
(`docs/reviews/2026-09-01-milestone-audit.md`):

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
