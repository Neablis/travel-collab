# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

**This file is live instruction only, and it is kept short on purpose.** At
gate close a phase's narrative moves to its milestone file or a retro in the
same commit, and this file keeps the pointer. Closed sections go verbatim to a
`docs/retros/<date>-status-archive.md`; *Where the history went* at the end
lists every one. **A stale section is the defect to watch for, more than
length**: this file has named a closed milestone as current four times.
`pnpm state`'s DRIFT line checks it against the Current milestone line.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**M19 — A COST KNOWS WHO AND WHAT IT IS FOR — IS THE CURRENT MILESTONE AS OF
2026-10-01**, by **M14's gate closing at 22 of 22**. Order:
`M17 ✓ → M9 [built 2026-09-16, paused — gate needs a live model call] → M20 ✓ → M21 ✓ → M22 ✓ → M25 ✓ → M23 ✓ → M26 ✓ → M13 ✓ → M27 ✓ → M12 ✓ → M24 ✓ → M28 ✓ → M14 ✓ → M19`.
M19 is **placed but not scoped**. Its exit gate is unwritten, and link 1 (a cost's kind)
has already shipped outside it (2026-09-26). The first piece of work is writing the gate
for links 2-5. `KI-20260905-o` (activity fields enumerated by hand) is still open, and
link 2 adds an activity field.

**Two more milestones are built beside the current one, not current, and not in `TODO.md`'s
order** (placing them is Mitchell's call). **M29 — The time river**: all four
parts merged by 2026-09-26 (#242, #244, #245, #243). Its gate is 17 of 20 (five boxes came with #251's phone part) after
the 2026-09-27 reconciliation and the `m29-kind-control.spec.ts` walks. What is
left is part 4's Overview read and the gate-close items. **M30 — Notebooks with one job each**: merged as #247, then #248-#253. Its
gate is 7 of 9; the preview walk was done 2026-09-27 on #256's preview. Mitchell reading the
Overview, and the retro, are what is left. Part 4 of M29 was superseded by M30's
itinerary Overview, so its read and M30's are the same read.

**M28 — Three kinds — closed 2026-09-26** (#238, #239): a stop's kind is
`planned`, `pending` or `transit`, and the retired `idea`/`hold`/`booked` are
read back as their replacement (ADR-054). Its retro is at the end of
`docs/milestones/M28-three-kinds.md`. Open, not gating: the Pending badge's
amber matches the Meal tag's, which Mitchell's queued design handoff decides.
M24 shipped as #229, #230, #232 and #233. Its retro is at the end of
`docs/milestones/M24-travel-legs.md`, and what it left open is
`KI-2026-09-25-q` (surfaces that read a stop's city directly, first a shared
helper and then a start-vs-end decision per surface).

## CLOSED 2026-10-01 — M14 Rich layer, pulled ahead of M24; gate 22 of 22

Mitchell's call, 2026-09-24: build all of M14 ahead of M24. It shipped as four
stacked PRs: #222 → #223 → #226 → #221. **The gate closed 2026-10-01.** On
2026-09-27 Mitchell settled the insert Sheet box (a fixed sample preview, as
ADR-037 says) and accepted the six widgets on their e2e and ADR-052 as built. On
2026-10-01 he attested the real-service weather walk. The retro is at the end of
`docs/milestones/M14-rich-layer.md`. `docs/retros/2026-09-24-m14-stacked-prs-retro.md`
is the *process* retro. The route map block is unblocked by M24 but unbuilt and
unowned.
**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**Write M19's exit gate.** M19 is current and placed but not scoped. Link 1 shipped on
2026-09-26, so the gate covers links 2-5: settled vs estimate, who an activity is for,
splits, and the shared-day presentation. M29 and M30 are built beside it. They wait on
Mitchell's Overview read, M29's whole-suite box, and a place in the order.

**Carried out of M24, not gating:** `KI-2026-09-25-q`. About a dozen
surfaces read `activity.location.city` directly, including the M14 ones this
section used to list (`placeOfDay`, weather, `select.ts`). Each still reads a
travel leg's origin by default. The KI's first step adds one activity-level
helper with no behaviour change. The PR that resolves it files the second step:
a start-vs-end decision per surface.

**Two operator items are open:** the production content re-import M12's gate
close owes (three corrected country codes), and, from M27,
`LOCATIONIQ_API_KEY` on Vercel (Production and Preview) — the Playbook pin
backfill does nothing without it.

**Waiting on Mitchell, not blocked.** Whether to flip `ai-live` now that its
precondition is met (*Live rules* above says what it would expose), and M9
Phase 0's three open questions (`docs/milestones/M9-ai-planning-partner.md`,
*open questions*). The second, *which quota window a sold ceiling binds*, is
the one that costs if left: it is implemented per-day and stated in no
contract.

**M9 is built; what is left is its gate**: a live model call, the Rochester
re-run resting on one, and the browser walks.

**`KI-20260916-d` is still open**: no account can hold `api.tokens` on a
preview, so the next tier-gated box walked on a preview will meet it. The entry
carries the next step.

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
| The closed M12, M13 and M26-link-4b `DONE` sections, moved 2026-09-25 | `docs/retros/2026-09-25-status-archive.md` |
| The M11-gate retired list, the pre-M14 *Next action* history, *Landed in the last week* (2026-08-28 to 2026-09-11), and this header's cut history, moved 2026-09-30 | `docs/retros/2026-09-30-status-archive.md` |
