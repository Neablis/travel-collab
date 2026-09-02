### KI-2026-09-02-a — Node 26 makes `window.localStorage` undefined in the jsdom unit lane, so the local unit suite is red on a tree CI passes
- **Severity:** reliability of local verification (no product impact, and no CI impact — but it is the exact shape of failure `CLAUDE.md` rule 2 exists to stop being called "flaky")
- **Area:** `apps/web/vitest.unit.config.ts` and `apps/web/vitest.setup.ts` (the jsdom environment), `package.json`'s `engines.node`, `.github/workflows/ci.yml` (`node-version: 22`), and the absence of any version pin file (`.nvmrc`, `.tool-versions`, `volta`).
- **Symptom (2026-09-02):** `pnpm --filter web exec vitest run -c vitest.unit.config.ts src/lib/pendingDemoClone.test.ts` fails 7/7 with

  ```
  TypeError: Cannot read properties of undefined (reading 'clear')
   ❯ src/lib/pendingDemoClone.test.ts:18:23
       17|   vi.unstubAllGlobals();
       18|   window.localStorage.clear();
  ```

  `apps/web/src/app/(app)/page.test.tsx` fails 6 of 27 the same way.
- **The cause is the Node version, and this was proven rather than inferred.** Same worktree, same `node_modules`, same command, only `PATH` changed:

  | Node | Result |
  |---|---|
  | v26.4.0 (this machine's default, `/opt/homebrew/opt/node@26`) | **7 failed** |
  | v22.23.2 (`~/.nvm/versions/node/v22.23.2`) | **7 passed** |

  So the tree is fine. `main` at `56a5cf5` is not broken, and neither is any branch — the local interpreter is simply newer than the one anything was tested against.
- **Why CI never sees it:** `.github/workflows/ci.yml` pins `node-version: 22` in both jobs. `ci` on `claude/test-quality-walls` was green at 07:34 on 2026-09-02 with these same files. Vercel builds on **24.x**. So three Node versions are in play — CI 22, Vercel 24, this laptop 26 — and `package.json`'s `engines` says only `>=22.18.0`, which permits every one of them.
- **Why this is worse than a broken test.** It is a false red, in the lane the tiered Definition of Done sends every Tier 2 change to. An agent running the narrow subset for an unrelated change sees failures that have nothing to do with it, and the two available readings are both wrong: "I broke it" (it will chase a phantom) or "flaky, ignore" (which is the habit KI-1 cost two weeks to learn out of). Nothing on the machine says "your Node is not the project's Node".
- **Mechanism, as far as it was traced:** Vitest 4's jsdom environment populates the test global from a fixed key allowlist that carries the `Storage` *constructor* but not the `localStorage`/`sessionStorage` *instances*; jsdom 29.1.1 itself provides them correctly when constructed directly. Under Node 22 the instances arrive anyway. The exact interaction with Node 26 was not isolated further, because the fix does not depend on it.
- **Fix path — two halves, and the second is the one that lasts.**
  1. **Pin the version so the divergence cannot recur silently.** A committed `.nvmrc` (or `.tool-versions`) reading 22, plus narrowing `engines.node` from `>=22.18.0` to the range actually tested. This is the real fix: today it is `localStorage`, and the next Node major will be something else. Worth deciding at the same time whether the pin should be **22** (what CI runs) or **24** (what Vercel builds on) — those are two different answers and the repo currently claims neither. Vercel's runtime is the one production actually uses.
  2. **A shim in `vitest.setup.ts`** that installs `localStorage`/`sessionStorage` when the environment did not, which makes the lane portable across Node majors rather than correct on exactly one. Cheap, and it is `vitest.setup.ts` — one of the twelve root files KI-2026-08-30-b points out are not even linted.
- **Why not fixed here:** found by the test-value pass on 2026-09-02, which was scoped to test files only; `vitest.setup.ts`, `package.json` and a new `.nvmrc` are all outside that scope, and half of the fix is a version choice (22 vs 24) that is Mitchell's, not an agent's.
- **Cross-reference:** KI-13 (the other reason a local unit run lies — parallel load, a *different* random subset each time; this one fails in the same place every run, which is how the two are told apart), KI-2026-08-30-b (`vitest.setup.ts` is one of the unlinted root files), `CLAUDE.md` rule 2, `AGENTS.md` "Verification scales to the change".
- **First noted:** 2026-09-02, during the late-night cleanup session.
