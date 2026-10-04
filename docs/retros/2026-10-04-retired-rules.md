# Retired rules — 2026-10-04

A retirement pass under `docs/guidelines/retiring-a-rule.md`, run at M19's gate close because `AGENTS.md` was at 86% of its budget (step 7 of the checklist). Text moved verbatim; to reverse one, put it back and name the incident in the commit.

## 1. `AGENTS.md` — criterion 3 — Admin exemption: incident narrative shortened to the rule, the reason and the fixture count

**Was:**

````markdown
The exempt shell is `src/server/**`, `src/app/api/**`,
`src/app/.well-known/**/route.ts` — and, since 2026-09-14,
**`src/app/admin/**`**, which may import `src/server` internals but still may
not reach `packages/domain` or build an Auth.js instance. It is the one route
group whose page must know something only the server knows *before it renders*:
M20's gate box requires a non-admin to get a 404 for the **route**, not merely
for the endpoint, and `users.is_admin` is a database column the edge proxy
cannot read under JWT sessions (ADR-025). Because the wall restricts the
*importer*, no relocation satisfies that — the alternative was the console
fetching its own API over HTTP and forwarding the operator's session cookie to
it, which kept the wall's letter (UI calls the API) while inverting its reason
(UI runs in a browser; a server component does not), and produced two defects in
two days. `scripts/check-lint-wall.mjs` lints three fixtures under
`src/app/admin` — one per pattern, one open and two shut — so the exemption is
proven to be exactly one hole.
````

**Now:**

````markdown
The exempt shell is `src/server/**`, `src/app/api/**`,
`src/app/.well-known/**/route.ts` — and, since 2026-09-14,
**`src/app/admin/**`**, which may import `src/server` internals but still may
not reach `packages/domain` or build an Auth.js instance. M20's gate needs a
non-admin to get a 404 for the **route**, and `users.is_admin` is a database column
the edge proxy cannot read under JWT sessions (ADR-025); the console fetching its
own API over HTTP produced two defects in two days. `scripts/check-lint-wall.mjs`
lints three fixtures under `src/app/admin`, so the exemption is exactly one hole.
````

## 2. `AGENTS.md` — criterion 3 — Sitemap exemption: reasoning shortened

**Was:**

````markdown
Since 2026-10-02 the shell also holds **`src/app/sitemap.ts` and
`src/app/robots.ts`** (SEO pass, D2). The sitemap lists every published day,
which only the database knows, and a self-fetch to the public API would put a
rate limit and a timeout in a file a crawler reads. Same terms as the console:
`src/server` internals yes, `packages/domain` and an Auth.js instance no.
`scripts/check-lint-wall.mjs` holds it to those two files with five fixtures.
````

**Now:**

````markdown
Since 2026-10-02 the shell also holds **`src/app/sitemap.ts` and
`src/app/robots.ts`** (SEO pass, D2): the sitemap lists every published day,
which only the database knows. Console terms; five fixtures in
`scripts/check-lint-wall.mjs`.
````

## 3. `AGENTS.md` — criterion 3 — State digest: feature list and rationale shortened; citation kept

**Was:**

````markdown
**State digest** (`pnpm state`, `scripts/state-digest.mjs`): the "where are we"
answer, extracted rather than summarized — current milestone and its exit-gate
tally, the first unchecked TODO, STATUS.md's leading block, open PRs, a
worktree count, and an open-KI count with the newest few. Every line carries a
`file:line` citation, so a session that needs the detail opens one file at one
offset instead of `cat`-ing 50KB of it. The `SessionStart` hook prints it on
both branches, so it has usually already run before you start; `/roadmap` calls
it for its Steps 1 and 3, then spends its turn on the judgement the script
refuses to make. It defers twice on purpose: a worktree count rather than an
audit (that is `worktree-hygiene`), and a named mismatch rather than a verdict
when the status sources disagree (that is `/roadmap`). Why it is a script and
not one more thing to invoke: `docs/reviews/2026-09-02-session-tooling-review.md`
(R1, findings F1/F2/F8) measured 2,621 orientation re-reads across 220 sessions,
~1.9M tokens, against 9 sessions that thought to run `/roadmap`.
````

**Now:**

````markdown
**State digest** (`pnpm state`, `scripts/state-digest.mjs`): the "where are we"
answer, extracted rather than summarized — current milestone and gate tally, the
first unchecked TODO, STATUS.md's leading block, open PRs, a worktree count and
the newest open KIs, each with a `file:line` citation. The `SessionStart` hook
prints it, so it has usually run before you start; `/roadmap` spends its turn on
the judgement the script refuses to make. Why it is a script:
`docs/reviews/2026-09-02-session-tooling-review.md` (R1) measured 2,621
orientation re-reads across 220 sessions against 9 that ran `/roadmap`.
````

## 4. `AGENTS.md` — criterion 3 — Draft-PR guard and Tier-3 stamp: incident narrative past one sentence

**Was:**

````markdown
**Draft-PR guard** (`scripts/hooks/draft-pr-guard.mjs`, `PreToolUse` on
`gh *`): asks before `gh pr create` without `--draft`, and before
`gh pr ready` when no **Tier-3 stamp** covers HEAD. The rule it enforces was
already in this file and was followed on **4 of 15 branches** over
2026-09-15..20; PR #196, opened ready, spent **41 CI runs and 8 failures
across 15 hours**, its first run failing three seconds in on `test:int` — a
lane that runs locally in ~70s. It **asks**, never denies: a prose fix, a
revert or a PR wanted right now are legitimate, and a guard that cannot be
overridden gets worked around.

**The Tier-3 stamp** (`pnpm check` records it; `pnpm tier3 verify` reads it):
`.git/tc-tier3.json`, holding the commit checked, whether the tree was dirty,
and **which lanes were live at the time**. That last part is the cloud-shaped
half: `pnpm check` ends in `test:int:if-db`, which skips silently with no
database and says so itself — *"A green `pnpm check` here is NOT a green
CI."* A stamp that said only "passed" would assert the thing that was not
verified, so the guard names the uncovered lanes and lets you record them on
the PR's *"Not run, and why"* line.
````

**Now:**

````markdown
**Draft-PR guard** (`scripts/hooks/draft-pr-guard.mjs`, `PreToolUse` on
`gh *`): asks before `gh pr create` without `--draft`, and before
`gh pr ready` when no **Tier-3 stamp** covers HEAD. The rule was followed on
**4 of 15 branches**; PR #196, opened ready, spent **41 CI runs and 8 failures**.
It **asks**, never denies.

**The Tier-3 stamp** (`pnpm check` records it; `pnpm tier3 verify` reads it):
`.git/tc-tier3.json` holds the commit checked and **which lanes were live**.
`pnpm check` ends in `test:int:if-db`, which skips silently with no database —
*"A green `pnpm check` here is NOT a green CI."* The guard names the uncovered
lanes; record them on the PR's *"Not run, and why"* line.
````

## 5. `AGENTS.md` — criterion 4 — Restated: CLAUDE.md rule 4 carries the same rule and the #103/#141 measurements

**Was:**

````markdown
> **The "whole branch" is load-bearing, and was got wrong once — here, while
> writing this.** `ci.yml`'s `changes` job judges the **entire PR diff against
> base**, never the push that triggered the run (as the `paths-ignore` it
> replaced on 2026-10-04 did). So a docs-only commit pushed onto a PR that already
> contains code re-runs the full suite, every time. Verified on PR #103:
> a commit touching seven prose files ran `static-and-unit` **and**
> `integration-e2e` to completion.
>
> Practical consequence: once a branch has any code in it, it is Tier 2 for
> the rest of its life, however prose-only the next commit looks. Tier 1 is a
> property of the branch, not of the change in front of you.
````

**Now:**

````markdown
> **Tier 1 is a property of the whole branch** (CLAUDE.md rule 4): `ci.yml`'s
> `changes` job judges the entire PR diff, so a docs commit on a branch that
> already has code re-runs the full suite (PR #103).
````

## 6. `AGENTS.md` — criterion 3 — CodeRabbit rationale shortened to one paragraph; KI citation kept

**Was:**

````markdown
Why, in one line each. Auto-review is **off** for this repo (public, 0 stars,
below CodeRabbit's 10-star OSS gate), it posts a **green status while
skipping** so `--fail-fast` exits 0 on a PR it never read, a review takes
**~21 minutes**, and **any push during that window aborts it** — so an agent
that triggers mid-work reliably gets nothing. The full evidence, including the
two status descriptions that differ only in wording, is `KI-2026-09-01`.
````

**Now:**

````markdown
Why: auto-review is **off** for this repo (below CodeRabbit's 10-star OSS gate),
it posts a **green status while skipping**, a review takes **~21 minutes**, and
**any push during that window aborts it**. Evidence: `KI-2026-09-01`.
````
