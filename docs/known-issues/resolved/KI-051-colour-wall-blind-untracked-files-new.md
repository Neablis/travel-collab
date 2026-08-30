### KI-51 — The colour wall is blind to untracked files, so a new file is unguarded until it is staged — RESOLVED
- **Severity:** cleanup (no user impact; a hole in a CI gate, not a defect in shipped code)
- **Area:** `scripts/check-color-wall.mjs`.
- **Symptom (2026-08-27, landing-page design pass):** the script enumerates the
  files it scans with `git ls-files`, so a brand-new file that has never been
  staged is not in the list. It is not skipped with a warning — it is invisible,
  and the script prints `color wall OK` with a file count that silently excludes
  it. Reproduced directly: with the two new landing components untracked the run
  reported `309 files scanned`; `git add`ing them took the same run to
  `313 files scanned`.
- **Why it matters more than the file count suggests:** the wall is blind to
  exactly the files most likely to violate it. A raw hex or a `[13px]` bracket
  value is far likelier in freshly written UI than in a file that has already
  been through review, and an agent or contributor who runs the gate before
  staging gets a clean pass that means nothing. Three separate agents on this
  pass each hit it and each hand-checked their own files with the script's own
  regexes to compensate.
- **Not what it looks like:** this is not the pre-M5 `design-wall-pending.json`
  exemption list, which is a deliberate, shrinking allowlist. This is an
  unintended gap in enumeration.
- **Candidate fixes (not chosen yet):** scan the working tree rather than the
  index; or add untracked-but-not-ignored files via
  `git ls-files --others --exclude-standard` alongside the tracked list. The
  second keeps `.gitignore` honoured, which walking the tree naively would not.
- **Workaround in use:** `git add -A` before running the wall, and read the file
  count — if it did not go up after adding new files, the run did not see them.
- **Same class:** `check-lint-wall.mjs` and `check-case-collisions.mjs` should be
  checked for the identical `git ls-files` assumption before this is called fixed.
- **Fix (2026-08-28):** `scripts/check-color-wall.mjs` now enumerates with
  `git ls-files --cached --others --exclude-standard <same pathspec>` — the
  second candidate fix listed above. One `git` invocation, not two, so the gate
  is no faster to skip and no slower to pass; `--exclude-standard` keeps
  `.gitignore` honoured (node_modules, `.next`, generated output stay out), and
  the result is de-duplicated and sorted so the stage-1/2/3 duplicates
  `--cached` emits for an unmerged path mid-conflict can't double-report.
- **Proof:** an untracked `apps/web/src/components/Ki51ScratchProbe.tsx`
  carrying `#ff00aa` and `p-[13px]` was invisible before the change — `color
  wall OK (356 files scanned, 0 pending re-skin)`, exit 0. After it, the same
  untracked file fails the gate on both regexes and exits 1. An *ignored* file
  with the same raw hex (untracked, matched by a `.gitignore`) is still
  correctly skipped. Clean tree before and after: `356 files scanned`, exit 0,
  ~0.08s — same count, same speed. Both probe files removed.
- **No regression test:** repo-root `scripts/*.mjs` are covered by no suite
  (`apps/web`'s vitest only includes `src/**/*.test.{ts,tsx}`), and standing up
  a root test project to hold one is well outside this entry's Area. The
  enumeration line carries a comment naming KI-51 instead, so dropping
  `--others` shows up in review.
- **Same class, still unchecked:** `check-lint-wall.mjs` and
  `check-case-collisions.mjs` were left alone — both still enumerate with plain
  `git ls-files` and have the identical gap. Filed as follow-up, not fixed here
  (one KI, one blast radius).
- **A second, deliberately distinct exclusion mechanism (2026-08-29):**
  `check-color-wall.mjs` now also carries `generatedNonProduct` — a separate
  `Set` for files that are not product UI at all (currently just Sentry's
  wizard-generated `sentry-example-page/page.tsx`, which shipped raw brand
  colors straight from the scaffold). It is intentionally **not** an addition
  to `pending` above: `pending` means legacy debt being paid down and only
  ever shrinks; `generatedNonProduct` means "third-party codegen, permanently
  out of scope," and neither list should be used for the other's purpose —
  putting scaffolding in `pending` would silently redefine it as "stuff we
  tolerate" instead of "debt we're closing." Covered by
  `scripts/__tests__/check-color-wall.test.mjs`, which also updates the "no
  regression test" note above for this one script — it now has one, run under
  root `pnpm test` via `node --test "scripts/**/__tests__/**/*.test.mjs"`
  (the pattern `check-sleep-wall.test.mjs` already used).
