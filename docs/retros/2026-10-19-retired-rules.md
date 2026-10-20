# Retired rules — 2026-10-19

A retirement pass under `docs/guidelines/retiring-a-rule.md`, run at M50's gate close
(`pnpm milestone close` step 7) for KI-2026-10-19-b. `AGENTS.md` went from **29,085 B to
28,316 B** against its 34,000 B budget: 86% to 83%, below the 85% `near` line.

Nothing here removes an invariant, a module-map row, an exemption's path or decision citation,
or a rule's one-line incident citation. Every entry shortens a story to its citation, drops
history of the document, or drops a second copy of a rule the same file states elsewhere.
The KI's larger candidates (the exemption paragraphs as a list, the Verification and Testing
sections against CLAUDE.md) restructure binding text and are left for their own pass; the KI
stays open for them.

Text moved verbatim. To reverse one, put it back and name the incident in the commit.

## 1. `AGENTS.md` — Definition of Done › The short version: the suggester-role story past its citation

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
> **The short version, because it has been misread.** Mid-branch, each fix runs
> **only its own subset** (Tier 1 or 2; CLAUDE.md rule 4). The full suite runs
> **once**, when the PR is ready (Tier 3), and CI runs it, not you: the full
> suite is never run locally (CLAUDE.md rule 1). **Never per part of a stack,
> per fix, or "to be sure"** — the suggester role ran it on each of three
> stacked parts and twice more (`docs/retros/2026-10-04-suggester-role-retro.md`, §2).
````

**Now:**

````markdown
> **The short version.** Mid-branch, each fix runs **only its own subset**
> (Tier 1 or 2). The full suite runs **once**, when the PR is ready (Tier 3),
> and CI runs it, never you (CLAUDE.md rules 1 and 4). **Never per part of a
> stack, per fix, or "to be sure"** (`docs/retros/2026-10-04-suggester-role-retro.md`, §2).
````

## 2. `AGENTS.md` — Architecture map › the admin exemption's rationale, shortened around its citation

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
not reach `packages/domain` or build an Auth.js instance. M20's gate needs a
non-admin to get a 404 for the **route**, and `users.is_admin` is a database column
the edge proxy cannot read under JWT sessions (ADR-025); the console fetching its
own API over HTTP produced two defects in two days. `scripts/check-lint-wall.mjs`
lints three fixtures under `src/app/admin`, so the exemption is exactly one hole.
````

**Now:**

````markdown
not reach `packages/domain` or build an Auth.js instance: a non-admin gets a 404
for the **route**, which the edge proxy cannot decide under JWT sessions (ADR-025,
M20); fetching its own API over HTTP cost two defects in two days.
`scripts/check-lint-wall.mjs` lints three fixtures under `src/app/admin`, so
the exemption is exactly one hole.
````

## 3. `AGENTS.md` — Workstreams › the PR-promptness rule's M10 story

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
until its **PR is open**. A `docs/STATUS.md` on an unmerged branch is read by
nobody, and only a PR puts the diff in front of conflict detection while it is
small — M10 Wave 2's Phase 3 sat built and PR-less while Phase 4 merged past it
(PR #25). Before starting
````

**Now:**

````markdown
until its **PR is open**: only a PR puts the diff in front of conflict
detection while it is small (M10 Wave 2, PR 25). Before starting
````

## 4. `AGENTS.md` — What the change itself must carry › the PR 141 story past its citation

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
  will exist when link N lands" is a fine answer written down and a bad one
  discovered in review — PR #141 opened as "the primitives, not in the picker"
  and drew *"this is another milestone thats not functionally reviewable"*.
````

**Now:**

````markdown
  will exist when link N lands" is a fine answer written down and a bad one
  discovered in review (PR 141).
````

## 5. `AGENTS.md` — Review is ours › the CodeRabbit removal (history of the document)

**Criterion:** 2 (history of the document).

**Was:**

````markdown
**Decided 2026-10-13 (Mitchell): CodeRabbit is removed, and we do our own
reviews.** A new `part-reviewer` subagent
````

**Now:**

````markdown
**We do our own reviews** (Mitchell, 2026-10-13). A `part-reviewer` subagent
````

## 6. `AGENTS.md` — Drift signals › the status-file story past its citation

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
  `scripts/check-ki-citations.mjs` catches the mechanical half. The judgement
  half: three status files agreeing is not corroboration when none of their
  authors opened the entry — a milestone spent three days blocked on a variable
  that was set all along (`docs/known-issues/README.md`, 2026-09-19).
````

**Now:**

````markdown
  `scripts/check-ki-citations.mjs` catches the mechanical half. The judgement
  half: files agreeing is not corroboration if none opened the entry
  (`docs/known-issues/README.md`, 2026-09-19).
````

## 7. `AGENTS.md` — Do not watch what cannot run › restates Tier 1's branch-wide rule

**Criterion:** 4 (restated).

**Was:**

````markdown
**Tier 1 PR** — the *whole PR* prose, so only `ci-ok` reports, in under a
minute (a prose commit on a branch that carries code is not this case) — or on
````

**Now:**

````markdown
**Tier 1 PR** (the *whole PR* prose; only `ci-ok` reports) or on
````

## 8. `AGENTS.md` — Testing model › the witness story past one number

**Criterion:** 3 (incident narrative past one sentence).

**Was:**

````markdown
  half the observed minimum. A probe once passed 400 runs having asserted
  **zero** times, and the first guessed floors flapped 3-in-15.
````

**Now:**

````markdown
  half the observed minimum: a probe once passed 400 runs asserting **zero** times.
````


# Second pass — 2026-10-20

The rest of KI-2026-10-19-b, asked for directly by Mitchell ("Prune agents.md, open a pr"):
the exemption paragraphs as a list, the Verification and Testing sections against CLAUDE.md
and `docs/guidelines/testing.md`, the stale trip-board sentence, and the 75% target.
`AGENTS.md` went from **28,316 B to 24,806 B** against its 34,000 B budget: 83% to 73%.

As in the first pass, no invariant, module-map row, exemption path, decision citation, fixture
count or one-line incident citation is removed. Every rule cut from `AGENTS.md` here is still
stated in CLAUDE.md, in the guideline named in its criterion, or in a shorter line in
`AGENTS.md` itself.

## 9. `AGENTS.md` — What we are building › the orientation line CLAUDE.md already gives

**Criterion:** 4 (restated: CLAUDE.md's *Quick orientation* lists the spec, `docs/architecture/`, `TODO.md`, `docs/milestones/README.md` and `docs/guidelines/`).

**Was:**

````markdown
`docs/STATUS.md` (read first on a fresh session).
Design record: `docs/specs/2026-07-07-foundation-design.md` · Decisions:
`docs/architecture/` · Roadmap: `TODO.md` + `docs/milestones/README.md` ·
How-to guides: `docs/guidelines/`
````

**Now:**

````markdown
`docs/STATUS.md` (read first on a fresh session).
````

## 10. `AGENTS.md` — Architecture map › the six exemption paragraphs, as one list

**Criterion:** 1 (enforced: each hole is fixtured in `scripts/check-lint-wall.mjs` and explained in `apps/web/eslint.config.mjs`) and 3 (rationale past one sentence). Every path, decision citation, "on the console's terms" and fixture count kept. Also 5 (stale): the trip board's "the board is in the first HTML" — since PR 486's later commits only the board's header and its view's placeholder are (`apps/web/src/server/tripFirstData.ts`'s docblock).

**Was:**

````markdown
The exempt shell is `src/server/**`, `src/app/api/**`,
`src/app/.well-known/**/route.ts` — and, since 2026-09-14,
**`src/app/admin/**`**, which may import `src/server` internals but still may
not reach `packages/domain` or build an Auth.js instance: a non-admin gets a 404
for the **route**, which the edge proxy cannot decide under JWT sessions (ADR-025,
M20); fetching its own API over HTTP cost two defects in two days.
`scripts/check-lint-wall.mjs` lints three fixtures under `src/app/admin`, so
the exemption is exactly one hole.

Since 2026-10-02 the shell also holds **`src/app/sitemap.ts` and
`src/app/robots.ts`** (SEO pass, D2): the sitemap lists every published day,
which only the database knows. Console terms; five fixtures in
`scripts/check-lint-wall.mjs`.

And **`src/app/playbooks/**/page.tsx`** (SEO pass, D5): the public
library's pages render on the server so a crawler receives the day and a
missing one answers 404. Page files only, on the console's terms; the screens
they render still call the API. Seven fixtures hold it there. `live/` holds
them; `[copy]/` re-exports them as the cached copy `proxy.ts` serves a reader
with no session and no query (ADR-077).

And **`src/app/(app)/layout.tsx`** (M45, Mitchell's decision 3 of 2026-10-13):
it resolves the reader's conferred entitlements per request through
`server/entitlements/resolver.ts` and sends them with the page, so an Ask
offered only to a plan with the assistant is in the first HTML, and, beside
it, the reader's preferences through `server/accountPreferences.ts`, so
`PreferencesProvider` does not fetch them after hydration. That file and
`src/app/playbooks/live/layout.tsx`, both through `server/servedSession.ts`,
on the console's terms; never a JWT claim (ADR-045 rule 2). Five fixtures.

And **`src/app/(app)/home/page.tsx`** (Mitchell's decision of 2026-10-18): Home
reads `server/listedTrips.ts`, the `/api/trips` body, so the next-trip hero
and the grid are in the first HTML. That file only; `HomeScreen` stays UI.
Four fixtures.

And **`src/app/(app)/trips/[tripId]/(board)/page.tsx`** (Mitchell's decision of
2026-10-18): it reads the board's first answers in-process
(`server/tripFirstData.ts`) after one `requireTripAccess`, through the GET
routes' own builders, so the board is in the first HTML. Page file only, on the
console's terms; the board stays UI. Six fixtures.
````

**Now:**

````markdown
The exempt shell is `src/server/**`, `src/app/api/**` and
`src/app/.well-known/**/route.ts`, plus the files below, each **on the
console's terms**: it may import `src/server` internals, never `packages/domain`
or an Auth.js instance. `scripts/check-lint-wall.mjs` fixtures each hole (count
in brackets); `apps/web/eslint.config.mjs` says why.

- **`src/app/admin/**`** (2026-09-14; ADR-025, M20): a non-admin's 404 is
  for the **route**, which the edge proxy cannot decide under JWT sessions;
  fetching its own API cost two defects in two days. [3]
- **`src/app/sitemap.ts`, `src/app/robots.ts`** (2026-10-02, SEO pass D2). [5]
- **`src/app/playbooks/**/page.tsx`** (SEO pass D5): page files only; `live/`
  holds them, `[copy]/` re-exports them as `proxy.ts`'s cached copy (ADR-077). [7]
- **`src/app/(app)/layout.tsx`, `src/app/playbooks/live/layout.tsx`** (M45,
  Mitchell's decision 3 of 2026-10-13): entitlements and preferences per
  request via `server/servedSession.ts`; never a JWT claim (ADR-045 rule 2). [5]
- **`src/app/(app)/home/page.tsx`** (Mitchell, 2026-10-18): reads
  `server/listedTrips.ts`; `HomeScreen` stays UI. [4]
- **`src/app/(app)/trips/[tripId]/(board)/page.tsx`** (Mitchell, 2026-10-18):
  reads `server/tripFirstData.ts` after one `requireTripAccess`, through the GET
  routes' own builders, so the board's
  header and its view's placeholder are in the first HTML; the board stays UI. [6]
````

## 11. `AGENTS.md` — Workstreams › the worktree rule's stale skill and its M3 story

**Criterion:** 5 (stale: `superpowers:using-git-worktrees` is not a skill this repo or its sessions have; the 2026-10-16 audit, `docs/reviews/2026-10-16-codebase-and-agent-architecture-audit.md`, flagged it) and 3 (incident narrative past one sentence).

**Was:**

````markdown
back sequentially — never a shared working tree. Concurrent agents race on
git's index and refs even with disjoint file sets: in M3 one agent's
`git reset --soft` silently dropped a sibling's committed work. Isolate via
`superpowers:using-git-worktrees`.
````

**Now:**

````markdown
back sequentially — never a shared working tree: agents race on git's index
and refs even with disjoint files (M3 lost committed work to a sibling's
`git reset --soft`). Use `git worktree add`.
````

## 12. `AGENTS.md` — Definition of Done › Verification scales to the change: Tier 1 and the short version

**Criterion:** 4 (restated: CLAUDE.md rule 4 carries "prose-only is a property of the branch", run nothing, `ci-ok` only and still needs a PR; the tiers below carry the short version) and 5 (stale: `upstreamDrift.test.ts:30` reads the seed at line 33 now; line numbers dropped). The `.design-sync/**` trap, the classify command, the required-check rule and the suggester-retro citation are kept.

**Was:**

````markdown
Classify the change by what it touches, then run **only** that tier.

> **The short version.** Mid-branch, each fix runs **only its own subset**
> (Tier 1 or 2). The full suite runs **once**, when the PR is ready (Tier 3),
> and CI runs it, never you (CLAUDE.md rules 1 and 4). **Never per part of a
> stack, per fix, or "to be sure"** (`docs/retros/2026-10-04-suggester-role-retro.md`, §2).

**Tier 1 — prose only.** Every path changed **by the whole branch**, not just
by your latest commit, is under `docs/**`, `.claude/**`, `.agents/**`, or is a
root-level `*.md` (`README`, `AGENTS`, `CLAUDE`, `TODO`).

> Run nothing. No `pnpm check`, no test lane, no typecheck, no e2e, no browser.
> `.github/workflows/ci.yml`'s `changes` job (`scripts/ci-gate.mjs`) already
> excludes exactly these paths: every real job skips, `ci-ok` passes in under a
> minute, and there is nothing to wait on — see *Do not watch what cannot run*
> below.
>
> **The trap:** `.design-sync/**` is **not** prose. It is a real build input —
> `packages/fixtures/src/japan/upstreamDrift.test.ts:30` and
> `apps/web/scripts/geocode-japan-seed.mts:139` both read
> `.design-sync/handoff/data/japan-trip-seed.json` — so a change there is Tier 2
> even when only its markdown moved. `ci.yml` gets this right by
> listing `*.md` rather than `**/*.md`; classify the same way.
>
> **A Tier 1 branch still needs a PR:** `ci-ok` is a required check on `main`
> with no bypass (Mitchell, 2026-10-04, *"no exceptions"*). To classify, in one
> command:
>
> ```
> git diff --name-only origin/main...HEAD | grep -vE '^(docs/|\.claude/|\.agents/)|^[A-Za-z]+\.md$'
> ```
>
> Nothing printed means Tier 1. Anything printed means Tier 2.
````

**Now:**

````markdown
Classify by what the **whole branch** touches (CLAUDE.md rule 4), then run
**only** that tier. The full suite runs once, on the ready PR, in CI — never
per part of a stack, per fix, or "to be sure"
(`docs/retros/2026-10-04-suggester-role-retro.md`, §2).

**Tier 1 — prose only:** every path under `docs/**`, `.claude/**`, `.agents/**`
or a root-level `*.md`. Run nothing; `ci.yml`'s `changes` job
(`scripts/ci-gate.mjs`) skips every real job. It still needs a PR: `ci-ok` is
required on `main` with no bypass (Mitchell, 2026-10-04, *"no exceptions"*).
**The trap:** `.design-sync/**` is **not** prose — `upstreamDrift.test.ts` and
`geocode-japan-seed.mts` read its `handoff/data/japan-trip-seed.json` — so it is
Tier 2 even when only its markdown moved. To classify (nothing printed means
Tier 1):

```
git diff --name-only origin/main...HEAD | grep -vE '^(docs/|\.claude/|\.agents/)|^[A-Za-z]+\.md$'
```
````

## 13. `AGENTS.md` — Definition of Done › Tier 2 and Tier 3 out of blockquotes

**Criterion:** 4 (restated: Tier 3's "CI pays it, not run locally" is CLAUDE.md rules 1 and 4). Every command, the contracts exception, "record the subset" and the stacked-PRs pointer kept.

**Was:**

````markdown
**Tier 2 — code, mid-branch.** Any change that is not Tier 1, before the branch
is ready.

> Run the `minimal-check-subset` skill's output **and nothing more** —
> typically `pnpm --filter <pkg> typecheck`, that package's lint, and the
> specific test files covering what you touched. "Narrowest sufficient" is not
> "smallest": for `packages/contracts/src` the consumers span packages, so
> the subset is `pnpm typecheck` across every package; CI runs the full suite.
> Record the subset in the PR body.

**Tier 3 — final review.** The branch is finished and its PR is ready (a
milestone part opens ready; `build-a-part`).

> This is the single full-suite run a branch pays for: `pnpm check`, plus
> `pnpm --filter web test:e2e:ci-like` if a user flow changed, and
> `pnpm seed:verify` if a contract field or fixture changed. **CI pays it, on
> the PR; it is not run locally.** A ready PR is when `ci.yml` starts paying
> attention, so read its run on the real head. A milestone part pays it on its
> own PR to `main`; any other stack pays it once, on the top part
> (`docs/guidelines/stacked-prs.md` §5).
````

**Now:**

````markdown
**Tier 2 — code, mid-branch:** the `minimal-check-subset` skill's output **and
nothing more** — typically the package's typecheck, its lint and the test files
covering what you touched. For `packages/contracts/src` the consumers span
packages, so the subset is `pnpm typecheck` across every package. Record the
subset in the PR body.

**Tier 3 — final review**, the PR ready (a milestone part opens ready;
`build-a-part`): `pnpm check`, plus `pnpm --filter web test:e2e:ci-like` if a
user flow changed and `pnpm seed:verify` if a contract field or fixture did.
**CI pays it on the PR**; read its run on the real head. A milestone part pays
it on its own PR; any other stack once, on the top part
(`docs/guidelines/stacked-prs.md` §5).
````

## 14. `AGENTS.md` — Waiting on PR checks › the M42 wake-cost story

**Criterion:** 3 (incident narrative past one sentence; "$57, 141 of 190 for nothing" kept, as the KI asked).

**Was:**

````markdown
re-arm. Stop re-arming when nothing is open. A wake re-reads the whole context:
M42's 190 GitHub wakes cost $57, 141 of them for nothing
(`docs/retros/2026-10-12-m42-token-spend-retro.md`). A check-in batches them.
````

**Now:**

````markdown
re-arm. Stop re-arming when nothing is open. M42's 190 GitHub wakes cost $57,
141 of them for nothing (`docs/retros/2026-10-12-m42-token-spend-retro.md`).
````

## 15. `AGENTS.md` — Do not watch what cannot run › shortened to the rule

**Criterion:** 4 (restated: Tier 1 above and the draft rule in Workstreams say why no checks run).

**Was:**

````markdown
`--watch` is right only **when checks will exist**. They will not on a
**Tier 1 PR** (the *whole PR* prose; only `ci-ok` reports) or on
a **draft PR**, where `ci.yml`'s `if:` guards skip everything until it is
marked ready (`github-rest`). If no run exists for your HEAD and none should,
that is the finished state: say so and move on.
````

**Now:**

````markdown
`--watch` only **when checks will exist**: not on a Tier 1 PR (only `ci-ok`)
or a draft (`ci.yml` skips until ready). No run for your HEAD, when none
should exist, is the finished state: say so and move on.
````

## 16. `AGENTS.md` — Testing model › rules CLAUDE.md and testing.md already carry

**Criterion:** 4 (restated: red-first is CLAUDE.md rule 3 and `testing.md` §3, the e2e verdict rule 1, the known-issues grep rule 2; the presentation and no-sleep enforcement detail is `testing.md` §4; the witness floor is `testing.md` §3). Each rule keeps a line here.

**Was:**

````markdown
- **Red first: a test is not done until it has been seen to fail** (CLAUDE.md
  rule 3 carries the procedure and the 2026-09-02 incident). Put the source edit
  and the real failure text in the PR. `witness` does it mechanically for
  property tests; for everything else it is manual and there is no substitute.
- **Test count is a cost, not a score.** A PR that adds tests without covering a
  *new* failure mode made the suite slower and nothing else.
- **Prove it at one layer.** Name the layer that owns each claim and do not
  re-prove it above. The same rule proven four times costs four maintenance
  sites and catches one bug.
- **Never assert presentation.** Classes, tag names, DOM structure and prose
  copy are not contracts — roles, labels, values and behaviour are. Enforced:
  `toHaveClass` outside `src/components/ui/**` fails lint, as does reaching past
  the query layer into nodes.
- **No test may sleep** (`playwright/no-wait-for-timeout` plus `no-restricted-properties` on `waitForTimeout`, which catches pages not named `page`; both fixtured in `scripts/check-lint-wall.mjs`), and **data comes from
  `@tc/factories`**, never a hand-built rollup
````

**Now:**

````markdown
- **CLAUDE.md rules 1–3 bind every test:** red first, with the source edit and
  failure text in the PR; an e2e verdict only from `ci-like`; grep
  `docs/known-issues/` before calling a failure environmental.
- **Test count is a cost, not a score**, and **prove it at one layer**: name the
  layer that owns each claim and do not re-prove it above.
- **Never assert presentation** — roles, labels, values and behaviour are
  contracts; classes, tags, DOM structure and copy are not (lint-enforced,
  `testing.md` §4).
- **No test may sleep** (lint-enforced), and **data comes from
  `@tc/factories`**, never a hand-built rollup
````

## 17. `AGENTS.md` — Testing model › the witness bullet's floor procedure

**Criterion:** 4 (restated: `testing.md` §3 carries "measure the floor, never guess it" and the half-the-minimum rule).

**Was:**

````markdown
- **Property tests carry a `witness`.** A property that skips every generated
  case still reports ✓. Count the assertions and assert a floor (`witness.ts`,
  duplicated per package). **Measure the floor, don't guess it** — set it near
  half the observed minimum: a probe once passed 400 runs asserting **zero** times.
````

**Now:**

````markdown
- **Property tests carry a `witness`** with a measured floor (`testing.md` §3):
  a probe once passed 400 runs asserting **zero** times.
````

## 18. `AGENTS.md` — Testing model › the e2e verdict and known-issues grep bullets

**Criterion:** 4 (restated: CLAUDE.md rules 1 and 2, now cited in the Testing model's first bullet).

**Was:**

````markdown
- **E2E** (Playwright): one happy-path script per milestone, kept green forever
  after its gate. A verdict comes only from `pnpm --filter web test:e2e:ci-like`
  (CLAUDE.md rule 1).
- **Grep `docs/known-issues/` before calling any failure environmental, flaky
  or infra** (CLAUDE.md rule 2) — those conclusions end the investigation.
````

**Now:**

````markdown
- **E2E** (Playwright): one happy-path script per milestone, kept green forever
  after its gate.
````
