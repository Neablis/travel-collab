# An architecture map that is generated, a drift check that fails CI, and a skill that reads them

**Status: DESIGN, FOR APPROVAL — 2026-09-18. Nothing is built, and nothing here
mints a milestone.** Four things are **decided** (the two-layer split, gate-close
authorship, derived known-issue binding, and the honest limit on what a diagram
does for DRY) because they were settled in the opening conversation and are
recorded below as settled. Everything else — the signal list, the failure
conditions, the verb, the risks — is a **proposal** with its evidence attached,
and three questions are **open** (granularity, one diagram or several, and where
the prose lives). See *Open questions* and *Not decided here*.

**Opened by:** Mitchell, 2026-09-18 — an AI skill that *"reviews the codebase and
maintains an up-to-date diagram of the code and its models; if the diagram
exists, it audits the models for drift and updates it."* The stated payoff, in
his words: reviewing a new feature means **reading the diagram rather than
re-reading the whole codebase**, keeping structure and style consistent and
maximising DRY.

That payoff is the thing to design against, and it is also the thing most easily
lost. A first-read document that drifts is not a cheaper way to orient; it is a
more expensive one, because it is read *instead of* the code and is wrong. This
repo has the measurement for both halves and they point in opposite directions:
orientation re-reading is genuinely expensive (`AGENTS.md:158-159` — **2,621
orientation re-reads across 220 sessions, ~1.9M tokens**), and a stale
first-read file is genuinely worse than none (`docs/STATUS.md:17-24` — a `## Next
action` section naming M17 as current *on the day M17's gate closed*). This
design exists to take the first and refuse the second.

## The requirement, decomposed

Mitchell asked for one artifact doing four jobs:

1. A **diagram** of the code and its models.
2. Kept **up to date** — it audits and updates rather than being rewritten.
3. Read **instead of** the codebase when reviewing a new feature.
4. Used to keep structure and style **consistent** and to **maximise DRY**.

(2) and (3) pull against each other in exactly one place, and it is the same
place `STATUS.md` broke. A document is worth reading instead of the code only if
it is *trusted*, and it is trusted only if something other than a person's
diligence keeps it true. (4) pulls a third way: DRY is not a property a picture
can hold. Each is answered separately below, and (4) is answered "no" in part.

## What exists today, measured

Established by survey of the current tree on 2026-09-18, not from memory.

### There is no map, and the pieces of one are already machine-readable

- **No `docs/architecture/MAP.md`, no diagram of any kind, and no index file** in
  `docs/architecture/` — 47 files, all of them `ADR-*.md` (`ls docs/architecture/`).
- **The module map is a markdown table in prose** at `AGENTS.md:67-76`: eight
  modules, four columns — Owns, Storage model, Explicitly does NOT know about.
  It is structural law and it is a table nothing parses.
- **The dependency rules are an ASCII block** at `AGENTS.md:111-120`, and the
  exempt shell that qualifies them is a prose paragraph at `AGENTS.md:122-137`.
- **`packages/` holds six workspace packages** — `contracts`, `domain`,
  `factories`, `fixtures`, `pages`, `predict` — plus `apps/web`, and every edge
  between them is a `workspace:*` entry in a `package.json`. Fully machine-readable
  today, with no new convention: `@tc/domain` depends on `@tc/contracts` and
  nothing else; `@tc/predict` on `@tc/domain`; `web` on five of the six.
- **`packages/contracts/src/` is 20 modules re-exported from one barrel**
  (`index.ts:1-20`), carrying **123 top-level exported Zod schemas**. These are
  the models, in the sense Mitchell's phrase "the code and its models" means.
- **`apps/web/src/server/db/schema.ts` declares 17 Drizzle tables** in 855 lines
  (`pgTable(` at `:40`, `:138`, `:210`, `:253`, … `:829`). These are the models
  in the other sense, and they are a different set from the contracts.

### The "generated, then checked" pattern is already here four times

This is the most important finding, and it changes the shape of the proposal.
The repo has already solved "a derived artifact that cannot drift" — most
recently two days ago, for a problem structurally identical to this one.

| Precedent | What it derives | How it cannot drift |
|---|---|---|
| `scripts/check-lint-wall.mjs` | that the UI/server import wall is exactly one hole | lints deliberately-sabotaged fixtures and asserts **which rule** rejected each (`:64-70`); runs in `pnpm lint` (`package.json:12`) |
| `pnpm content:verify` | the content rules a schema cannot state | the same code path with the writes off; the same lint runs inside `pnpm test` via `packages/fixtures/src/bundle/content.test.ts:19-22` |
| `pnpm seed:verify` | counts, coverage, rollups and conflicts for the Japan fixture | folded through the real domain against a recorded baseline; runs inside `pnpm check` (`package.json:19`) |
| **`openapi.json`** | the entire public API reference, from route declarations | **`openapi.test.ts` is both the generator and the check** |

The fourth is the template. `apps/web/src/server/public-api/openapi.test.ts:1-11`
states the rule this design adopts wholesale:

> This file is BOTH the generator and the check, on purpose. Two walks — one in
> a script, one in a test — would be two chances to disagree, which is the exact
> failure the derived-docs claim exists to rule out.

`UPDATE_OPENAPI=1` rewrites the committed file (`apps/web/package.json:29`,
`pnpm --filter web openapi:generate`); any other invocation compares and fails
with *"openapi.json is stale"*. A 595KB committed artifact stays true with
nobody remembering anything. **The question this design has to answer is not
"can a map be generated" — it is "which parts of a map can be", and what happens
to the parts that cannot.**

### The split this design copies already exists, and its cost is measured

`pnpm state` / `scripts/state-digest.mjs` is the same shape, deliberately:

- The **script** extracts and cites. `state-digest.mjs:25-33` — *"NO PROSE, NO
  JUDGEMENT. Every EXTRACTED fact carries a file:line citation."* It has a hard
  budget (`:34-41`, ~60-80 lines, ≤2,500 tokens) and it **defers twice on
  purpose** (`:42-47`): a worktree count rather than an audit, and a *named
  mismatch* rather than a verdict when status sources disagree.
- The **skill** spends a model turn on precisely what the script refused.
  `AGENTS.md:152-154` — `/roadmap` *"calls it for its Steps 1 and 3, then spends
  its turn on the judgement the script refuses to make."*

Why the script exists at all rather than one more thing to invoke is the measured
part (`AGENTS.md:157-159`, from `docs/reviews/2026-09-02-session-tooling-review.md`
R1/F1/F2/F8): **2,621 orientation re-reads across 220 sessions, ~1.9M tokens —
against 9 sessions that thought to run `/roadmap`.** An opt-in that costs a turn
does not get opted into.

### The gate-close checklist is the repo's one-commit trigger, and it has grown for this reason before

`docs/milestones/README.md:12-34`. A gate passing is *"the single trigger for
flipping **every** status flag, in **one commit** — never a trailing manual step
(that is how M2 stayed unticked)"*. It has five steps, and **step 5 is a patch**
(`:22-31`, *"Added 2026-09-01"*): updating `docs/STATUS.md` was missing from the
list, and the cost was measured — neither M11a's nor M11b's gate-close commit
touched it, so *"the file `CLAUDE.md` tells every session to read **first** spent
two gates claiming both were still open PRs in review."* The checklist closes
with an explicit instruction about scope: *"Keep it to the pointer; the narrative
belongs in the milestone file."*

### Known issues already carry their location, in a fixed field

Every one of the **68 open entries** in `docs/known-issues/open/` has an
`- **Area:**` line. Measured over the 68:

- **64** name at least one backticked repo path (`apps/`, `packages/`, `scripts/`,
  `docs/`, `content/`, `.claude/`, `.github/`).
- **54** name a path with a file extension, most of them with line ranges.
- **4** do not, and the weakest is literally `` - **Area:** `apps/web/src` (various) ``.

The best-formed example, and the one this design keeps returning to, is
`docs/known-issues/open/KI-20260905-o-activity-fields-hand-enumerated.md:4`:

> - **Area:** `packages/contracts/src/activity.ts:103-110,119-126,159-166`;
>   `packages/domain/src/trip/state.ts:3-12` (hand-written `ActivityState`),
>   `equality.ts:40-60` … A file scan finds **21 non-test files** enumerating all
>   of `timeWindow/location/notes/anchors/kind/tags/cost`.

`docs/known-issues/README.md:35-41` carries a constraint this design must obey
rather than argue with: **"There is deliberately no index file, and none should
be added."** A committed index is a file every branch appends to — *"precisely
the defect KI-95 measured, moved one level up."*

### ADRs are weaker signal than they look

All 47 have a `**Status:**` line at line start — parseable. But only **31 of 47**
name a repo path in backticks, and only **9** use a module name from the module
map. There is no front matter and no `Related:` on 29 of them. An ADR→node
binding is derivable, but at materially lower coverage than a KI→node binding,
and this design says so rather than claiming both work equally.

## The design

### Decision 1 — two layers, not one: a MECHANICAL layer and an ANNOTATION layer

**Decided in conversation 2026-09-18.**

The map is **generated from source and drift-checked in CI** (mechanical), plus a
**hand-written layer carrying milestone context** (annotation) written by a person
or an agent.

This is the `pnpm state` / `/roadmap` split (`AGENTS.md:142-160`), applied to
structure instead of status, and it is chosen for a reason this repo has already
paid for rather than on taste. A single hand-written first-read document drifts.
`docs/STATUS.md:8-24` records that happening twice: to 1,779 lines on 2026-08-28
(*"a first-read file became a file people skim"*), cut, then **back to 1,418 lines
by 2026-09-11 with a `## Next action` section still naming M17 as current on the
day M17's gate closed**. STATUS.md's own conclusion is the load-bearing sentence
for this whole design:

> Length was the symptom; **the stale section was the defect**, and it is the
> reason to distrust a long first-read file rather than merely resent it.

A diagram is a first-read file by construction. If it can go stale silently, it
inherits that defect and multiplies it, because a diagram is read *faster* and
questioned *less* than prose. So the half that can be derived must be derived,
and the half that cannot must be small, dated, and visibly separate from the half
that is checked.

### Decision 2 — the annotation layer is written at GATE CLOSE, not from scratch

**Decided in conversation 2026-09-18.** Mitchell's argument, recorded as the
reason: **it is far easier to describe a part of the system at the end of the
milestone that built it, with the context live, than to reconstruct it cold
later.**

The mechanism follows from the argument. The annotation is not a project; it is a
paragraph owed at the moment its subject is best understood. The natural home is
the gate-close checklist in `docs/milestones/README.md:12-34`, which is already
*the single one-commit trigger for every status flag* — the only place in this
repo where "at the end of a milestone, in one commit" is already law.

**Proposed step 6:**

> 6. **Write or revise this milestone's annotation in the architecture map.**
>    One paragraph per node the milestone created or materially changed: what it
>    is for, what it may not know about, and which ADR governs it. Keep it to
>    what a reviewer needs before reading the code; the narrative belongs in the
>    milestone file.

Two properties are deliberate. First, the wording mirrors step 5's own scope
instruction (*"Keep it to the pointer; the narrative belongs in the milestone
file"*) — an annotation that grows into a second design document is this
checklist's known failure mode, not a new one. Second, **the checklist has
already grown once for exactly this reason**: step 5 was missing and it cost two
gates (`docs/milestones/README.md:22-31`). That is the precedent for adding step
6, and it is also the warning — a step that exists is not a step that runs, which
is why `TODO.md`'s standing preflight re-checks the list at the next kickoff
(`docs/milestones/README.md:33-34`).

**What this does not do:** it does not backfill. At the first gate after this
lands, exactly one milestone's nodes get annotated. Everything older stays
mechanically-generated-only until its area is next touched. That is the honest
rollout and it is the cheap one; a backfill sprint would be reconstructing cold
context, which is the thing this decision exists to avoid.

### Decision 3 — known issues bind to diagram nodes, and the binding is DERIVED, never hand-maintained

**Decided in conversation 2026-09-18.**

Every open KI's `- **Area:**` line already carries real paths. The generator
parses those paths and maps **path → node**. Nothing is added to a KI entry, and
no KI entry is edited.

Why derivation beats the obvious alternative — adding a `node:` field to the KI
template:

- **68 open entries, none of which would need editing.** A new field means either
  a 68-file backfill or a register where the field is present on some entries and
  absent on others, which is worse than absent everywhere.
- **Nothing new to keep in sync.** A `node:` field is a second statement of the
  same fact, which is what `AGENTS.md:100-103` (invariant 5, *"contracts change
  by protocol, not by drift"*) and ADR-037 exist to forbid, and which the M22
  design refused for the same reason: *"a hand-maintained duplicate of the
  registry: exactly the shape Invariant 5 exists to stop."*
- **It obeys the no-index rule.** `docs/known-issues/README.md:35-41` forbids a
  committed index over the register. Derivation reads the register and writes
  into a *different* artifact; it adds no file that every branch appends to.

**The payoff, stated plainly: an agent about to change an area can ask what is
already known-broken there.** That makes `CLAUDE.md` rule 2 — *"before calling a
failure environmental, flaky, or infra, `grep -r "<symptom>" docs/known-issues/`"*
— **structural rather than remembered**. Rule 2 exists because KI-27 was
misdiagnosed as environmental twice, the second time costing a day, with the
correct entry already written and unread
(`docs/specs/2026-08-28-subagent-operating-contract-design.md`, *Why*). The grep
is not hard; remembering to grep is. A binding that is present before the work
starts removes the remembering.

**The honest limit, from the measurement above:** 64 of 68 Area lines carry a
path, so ~94% bind. The 4 that do not bind to nothing, and the generator must
**report them as unbound rather than dropping them**, because an unbound-KI count
that silently drifts upward is how a derived binding stops being worth trusting.

### Decision 4 — a diagram does not enforce DRY; it makes duplication visible

**Decided in conversation 2026-09-18**, and it is the correction to requirement
(4) above rather than an answer to it.

The evidence is in this repo and it is unambiguous.
`KI-20260905-o-activity-fields-hand-enumerated.md` records **21 non-test files
hand-enumerating the same seven activity fields**, with the class having already
bitten three times — KI-1 (day order), KI-54 (`city`/`countryCode` invisible to
equality, so city-only edits were rejected as a no-op), and M18's editor sheet
dropping `kind`/`tags`. Every one of those 21 files sits inside a clean module,
on the correct side of every boundary in `AGENTS.md:111-120`. **They would render
beautifully on a diagram and still compile green.** A picture of that system is a
picture of a healthy system.

What actually enforces DRY here is executable, in every case:

- **The CI lint wall** — `scripts/check-lint-wall.mjs`, which does not merely run
  eslint but asserts *which rule* rejected each sabotaged fixture (`:16-27`,
  `:64-70`), because a fixture rejected for the wrong reason used to read as
  proof the wall fired.
- **The contracts protocol** — invariant 5, `AGENTS.md:100-105`: types inferred,
  never hand-written twice; a `docs/contracts/CHANGELOG.md` entry and all
  consumers updated in the same PR.
- **`soleWriter.test.ts`** (`apps/web/src/server/billing/`) — the webhook is
  Billing's only writer, per ADR-047, proven rather than asserted.
- **`planVersions.noExtension.test.ts`** (`apps/web/src/server/entitlements/`) —
  and note that its sibling claim is the cautionary half: `KI-2026-09-16-b`
  records that `planVersions.ts`'s header cites an immutability test **that does
  not exist**, so the runtime-freeze half is asserted by nothing.

And the fix KI-o actually wants is executable too: *"a mapped-type
`FIELD_EQUAL: Record<keyof ActivitySnapshot, …>` so a new field is a **compile
error** until every site is updated."*

So the claim this design makes for DRY is the narrow one: **the map tells you
where to point a refactor; it does not perform one.** Concretely, the generated
layer can surface a node's fan-out, the count of files enumerating a contract's
fields, and the open KIs bound to it — three facts that make KI-o's 21 files
*findable* from the map instead of from a memory of a review. Turning that into
a compile error is a code change, and it is not this.

## The mechanical layer, concretely

### The six signals, each verified machine-readable before being claimed

| # | Signal | Source | Verified |
|---|---|---|---|
| 1 | **Workspace package edges** | `pnpm-workspace.yaml` (`packages/*`, `apps/*`) + each `package.json`'s `workspace:*` deps | **Yes.** 7 packages; every edge is a literal `"@tc/x": "workspace:*"`. No parsing of source needed |
| 2 | **Contract models** | `packages/contracts/src/*.ts`, barrelled at `index.ts:1-20` | **Yes** — 123 top-level `export const … = z.…` across 20 modules. Import the barrel and read the export table; do **not** regex the source |
| 3 | **Storage models** | `apps/web/src/server/db/schema.ts` | **Yes** — 17 `pgTable(` declarations, each an exported const. Same technique: import, do not regex |
| 4 | **Public API surface** | `apps/web/src/app/api/v1/**/route.ts` | **Yes, and already done.** `routeModulePaths()` + `urlOf()` + `buildOpenApi()` in `apps/web/src/server/public-api/openapi.ts:26-44` already walk the tree and emit the operation table. The map **consumes that walk**; it does not write a second one |
| 5 | **The module map** | `AGENTS.md:67-76` | **Yes, with one caveat.** A GFM table with a fixed 4-column header. Parseable by row-splitting on `\|`. The caveat: cells contain nested markdown (`**bold**`, backticked identifiers, `(**ADR-045**)`), so the parse must be tolerant of inline markup and must fail loudly if the header row moves |
| 6 | **ADR index** | `docs/architecture/ADR-*.md` | **Partially — and the brief overstated this.** There is **no index file**; the filename convention *is* the index. `ADR-NNN-kebab-title.md` plus the H1 and a `**Status:**` line at line start (all 47 have one) is reliably derivable. Binding an ADR to a node is **not**: only 31 of 47 name a repo path, only 9 name a module-map module |

Signal 4 is the one worth dwelling on. It is not merely available — it is
*already extracted*, into a 595KB committed `openapi.json` that a test regenerates
and compares. The map should read the same declarations through the same
functions. A second walk over `v1/` would be the two-chances-to-disagree failure
`openapi.test.ts:1-11` names explicitly.

### Output and verb

**Proposed output: `docs/architecture/MAP.md`, with Mermaid.**

Mermaid because GitHub renders it in-place, a reviewer sees the picture without a
toolchain, and it is text — so it diffs, it reviews, and it merges. A binary or
an SVG would satisfy "diagram" and fail "reviewable".

**Proposed verbs**, consistent with `package.json:19-20`:

```
pnpm map:verify     # regenerate in memory, compare to the committed file,
                    # print the readable report. Fails on drift.
pnpm map:generate   # rewrite docs/architecture/MAP.md
```

Mirroring the `content:verify` / `seed:verify` pair, where the standalone command
exists *for the readable table* while the enforcement runs inside the suite
(`AGENTS.md:180-193`).

**Proposed layout — one module, two entry points, one walk:**

```
scripts/build-map.mjs               exports buildMap(root) -> string
scripts/__tests__/build-map.test.mjs  generator AND check, UPDATE_MAP=1 rewrites
```

`scripts/__tests__/**/*.test.mjs` is already in root `pnpm test`
(`package.json:13`, `node --test "scripts/**/__tests__/**/*.test.mjs"`), so the
drift check reaches CI with **zero new workflow configuration**. The generator
is one function called from both places, per `openapi.test.ts`'s rule.

## What the drift check fails on, precisely

Three conditions, all structural, none stylistic. Each is a fact about the
generated layer only.

1. **A contract schema or a database table with no node.** A new
   `export const … = z.object(…)` in `packages/contracts/src/`, or a new
   `pgTable(` in `schema.ts`, that the committed map does not place. This is the
   common case and the one worth having: it fires in the same diff that added the
   model.
2. **A node naming something that no longer exists.** A node bound to a path,
   schema export or table that the generator cannot find. This is the
   `KI-2026-09-16-b` failure mode — a header citing a test file that does not
   exist — caught mechanically rather than by a reader noticing.
3. **A dependency edge the map does not show.** A `workspace:*` edge between two
   packages, or an import crossing a module-map boundary, with no corresponding
   edge in the diagram.

**It fails CI the way `content:verify` does** — inside `pnpm test`, in the same
diff, with no separate job. `packages/fixtures/src/bundle/content.test.ts:19-21`
states why that placement rather than a standalone script: *"it runs on every
`pnpm --filter @tc/fixtures test`, so a bundle added in a later PR is checked by
CI without anybody remembering to run a script."*

**It must not fail on prose.** Two mechanisms, and they are not the same one:

- **Nothing in the annotation layer is an input to any of the three conditions.**
  The check compares generated bytes to committed generated bytes. A rewritten
  paragraph changes neither side.
- **The CI path filter already exempts prose**, but *not in the direction that
  helps here* — see the trap below.

### The trap: `docs/**` and root `*.md` are both path-ignored

`.github/workflows/ci.yml:29-44` ignores `docs/**`, `.claude/**`, `.agents/**`,
root-level `*.md` and `.github/**/*.md`. Two consequences this design must state
rather than discover later:

- **`docs/architecture/MAP.md` is under `docs/**`.** A branch whose only change
  is the map runs no CI. That is *mostly* correct — a regeneration with no source
  change is a no-op — but it means **a hand-edit of the generated section is
  unchecked until the next code change touches the branch.** The mitigation is
  that any real source change re-triggers the suite and the comparison then fails
  on the hand-edit; the exposure is the window, not the outcome.
- **`AGENTS.md` is root-level prose and is path-ignored too.** So signal 5 has a
  hole: **editing the module map table at `AGENTS.md:67-76` alone does not run
  CI**, and a module renamed there would leave the map stale with nothing red.
  This is a genuine gap in a docs-only PR, and `CLAUDE.md` rule 4 is the reason it
  is easy to get backwards — for `pull_request` events GitHub evaluates
  `paths-ignore` against the **whole PR diff**, so the hole closes the moment the
  same PR carries any code. The shape that stays open is a pure-prose PR, which
  is exactly the shape of a gate-close commit.

Neither is a reason to move the file. Both are reasons the check's advertised
guarantee is *"cannot drift from code"* and **not** *"cannot drift"*.

## What the skill does that the script cannot

The script refuses judgement, deliberately, exactly as `state-digest.mjs:42-47`
refuses it. The skill is the judgement half, and it has two jobs — not a general
"maintain the map" mandate, which is how a skill becomes a thing nobody invokes.

### Job 1 — "I am about to change X, what should I know"

The skill reads the generated map and answers, before any code is read:

- **Which nodes the change touches**, and what each one is forbidden to know
  about (`AGENTS.md:67-76`, the fourth column — *"Explicitly does NOT know
  about"*).
- **Which open KIs are bound there**, from Decision 3's derivation — the
  structural form of `CLAUDE.md` rule 2.
- **Which ADRs govern it**, with the 31-of-47 coverage caveat stated in the
  answer rather than hidden. An ADR that does not name a path is not silently
  omitted; it is listed as unbound.
- **Which invariants are at risk** — the specific ones, not all six. A change
  under `packages/domain` puts invariant 4 (purity, no I/O, no wall-clock) at
  risk; a change to a projection puts invariant 2 (rebuildable) at risk; a change
  under `packages/contracts` puts invariant 5 and the CHANGELOG protocol at risk
  and, per the subagent protocol's parallelisation test, makes the work its own
  serialized unit.

This is the request that pays for the artifact. It is also the one that must
answer in a handful of tool calls, because the alternative it competes with —
re-reading the codebase — is the 1.9M-token behaviour, and a skill that costs
more than the habit it replaces loses to the habit.

### Job 2 — authoring the annotation at gate close

Invoked by step 6 of Decision 2. The skill reads the milestone file, the retro
note, the diff range for the milestone, and the newly regenerated mechanical
layer, and drafts the paragraph per changed node. A person reviews it in the
gate-close commit like any other prose.

**What it must not do:** touch the generated layer. The generator owns those
bytes; the skill owns the paragraph. If the skill finds the generated layer
wrong, the correct output is a finding, not an edit.

### What it is not

Not an auditor, not a refactorer, not a reviewer of code quality. Decision 4 is
the boundary: it can say *"21 files enumerate these seven fields and here is the
KI that already says so"*; it cannot and must not offer to fix them as part of a
map update.

## Cost, and the honest risks

### Cost

- **One script plus one test** (~2 files), one checklist step, one skill file in
  `.claude/skills/<name>/SKILL.md` (the `worktree-hygiene` shape — a front-matter
  `name`/`description` and a numbered procedure).
- **One committed artifact** under `docs/architecture/`, regenerated by a verb.
- **Per-gate:** one paragraph per changed node, written when the context is live.
- **Per-CI-run:** one more comparison inside `pnpm test`. Negligible against the
  suite; relevant only because CI minutes are a real budget here
  (`.github/workflows/ci.yml:1-10` — 2,000 Linux minutes/month, a measured 30-day
  sample at 1,956).

### Risk 1 — a generated map is another artifact to keep honest

**What bounds it:** the three failure conditions are the only claims it makes.
The map asserts *these models exist, these edges exist, these nodes name live
things* — all three mechanically checked. It does not assert that the structure
is good, and it must not grow assertions the check cannot hold. The precedent for
that discipline is `state-digest.mjs:34-41`'s non-negotiable budget: *"a digest
that grows into a second copy of STATUS.md has failed at its only job."* The
equivalent failure here is a map that grows into a second copy of `AGENTS.md`.

### Risk 2 — a Mermaid diagram of a large codebase becomes unreadable

Real and near. 7 packages is fine; 17 tables and 123 schemas on one canvas is
not.

**What bounds it:** a hard cap, chosen and written into the generator rather than
discovered by eye — no single diagram over ~25 nodes. Past that the generator
emits per-module diagrams and one top-level overview, and **fails rather than
emitting an unreadable one**. This is the same move as the digest's line budget
and the same move as the KI block printing counts plus the newest few rather than
the full list (`state-digest.mjs:59-62` — *"42 open KIs today fits, and 200 would
not, and the budget is not negotiable"*). Which shape to pick is Open question 2;
that there must be a cap is not open.

### Risk 3 — a drift check that fires constantly gets ignored

The repo has the measurement for this too, in the harshest available form.
`docs/reviews/2026-09-02-session-tooling-review.md:106` (F7): `worktree-hygiene`
was invoked in **4 sessions**, against **47 sessions making 112 manual
`git worktree` calls**. `minimal-check-subset`: **9 sessions**, against **45
running full `pnpm check`** — *"zero overlap"*. And
`docs/specs/2026-08-28-subagent-operating-contract-design.md` states the rule
that follows: *"a `Stop` hook that fires on every turn is trained away within a
day, after which it enforces nothing"*, with the standing remedy *"if a hook
misfires twice, delete it rather than tuning it."*

**What bounds it:** the three conditions are all **"a real thing exists and the
map does not know about it"** — none of them fires on formatting, ordering,
wording, or anything a person chose. A new table or a new schema is exactly the
moment the map *should* interrupt. If it fires on a change that added no model
and removed no path, that is a generator bug, and the response is to fix the
generator or delete the condition — not to lower its severity.

**And the skill carries the same risk in its worse form.** F7 says a skill nobody
invokes is the default outcome, not the failure case. The only defence this
design has is Job 1 being cheaper than the habit it replaces, and Job 2 being
*called by the checklist* rather than remembered. If after three gates the
annotation step is skipped twice, the honest response is to cut the annotation
layer and keep the generated one, not to write a reminder.

## Alternatives rejected

- **One hand-written architecture document, no generator.** Rejected on
  `docs/STATUS.md:8-24`: this repo has the measurement, twice, and the conclusion
  is that the stale section is the defect. A hand-written map would be a
  first-read file with no mechanism keeping it true, which is the single thing
  this design exists not to build.
- **A `node:` field added to the KI template.** Rejected in Decision 3: 68
  entries, a second statement of a fact the `Area:` line already carries, and the
  drift shape invariant 5 forbids.
- **An index file listing nodes, KIs and ADRs.** Rejected by
  `docs/known-issues/README.md:35-41` — *"There is deliberately no index file, and
  none should be added"*, because a committed index is a file every branch
  appends to (KI-95). The generated map is a near miss on this rule and Open
  question 3 is where the near miss is decided.
- **A second walk over `apps/web/src/app/api/v1/**`.** Rejected by
  `openapi.test.ts:1-11` — two walks are two chances to disagree. The map calls
  `routeModulePaths()`/`buildOpenApi()` or it does not use signal 4.
- **Generating the map at request time, or in a CI job of its own.** Rejected by
  `openapi.ts:16-23`'s reasoning (a bundled server cannot walk its own source
  tree; a doc built on demand is work on a hot path for something that changes
  only when the code does) and by the CI budget at `ci.yml:1-10`.
- **A `Stop` or `PostToolUse` hook that regenerates the map on every edit.**
  Rejected on the trained-away argument above, and because regeneration on every
  `.ts` edit would put a 595KB-class artifact in every intermediate commit.

## Open questions

1. **Granularity — module, package, or file?** The three signals disagree with
   each other, which is the actual difficulty. The module map has **8 modules**
   (`AGENTS.md:67-76`); the workspace has **7 packages**; the models number
   **123 schemas + 17 tables**. Module-level is the altitude a reviewer wants and
   the altitude at which "explicitly does NOT know about" is meaningful, but
   modules are not directories here — `Access & Membership`, `History` and
   `Trip Planning` all live inside `apps/web/src/server/**` and
   `packages/domain/**`. Package-level is the only one that is *free* — it needs
   no mapping at all — and it is the least useful. **Recommendation: nodes are
   modules, and the module→path mapping is the one hand-written input the
   generator takes**, checked by condition 2 (a node naming something deleted).
   Not decided.
2. **One diagram or several?** One canvas is one picture to read; several are
   readable at real size. Risk 2's cap forces the question rather than answering
   it. **Recommendation: one top-level module diagram plus one per module on
   demand**, but the cost is that N+1 artifacts drift in N+1 ways. Not decided.
3. **Does the annotation layer live in the same file as the generated one, or
   beside it?** The trade-off, stated: **one file risks a generator clobbering
   prose** — every regeneration is a write over a region a person authored, and
   one off-by-one in a marker boundary silently eats a paragraph that exists
   nowhere else. Two files cost a reader one extra hop and let the pair drift
   apart in the one way nothing checks (an annotation describing a node the map
   no longer has — though note condition 2 covers exactly that). There is a
   second argument for two files that is specific to this repo: a single
   `MAP.md` carrying both is a **hot insertion point** in KI-95's precise sense,
   and the regeneration escape hatch (resolve a conflict by regenerating) works
   for generated bytes and **not** for prose. Not decided.

## Not decided here

This is a design for approval. It mints **no milestone**, it claims no place in
the milestone order — which `docs/STATUS.md`'s *"Where the work is right now"*
block carries, and whose tail changed on 2026-09-18 while this was being written
— and it is not roadmap work.

It is **repo automation** in the sense of `AGENTS.md:142-209` — a committed
script, a committed check, a slash-command-or-skill and a checklist step, in the
same category as `pnpm state`, `pnpm content:verify`, `pnpm seed:verify` and the
lint walls. Per that section's own heading — *"check here before hand-rolling a
workflow"* — building this means adding entries to it, not to `TODO.md`.

Three things are owed before a first commit, and none of them is code:

1. Mitchell's answer on the three open questions, or an explicit instruction to
   take the three recommendations.
2. Approval of the new gate-close step (Decision 2), which edits a file that
   *"changes only by explicit decision from Mitchell"*
   (`docs/milestones/README.md:9-10`).
3. A decision on whether the first build is the generator alone. **The
   recommendation is yes** — the generated layer plus the drift check are useful
   with no skill and no annotation, they are the half that cannot rot, and
   shipping them alone is the smallest thing that can fail honestly. The skill
   and the checklist step are worth having only if the generated layer turns out
   to be read.
