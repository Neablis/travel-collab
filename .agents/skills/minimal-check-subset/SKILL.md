---
name: minimal-check-subset
description: Compute and run the narrowest typecheck/lint/test command that actually covers a given set of changed files in travel-collab, instead of defaulting to the full `pnpm check`. Use when verifying a small, scoped fix (e.g. one PR review comment) rather than a broad change.
---

# Minimal check subset

Goal: verify a small, scoped change with the narrowest command that actually
covers it, instead of always running the full `pnpm check` (`pnpm typecheck &&
pnpm lint && pnpm test` across every workspace package).

## Procedure

1. **Get the changed-file set.**
   - Branch/PR: `git diff --name-only <base>...HEAD`
   - Uncommitted local changes: `git status --short`

2. **Map each changed path to its owning workspace package** by path prefix:
   - `packages/contracts/**` → `@tc/contracts`
   - `packages/domain/**` → `@tc/domain`
   - `packages/factories/**` → `@tc/factories`
   - `packages/fixtures/**` → `@tc/fixtures`
   - `packages/pages/**` → `@tc/pages`
   - `packages/predict/**` → `@tc/predict`
   - `apps/web/**` → `web`
   - Anything else (root-level scripts, docs, etc.) implies no package-level
     check on its own.

3. **Hard exception — check this FIRST, before any narrowing.** If ANY
   changed file is under `packages/contracts/src`, do NOT narrow at all. Run
   the full `pnpm check` (or at minimum `pnpm typecheck` across every
   package). State explicitly that you're doing this because a contracts
   change was detected, citing `AGENTS.md` Invariant #5 ("Contracts change by
   protocol, not by drift") — `packages/contracts` schemas are depended on by
   both `packages/domain` and `apps/web`, and a change there can silently
   break either even though their own files didn't change.

4. **Otherwise, for each affected package, run only that package's own
   checks:**
   - Typecheck: `pnpm --filter <pkg> typecheck`
   - Lint: `pnpm --filter <pkg> lint` — only if that package actually defines
     a `lint` script. Verify via its `package.json`; today only `web` has
     one.
   - Tests — prefer scoping to the specific touched test files over the
     whole package suite:
     - Unit tests (`*.test.ts`/`*.test.tsx`, `vitest.unit.config.ts`):
       `pnpm --filter web exec vitest run -c vitest.unit.config.ts <file1> <file2>`

       **Do NOT use `pnpm --filter web test -- --run <file>`.** That form
       looks like it scopes and does not — pnpm swallows the `--`
       passthrough, vitest never receives the filenames, and it runs the
       **entire** suite while printing a command line that reads as
       narrowed. Measured on 2026-08-24, same single file, same worktree:

       | form | result |
       |---|---|
       | `pnpm --filter web test -- --run src/lib/dates.test.ts` | `Test Files 103 passed (103)` |
       | `pnpm --filter web exec vitest run -c vitest.unit.config.ts src/lib/dates.test.ts` | `Test Files 1 passed (1)` |

       This matters most in exactly the situation the skill exists for.
       Two agents in a five-way parallel KI-backlog run independently hit
       it; five "narrow" runs were five full 103-file suites contending on
       one machine, which is the load condition KI-13 is about.

       The `-c vitest.unit.config.ts` flag is required. `apps/web` has two
       configs, and the default (`vitest.config.ts`) sets
       `include: src/**/*.int.test.ts` — the integration suite. Omitting
       `-c` on a unit test file therefore matches nothing and exits 1 with
       `No test files found`. That failure is loud, not silent, so it
       cannot be mistaken for a pass — but it is why the flag is not
       optional.
     - Integration tests (`*.int.test.ts`), or any change integration tests
       exercise: run the full `pnpm --filter web test:int` instead. The
       integration suite shares one real Postgres instance and doesn't scope
       cleanly file-by-file — don't try to narrow further than "run the
       whole integration suite."
     - For non-web packages (`@tc/contracts`, `@tc/domain`, `@tc/factories`,
       `@tc/fixtures`, `@tc/pages`), there's no file-level scoping option —
       run `pnpm --filter <pkg> test` (whole package suite) if the package
       defines a `test` script. `@tc/predict` currently has none.

5. **Multiple packages affected (and none is contracts):** run each
   affected package's narrowed check separately. Do not escalate to the
   full workspace `pnpm check` just because more than one package changed.

6. **Always state the subset out loud:** which files changed, which
   package(s) they map to, and the exact command(s) run — so whoever reads
   the result can judge whether the narrowing was safe for this change. This
   skill trades completeness for speed; keep that tradeoff visible, never
   silent.
