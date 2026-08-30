### KI-91 — `next dev` leaves three files in the working tree that are not ours and are not ignored — RESOLVED
- **Severity:** cleanup (no product impact; it puts unrelated files in front of every `git add` on a branch where someone ran the dev server)
- **Area:** `.gitignore`, `apps/web/next-env.d.ts`
- **What happens:** starting `pnpm --filter web dev` (Next 16, Turbopack) writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — vendor "agent rules" files from the `next` package, untracked and unignored — and rewrites the tracked `apps/web/next-env.d.ts` to point at `./.next/dev/types/...` where the committed version points at `./.next/types/...`. `next build` points it back. So `git status` on any branch is dirty in three places after a browser check, and the two `.md` files sit directly beside a real `AGENTS.md`/`CLAUDE.md` convention this repo uses for its own instructions — which is exactly the pair a hurried `git add apps/web` would sweep in.
- **Why it matters more here than it looks:** this repo's operating manual IS `AGENTS.md`, and a vendor file with the same name one directory down is a genuine trap for a future session reading either.
- **Fix path:** ignore all three (`apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and — if the dev/build flip is unavoidable — decide which spelling of `next-env.d.ts` is committed and ignore the other). Next's own docs cover suppressing the agent-rules files; that is worth checking before ignoring them, since not writing them at all is better than ignoring them.
- **Found by:** the M11-fallout KI cluster, 2026-08-29, doing KI-64's browser verification. The three files were kept out of that PR by hand.
- **First noted:** 2026-08-29.

- **Resolution (2026-08-30):** two of the three files are now never written; the
  third is a decision, not a removal.
  - **`apps/web/AGENTS.md` + `apps/web/CLAUDE.md` — eliminated at the source.**
    Next's own docs do cover this, as the entry suspected:
    `node_modules/next/dist/docs/01-app/02-guides/ai-agents.md` ("Opting out")
    documents a top-level `agentRules` config option, and it is a real schema
    key (`agentRules: z.boolean().optional()` in `next/dist/server/config-schema.js`,
    consumed at `next/dist/server/lib/start-server.js`: `if (initResult.agentRules !== false)`).
    Set `agentRules: false` in `apps/web/next.config.ts`. The files are not
    ignored, they are not generated at all — which the entry asked for, since an
    ignore rule would still leave a vendor `AGENTS.md` on disk one directory
    below the real one.
  - **`apps/web/next-env.d.ts` — the dev/build flip is unavoidable, and the
    committed spelling stays `./.next/types/...` (the `next build` spelling).**
    Not configurable: `next/dist/server/config.js` does
    `if (phase === PHASE_DEVELOPMENT_SERVER) result.distDir = join(result.distDir, 'dev')`
    unconditionally, and `writeAppTypeDeclarations` derives the import path from
    that `distDir` with no gate. The build spelling is the right one to commit
    because `next build` is what runs unattended (CI's `integration-e2e` job and
    every Vercel deploy) where nobody sees or cleans a dirtied tree, and because
    `apps/web/tsconfig.json`'s `include` already lists `.next/types/**/*.ts`,
    not `.next/dev/types`. **Deliberately not gitignored:** `.gitignore` has no
    effect on a tracked file, so ignoring it would mean
    `git rm --cached apps/web/next-env.d.ts`, and CI's quality job runs
    `pnpm typecheck` straight after `pnpm install` with **no build before it**
    (`.github/workflows/ci.yml`) — so on a fresh clone that file would simply be
    absent for the repo's main type gate. Measured: `tsc --noEmit` does still
    pass with the file deleted and no `.next/` present, but only because nothing
    in `apps/web` currently uses a *binding* import that needs the ambient
    declarations `/// <reference types="next" />` pulls in (CSS modules, static
    images); the first such import would break typecheck on a clean checkout in
    a way that looks nothing like its cause. Keeping it tracked trades one
    revertible modified file for not planting that trap.
- **Proven:** before — `pnpm --filter web dev` + one request to `/` gave
  `?? apps/web/AGENTS.md`, `?? apps/web/CLAUDE.md`, ` M apps/web/next-env.d.ts`
  (dev spelling `./.next/dev/types/...`). After `agentRules: false`, the same
  dev-server run leaves **no** `apps/web/AGENTS.md` or `apps/web/CLAUDE.md` at
  all (`ls` reports both absent), and `pnpm --filter web build` from the
  dev-flipped state rewrote `next-env.d.ts` back to the committed
  `./.next/types/...` spelling, leaving it unmodified in `git status` —
  confirming the committed spelling is the build spelling. Checks:
  `pnpm --filter web typecheck` (clean, `tsconfig.tsbuildinfo` deleted first so
  it was not an incremental no-op), `pnpm --filter web lint`, and
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts next.config.test.ts`
  (33 passed) — the unit test that asserts this config file's shape. Not run:
  full `pnpm check`, `test:int`, e2e (concurrent agents held the integration lane).
- **Regression test:** none added. The bug class does not admit one — it is
  about what a `next dev` subprocess writes into the working tree, which no
  in-process unit test observes; asserting `agentRules === false` in
  `next.config.test.ts` would only restate the line rather than detect the
  files coming back. The tripwire is `git status` after a dev run, which is how
  it was found.

- **Numbering:** filed as 78 on 2026-08-29, when several sibling branches each filed a different KI-77/78 the same night. Renumbered to 91 on merge. Nothing outside this file references it.
