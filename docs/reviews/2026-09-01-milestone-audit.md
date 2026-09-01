# Milestone audit — 2026-09-01

Requested by Mitchell: review the milestones for invalid and inefficient
entries. Specifically — are the remaining milestones still real milestones now
that work has landed inside them; which tasks and gate boxes are already
satisfied by shipped code; are the known issues still open and assigned to the
right gate; and is the current order still the right one.

**Method.** Every claim below was checked against `main` at `dd61c44`, not
against the milestone prose. Where a milestone file and the tree disagree, the
tree wins and the finding says so. Nothing here changes a gate definition —
those are Mitchell's, and the ones that need a decision are collected at the
end.

---

## 1. The headline: M9 is no longer the milestone its file describes

**Mitchell's hypothesis was right, and it is bigger than "some sidebar work
landed".** PR #88 (`5a362d3`) shipped **four of M9's seven scope items outright**
and half of two more. What is left is one substantial link and one piece of test
infrastructure.

| M9 scope item | State in `main` | Evidence |
|---|---|---|
| Grounding (`SearchPlaces` → `placeRef`) | **Not built** | no `SearchPlaces` tool; `READ_TOOL_NAMES` is `read_trip`, `read_day`, `find_free_time` |
| Honest unknowns (no fabricated cost) | **Shipped** | `withoutFabricatedCost`, `writeTools.ts:173` |
| Thread contract | **Partial** — in-flight only | `messages: AskUiMessage[]` on the request; **no conversation table** in `schema.ts` |
| Streaming | **Shipped** | M16, `/ask` streams |
| Propose → review → approve | **Shipped** | `ProposalCard.tsx`, `POST /ask/apply`, whose route file is headed `// Approval route (M9)` |
| Refinement ("no, make it Tuesday") | **Shipped** within a session | multi-turn thread, `MAX_ASK_MESSAGES` |
| Observability | **Partial** — analytics yes, replay no | `askAnalytics.ts` records `steps`, `usageByStep`, `uncalledTools`, `droppedCalls`; **no eval/replay harness exists** |

**And three of its six substantive gate boxes are already satisfied by shipped
code.**

- **Box 3, "rejecting a proposal leaves the trip untouched" — met by
  construction.** Rejecting is the apply route not being called. The route file
  says so and there is no reject path to get wrong.
- **Box 5, "no activity carries a fabricated cost" — met, and enforced on both
  paths.** `withoutFabricatedCost` runs in `buildProposal` *and* again in
  `parseApprovedCommands` (`writeTools.ts:412`), so a client cannot post a
  `cost: 0` back on approval. This is stronger than the box asks for.
- **Box 2, "built conversationally over several turns, refined, committed only
  on approval as one atomic batch" — mechanism shipped**, unproven by a walk.
  Every part exists; nobody has driven it end to end and recorded it.

**Genuinely remaining:** box 1 (a real non-mocked model call with its `meta`
pasted in), box 4 (the Rochester prompt re-run with real coordinates — needs
grounding), box 6 (recorded transcripts replay in CI — KI-11, inherited from
M16's gate).

**So M9 is not "AI as a planning partner" any more.** The planning partner is
built. What is left is: **the assistant cites the places it plans, its
conversation survives a reload, and its behaviour is provable in CI.** That is
a focused milestone, not the architecture-replacing one ADR-022 deferred.

### The consequence nobody has written down

`ai-live` **defaults to false** (`modelSelection.ts:19-30`) and Vercel holds
**one** real-model `ask` record across seven days. So the largest already-built
feature in the product is dark — and the reason it cannot responsibly be turned
on is precisely M9's unbuilt link: KI-81, *"an approved AI plan carries the
model's own place names, ungrounded — a model guess laundered into a stored
fact."*

The assistant is not waiting on polish. It is waiting on grounding, and
grounding is behind M12, M13 and M14.

---

## 2. Status flags that drifted, and the mechanism that let them

### 2a. `docs/STATUS.md` is two gates stale

It still says M11a and M11b are *"built and in review as a three-PR stack …
None of their gates has closed; nothing below is ticked anywhere yet."* Both
gates closed on 2026-08-31. Its "Next action" section still names M11a as the
current work.

**This is the file `CLAUDE.md` tells every session to read first.**

### 2b. The cause: the gate-close checklist does not include STATUS.md

`docs/milestones/README.md`'s checklist has four steps — TODO tick, exit-gate
boxes, retro, Current milestone. `AGENTS.md`'s drift-signal list names the same
three flags. **STATUS.md is in neither**, so nothing makes it anyone's job at a
gate close. Confirmed mechanically: neither gate-close commit touched it.

```
dd61c44  TODO.md, M11b-playbooks-public-library.md, README.md
14a44d6  TODO.md, M11a-invite-gate.md
```

STATUS.md's own header claims it is *"updated at every milestone boundary"* —
a promise no checklist keeps.

### 2c. M19 exists in one file out of three

Minted and placed 2026-08-31. It is in `docs/milestones/README.md`'s table and
in the Current-milestone order, and it has its own file. It appears in
**neither `TODO.md` nor `STATUS.md`**.

`TODO.md`'s stated rule is *"find the first unchecked item — that is the current
work."* A milestone absent from that file cannot be found by it. This is
verbatim the failure `TODO.md` already documents against M17: *"absent from this
file entirely until 2026-08-28, which in a file whose rule is 'first unchecked
item = current work' meant an approved milestone nobody could see."*

**The same defect, recorded in prose, then repeated three days later.**

---

## 3. Known issues — assignment and orphans

**All open entries were checked; none is stale-open.** The two I spot-checked
hardest are still genuinely open: KI-34 (`TripSummary` really has no
`startDate` — `trip.ts:283`) and KI-81 (no `SearchPlaces` tool exists). Nothing
in `open/` has been quietly fixed.

The problem is assignment, not staleness.

### 3a. Nine AI known issues have no milestone home

M9 is the AI milestone and its file cites exactly three: KI-11, KI-15, KI-81.
These carry no milestone reference at all:

| KI | Severity | What it is |
|---|---|---|
| **KI-12** | correctness | *"The AI cannot name a trip or set its dates, so 'plan me a trip' can't produce a complete one"* |
| KI-10 | correctness | batches don't recover a reference to an activity created later in the same batch |
| KI-93 | correctness | the AI handler's geocoding spends the LocationIQ key without consulting the quota |
| KI-94 | correctness | the step quota's admission charge lets concurrent requests overshoot the ceiling |
| KI-97 | correctness | tracking-only duplicate of KI-94 |
| KI-9 | cleanup | model outputs validated ad hoc, not at one typed boundary |
| KI-22 | cleanup | the AI response envelope is not in `packages/contracts` |
| KI-24 | cleanup | `AI_LIVE` on Vercel is warned-about, not prevented |
| KI-80 | cleanup | two phrasings of the same command list |

**KI-12 is the sharpest one.** It is a correctness entry describing the headline
AI flow failing to finish its job, and it is not named by the milestone that
owns the AI. KI-93 and KI-94 are both spend-ceiling holes on a live vendor key.

### 3b. `map-legend-modes` is tagged M9 and is not M9's

`preview-registry.ts:57` blocks it on *"transport mode per leg — no field models
it today."* M9's scope has no transport-mode link, no contract change and no
migration. This is the same species as the `cost-estimate-state` /
`budget-breakdown` mis-tag that M11b's sweep caught and that minted M19 —
a shell tagged to a milestone that will not wire it.

The registry's own rule, three lines above it: *"a shell's milestone tag is a
claim that that milestone will wire it up."*

### 3c. `timeline-ghost`'s stated blocker has shipped

Tagged M9, `wiredUpBy: "M9 propose→review→approve"`. Propose→review→approve
shipped in PR #88 — in the rail, not the timeline. The shell is still genuinely
unbuilt, but the reason recorded against it is no longer true; the remaining
work is rendering a proposal inline in the timeline.

### 3d. Two shells belong to no milestone

`wizard-destination-chips` and `wizard-longer-chip` carry `milestone:
"unplaced"`. That was the honest call at the time and the comment argues it
well. It is still two designed surfaces nothing will ever build, and no
milestone-level record says so.

---

## 4. Order

### 4a. The reason M9 was moved last has expired

ADR-022 (2026-08-25) moved M9 behind M14 on two stated grounds:

> the data layer beneath a planning partner is not strong enough yet … UI polish
> and sharing come first

Both have since been met. Polish: M10's Wave-2 gate, 2026-08-27. Sharing: M11,
M11a, M11b, all closed. The data layer: M18 gave a stop `kind` and `tags`, M16
gave the agent read tools and analytics. **Neither condition ADR-022 named is
still true**, and M9's own file already records that M16 changed its starting
point.

Nothing has re-examined the placement since the conditions lapsed.

### 4b. Three of the next four milestones have no file and no exit gate

`docs/milestones/` has files for M17, M19 and M9. **M12, M13 and M14 are table
rows only** — no scope document, no exit checklist. `README.md`'s own rule:
*"Each milestone gets its own file here with an exit checklist before work on it
begins."*

So the order after M17 runs `M12 → M13 → M14`, and none of the three can be
opened without a scoping pass first — the same condition that held M11b unplaced
for two days. M9, by contrast, has a written scope and a written gate today.

### 4c. Recommended order

```
current:      M17 → M12 → M13 → M14 → M9 → M19
recommended:  M17 → M9 → M12 → M13 → M14 → M19
```

**Move M9 to immediately after M17.** Four reasons:

1. **It turns the lights on.** Grounding is the one thing standing between a
   built assistant and `ai-live` being flippable. Every milestone ahead of M9
   extends how long the biggest shipped feature stays dark.
2. **It is now cheap.** Four of seven scope items and three of six gate boxes
   are already done. It is a smaller milestone than M12 or M13, and it is the
   only one of the four that is scoped today.
3. **It closes live correctness debt.** KI-81, KI-15, KI-93, KI-94 are all
   correctness entries against code that is already in production.
4. **M12 is better for the wait.** M12 is reviews and ratings over days that
   M11b publishes. It gets more useful the longer the library has been live,
   not less.

M19 stays last: its link 3 (who an activity is for) overlaps M13's
`add-stop-who`, and running after M13 is what stops both from adding the field.
That reasoning is sound and unaffected.

**If Mitchell wants the assistant on sooner**, the stronger variant is
`M9 → M17 → …` — M17 is preferences (name, home airport, km/miles) and nothing
is blocked on it, by its own file's admission.

---

## 5. Titles and descriptions that no longer describe the work

| Where | Problem |
|---|---|
| **M9 title** — "AI as a planning partner" | The planning partner is built. Remaining work is grounding, durability and proof. |
| **M17 title** — "Account customization (and a real user record)" | The real user record shipped in M11 link 1 (ADR-025). The parenthetical names a delivered thing. |
| **M17 "Why this exists"** | Still asserts *"`schema.ts` is four tables — `events`, `trip_summaries`, `trip_details`, `pages`. There is no user row."* The schema has **twelve** tables and `users` is one of them. The re-scope section corrects this; the body still states the false version. |
| **M12 title** — "Community" | Narrowed 2026-08-30 to reviews, ratings and moderation. The gallery and discovery are M11b's and shipped. The title still promises the whole thing. |
| **M13 description** | Reads correctly but does not say it holds `add-stop-who` and `rack-provenance`, which M19 depends on it landing. |
| **`timeline-ghost` `wiredUpBy`** | Names a blocker that shipped. See 3c. |

---

## 6. Decisions for Mitchell

Findings above are recorded. These need a call, and a gate definition changes
only by explicit decision:

1. **Re-scope and retitle M9** to grounding + conversation durability + the eval
   harness, and **annotate boxes 3 and 5 as already met** rather than leaving
   them to be re-proven at the gate. Ticking them is a gate close and is not
   done here.
2. **Move M9 to after M17** (§4c), or before it.
3. **Assign the nine orphan AI known issues** (§3a). KI-12, KI-93 and KI-94 are
   the ones that most look like M9 gate boxes.
4. **Retag `map-legend-modes`** off M9 — to `unplaced`, or to a milestone that
   will actually wire it (§3b).
5. **Add STATUS.md to the gate-close checklist** as a fifth step, or delete its
   claim to be updated at every milestone boundary. One of the two must give.
6. **Give KI-34 a home.** It is a correctness entry, deferred by M10, now living
   only in `TODO.md`'s Candidate ideas with no milestone.
