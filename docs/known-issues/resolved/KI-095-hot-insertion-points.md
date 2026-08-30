### KI-95 — `docs/known-issues.md` has two hot insertion points, so every pair of parallel branches conflicts and the cost is quadratic — RESOLVED, by taking both recorded fixes
- **Severity:** cleanup (no user impact) — but it is the most expensive process defect measured so far, and `/ki-sweep` is built to trigger it
- **Area:** `docs/known-issues.md` itself, `.claude/commands/ki-sweep.md`, `.claude/agents/ki-fixer.md` (its contract requires each unit to move its own entry to Resolved)
- **What happens:** every agent writes to the same two anchors — the top of `## Open` for a new entry, the top of `## Resolved` for a fixed one. Git cannot merge two inserts at one anchor, so **any two branches that file or resolve an issue conflict, always**, even when their entries are about entirely unrelated code. Worse, resolving the conflict on one branch does not help the others: each merge to `main` moves both anchors again, invalidating every remaining branch's resolution.
- **Measured on the 2026-08-29 sweep (PRs #82-#86), not estimated:** four cluster branches, each semantically an independent append. Landing them took **10 conflict resolutions (4+3+2+1) and 4 extra CI cycles**. Zero of those conflicts were about overlapping subject matter; every one was two inserts at the same anchor. The same run also produced a **five-way collision on the number KI-77** — five branches independently allocated it the same night, plus a two-way on KI-78 — because a sequential id needs an allocator and parallel agents have none.
- **The tooling manufactures it.** `/ki-sweep` exists to fan out N agents over independent issues; `ki-fixer`'s contract then requires each of them to edit this one file in the same two places. The more the parallel workflow is used as designed, the more the cost grows — as N², not N.
- **File pressure, for scale:** 2,209 lines, 94 entries, **78 commits in the 30 days to 2026-08-30** (~2.6/day). This is the most frequently written document in the repo.
- **Two fixes, deliberately not taken here** (Mitchell's call, 2026-08-30 — recorded rather than actioned):
  1. **Workflow, free and structural-change-free:** merge a sweep's branches into one integration branch, resolve once, run CI once, merge once. O(N) instead of O(N²). On the 2026-08-29 sweep that is 1 resolution and 1 CI cycle instead of 10 and 4.
  2. **Structural:** one file per issue (`docs/known-issues/KI-095-....md`), with Open/Resolved as frontmatter or a directory, plus a generated index. Two agents filing entries then create two *different files*, which git merges with no conflict at all. This is the standard remedy for the standard problem — towncrier's news fragments and changesets both exist for exactly this. Pair it with a non-sequential id (`KI-<date>-<slug>`, or PR-derived) so no allocator is needed and the KI-77 collision cannot recur.
- **Migration cost was checked rather than assumed:** **nothing parses this file.** `.claude/protocol/adapter.json:17` names it as a protected filename and `apps/web/src/server/ai/writeTools.ts:101` mentions it in a prose comment; the other ~49 references are prose pointers in markdown. All mechanical. `CLAUDE.md`'s rule 2 ("grep `docs/known-issues.md` for the symptom") survives verbatim, since `grep -r docs/known-issues/` is equivalent.
- **What it cost while it was open:** every parallel sweep pays the quadratic tax again, and every one risks another number collision. It does not corrupt anything and it is always resolvable — it is purely wasted time, which is why it is filed as cleanup rather than reliability.
- **First noted:** 2026-08-30, landing the 2026-08-29 sweep's four remaining PRs.

- **RESOLVED 2026-08-30, by taking both fixes above rather than choosing between them.**

  **Fix 2 (structural) — the substance.** `docs/known-issues.md` is now
  `docs/known-issues/`, one file per entry, with **status carried by the
  directory**: `open/`, `resolved/`, `dormant/`, plus a `README.md` holding the
  old preamble, the severity vocabulary, the id scheme, and the file/resolve
  procedures. All 99 entries were migrated **by script**, split on `^### `
  headings and written verbatim; a hand-migration of 99 entries was ruled out as
  unverifiable. Counts match the source exactly — 39 `open/`, 59 `resolved/`,
  1 `dormant/` = 99, against 99 `### ` headings in the original. Content
  preservation was proven rather than asserted: each generated file was compared
  byte-for-byte with its source block — **`99 entry bodies compared, 0
  mismatches`**, and the 99 headings are identical as a multiset. The only
  difference between the old file and the concatenation of the new ones is the
  *inter-entry* blank-line runs, which the source had inconsistently as 0, 1 or 2
  and the split normalises to 1. Nothing inside an entry changed.

  **There is deliberately no committed index file, and none should be added.**
  A generated index would be a single file every branch has to append to — this
  same defect, moved one level up. `ls docs/known-issues/open/` is the index.

  **Ids.** Existing entries keep their number, zero-padded (`KI-095-…`), because
  ~14 source-code comments and dozens of docs reference them. New entries use a
  **date-based id needing no allocator** — `KI-20260831-slug.md`, heading
  `### KI-2026-08-31 — …`. That is what makes the five-way KI-77 collision
  structurally impossible to recur, not merely less likely.

  **Fix 1 (workflow) — the smaller half.** `/ki-sweep` step 6 now splits into
  6a (one PR per KI, still the default) and 6b, an explicit **integration
  branch**: merge the sweep's branches into one branch, resolve once, run CI
  once, merge once. Step 6 states plainly that with the per-file structure in
  place 6b is a **cost optimisation** — one review and one CI cycle against the
  2,000-minute Free-plan budget `AGENTS.md` flags — and no longer a conflict
  remedy, because the conflicts are gone. `ki-fixer` step 5 is now `git mv` plus
  an edit inside the moved file.

- **Proof — the same experiment run before and after, on throwaway branches.**

  **Before (the defect).** Two branches off one HEAD, each appending one new
  entry at the top of `## Open`, exactly as two parallel `ki-fixer` agents
  would:

  ```
  $ git merge ki95-before-a
  Auto-merging docs/known-issues.md
  CONFLICT (content): Merge conflict in docs/known-issues.md
  Automatic merge failed; fix conflicts and then commit the result.
  ```

  The conflict is two inserts at one anchor, about nothing in common:

  ```
  ## Open

  <<<<<<< HEAD
  ### KI-20260830-bravo — branch B files a different unrelated entry
  =======
  ### KI-20260830-alpha — branch A files an unrelated entry
  >>>>>>> ki95-before-a
  ```

  The **resolve path** is worse, and reproduced the same way — two branches each
  moving a *different* entry (KI-91, KI-89) to `## Resolved` produced **two**
  conflicts in one merge, one at each hot anchor: the deletion site in `## Open`
  and the insertion site in `## Resolved`.

  ```
  $ grep -n "^<<<<<<<\|^>>>>>>>" docs/known-issues.md
  103:<<<<<<< HEAD
  127:>>>>>>> ki95-before-c
  796:<<<<<<< HEAD
  820:>>>>>>> ki95-before-c
  ```

  **After (the identical experiments against the new structure).** Filing:

  ```
  $ git merge ki95-after-a
  Merge made by the 'ort' strategy.
   docs/known-issues/open/KI-20260830-alpha-branch-a-files-an-entry.md | 3 +++
   1 file changed, 3 insertions(+)
  MERGE EXIT=0
  ```

  Resolving — two branches, two different entries, `git mv` plus an in-file
  heading edit on each:

  ```
  $ git merge ki95-after-c
  Merge made by the 'ort' strategy.
   .../{open => resolved}/KI-091-next-dev-leaves-three-files-working.md | 2 +-
   1 file changed, 1 insertion(+), 1 deletion(-)
   rename docs/known-issues/{open => resolved}/KI-091-...md (97%)
  MERGE EXIT=0
  ```

  Both entries land in `resolved/`, neither remains in `open/`, and git tracked
  each move as a rename. Zero conflicts where the same experiment previously
  produced three.

- **Why it cannot come back.** Not "is less likely to" — the two mechanisms that
  caused it are absent by construction. (1) **No shared insertion point:** filing
  creates a brand-new path, and resolving is a rename plus an edit *inside the
  renamed file*, so no two branches ever write the same bytes; the cost of N
  parallel fixers is O(N), not O(N²). (2) **No allocator:** a date-based id is
  derivable independently by every agent, so two agents cannot race for the same
  number. Re-creating the defect would require adding a committed index file,
  which `docs/known-issues/README.md` and `ki-fixer`'s step 5 both forbid in
  terms, with this entry as the reason.

- **Checks run.** `node --test scripts/hooks/__tests__/protocol-portability.test.mjs`
  — 3/3 pass, after changing `adapter.json`'s `portabilityForbiddenTokens` entry
  from `"known-issues.md"` to `"known-issues"`. The guard was also verified to be
  **still effective** rather than merely green: planting
  `docs/known-issues/open/…` in `CONTRACT.md` fails it with
  `.claude/protocol/CONTRACT.md mentions "known-issues" — repo-specific facts
  belong in ADAPTER.md`, which the old token would no longer have caught.
  Per `minimal-check-subset`, no file under `packages/contracts/src` changed, so:
  `pnpm --filter web typecheck` clean, `pnpm --filter web lint` clean,
  `pnpm --filter @tc/domain typecheck` clean, `pnpm --filter @tc/domain test`
  221/221, and the four touched web unit files 83 passed / 1 skipped. The full
  `pnpm check` was deliberately left to the main session, run once and serially.

- **Deliberately not repointed:** `docs/retros/`, `docs/milestones/`,
  `docs/plans/`, `docs/reviews/`, `docs/design-feedback/`, `docs/architecture/`
  and `docs/testing-*.md` still name `docs/known-issues.md`. They are historical
  records of what was true when written; rewriting them would falsify them. The
  README's "this used to be `docs/known-issues.md`" note puts any old pointer one
  hop from the answer.
