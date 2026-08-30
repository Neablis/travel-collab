# Known issues & tech debt

Durable register of **known-but-unfixed** problems and deferred cleanups, so
findings survive past the PR / session ledger that first surfaced them. Add an
entry when you knowingly leave something unfixed; move it to `resolved/` (in the
fixing PR) when it's resolved. This is not the roadmap (`TODO.md`) and not a bug
tracker — it's the standing record of things we know about and have chosen not
to fix yet, with enough detail to act without re-deriving.

Severity: **correctness** (wrong behavior / failing invariant) ·
**reliability** (flaky / intermittent) · **cosmetic** (visual / copy) ·
**cleanup** (refactor / DRY, no user impact).

> **This used to be one file, `docs/known-issues.md`.** It was split into one
> file per entry on 2026-08-30 to close KI-95 — see
> `resolved/KI-095-hot-insertion-points.md` for the measurements that forced it.
> An old pointer to `docs/known-issues.md` is one hop from here, and
> `grep -r docs/known-issues/` finds everything the old `grep docs/known-issues.md`
> did.

## Status is the directory

```
docs/known-issues/
  README.md                 ← you are here
  open/                     ← known, unfixed
  resolved/                 ← fixed, downgraded, or re-scoped closed
  dormant/                  ← "Dormant by decision" — see below
```

`dormant/` holds features that still exist in the domain but have no UI reaching
them. Not bugs and not debt to pay down — deliberate holds, with a tripwire so
the decision resurfaces when keeping them actually costs something.

**There is deliberately no index file, and none should be added.** A committed
index — generated or hand-written — would be a single file every branch has to
append to, which is precisely the defect KI-95 measured, moved one level up.
`ls docs/known-issues/open/` **is** the index; `grep -rl` over the directory is
the search. Two agents filing entries in parallel create two *different* files,
which git merges with no conflict at all.

## Ids and filenames

`<id>-<short-kebab-slug>.md`, e.g. `KI-095-hot-insertion-points.md`,
`D-001-anchors-domain-kept-ui-retired.md`.

- **Existing entries keep their existing number**, zero-padded to three digits.
  Those numbers are referenced from source-code comments and from dozens of
  docs, milestones and retros; they must not change.
- **New entries use a date-based id that needs no allocator:**
  `KI-<YYYYMMDD>-<slug>.md` in the filename, with the heading written
  `### KI-YYYY-MM-DD — <one-line symptom>`. If two entries are filed on the same
  day, the slug already distinguishes them; if you genuinely collide on both,
  add a discriminator (`-b`).

  Sequential ids needed an allocator and parallel agents have none: on the
  2026-08-29 sweep, five branches independently allocated **KI-77** the same
  night, and two more collided on KI-78. A date needs no allocator, so that
  cannot recur.

## Filing an entry

Create **a new file** under `open/`. Never edit a file you did not create for
this purpose — that is what keeps parallel branches conflict-free. Carry the
fields the existing entries carry:

```markdown
### KI-2026-08-31 — <one line: what is wrong, in symptom terms>
- **Severity:** correctness | reliability | cosmetic | cleanup (+ why)
- **Area:** the files/modules a fixer should open first
- **Symptom / What happens:** the observable failure, not the diagnosis
- **Why not fixed here:** the constraint that deferred it — name the intended
  fix if you know it
- **Cross-reference:** sibling KIs, ADRs, milestones
- **First noted:** date and context
```

One defect, one entry. Two entries describing one defect drift apart the first
time either is edited, and a divergent duplicate is worse than none.

## Resolving an entry

Three steps, none of which touches any other entry's file:

1. `git mv docs/known-issues/open/KI-0XX-....md docs/known-issues/resolved/`
2. Append ` — RESOLVED` to the heading inside that file (or ` — DOWNGRADED`
   when the finding turned out to be harmless — see
   `resolved/KI-026-pnpm-build-warns-module-not-found.md`).
3. Add the **proof line**: what the fix was, and how it was proven — the
   reproduction that failed before and passes now, plus the check subset you
   ran. An entry closed without a proof line is not closed.

A rename plus an edit inside the renamed file conflicts with nothing another
branch is doing, so N parallel fixers cost O(N), not O(N²).

## Deferred design work (tracked elsewhere, pointer only)

Not bugs — design decisions awaiting a brainstorm, so they live with the
feedback that raised them, not here:

- **M5 PR #11 Group-4 comments** (Map-lens rework, Schedule nested toggle,
  Timeline time-of-day axis, header cost-vs-budget clarity, full-width
  perception): `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
