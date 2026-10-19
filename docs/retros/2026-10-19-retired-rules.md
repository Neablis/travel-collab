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
