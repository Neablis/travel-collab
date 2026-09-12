### KI-2026-09-07-b — the Playwright browser repair resolves through `apps/web/node_modules`, so on a fresh container it runs before `pnpm install` and links nothing — RESOLVED

- **Severity:** reliability of local verification (no product impact; CI is unaffected and remains the authoritative e2e signal). It costs a session one wrong conclusion — that the container has no usable browser — which `docs/guidelines/cloud-agent-sessions.md` already records two agents reaching.
- **Area:** `.claude/hooks/session-start.sh` — `link_playwright_shell`, specifically the `revs=$(node -e '…' "$PWD/apps/web")` manifest resolution and its `|| { …; return 0; }` fallback.
- **This is KI-32's fourth recurrence, and the first with a different cause.** KI-32's three previous recurrences were all about *which* revision directory to link (1228 missing entirely, the arm64/x64 path table, globbing only directories that already exist). Its second fix made the function ask Playwright which revision it wants rather than inferring it from disk, and that half **works** — run by hand in this session it correctly printed `required revisions: 1234`. The failure is not *what* it links. It is *when it runs*.
- **What is wrong:** the repair resolves `@playwright/test` → `playwright` → `playwright-core` → `browsers.json` with `paths: ["$PWD/apps/web"]`. That requires `apps/web/node_modules` to exist. On a fresh remote container the repository is cloned with no `node_modules`, and `SessionStart` fires **before** anything runs `pnpm install`. The resolution throws `MODULE_NOT_FOUND`, the function prints its warning to stderr and `return 0`s, and **no link is created**. The session then looks repaired — the hook ran and reported success overall — and the first `test:e2e:ci-like` of the session dies at `auth.setup.ts` on KI-32's verbatim symptom.
- **Observed, 2026-09-07, during the KI sweep:**

  ```
  Error: browserType.launch: Executable doesn't exist at
    /opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
  …
    1 failed
      [setup] › e2e/auth.setup.ts:17:1 › authenticate as alice
    102 did not run
  ```

  The image ships `chromium-1194`, `chromium-1228`, `chromium_headless_shell-1194`, `chromium_headless_shell-1228`. `@playwright/test` was bumped to `^1.62.1`, which wants **1234** — a revision the image has never had. Nothing linked it, because the hook could not read the manifest that names it.

- **The repair, once dependencies exist, is the function's own logic and it works:** link `chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` and `chromium-1234/chrome-linux64/chrome` at the newest real binary (`chromium-1228/chrome-linux64/chrome`, Chromium 141.0.7390.37). After that the full lane passed: **`pnpm --filter web test:e2e:ci-like` → 103 passed (4.1m), exit 0.**
- **Why the Playwright bump is not the cause.** A bump is the *trigger* and will keep being one; the entry KI-32 closed is supposed to survive it ("deliberately generic — so a Playwright bump does not silently reintroduce it"). It survives the bump and does not survive an empty `node_modules`. Both are ordinary states of a fresh container.
- **Fix path, in preference order:**
  1. **Make the repair re-runnable after install rather than only at session start** — the durable fix. A `PostToolUse`/`SessionStart` pairing, or having the hook re-invoke `link_playwright_shell` once `apps/web/node_modules` appears, so the ordering stops mattering.
  2. **Fall back to the newest revision on disk when the manifest cannot be read**, instead of `return 0`. Strictly better than linking nothing, and it is what a human does by hand every time this recurs.
  3. **Make the failure loud where someone will see it.** The warning already goes to stderr, but it is one line inside a long hook transcript and it did not stop this session from concluding "the browser is missing" first and reading KI-32 second.
- **What this does NOT change:** KI-32's standing caveat still applies to any local e2e result obtained this way — the suite ran on Chromium 141.0.7390.37, a build the pinned Playwright does not target. A green local run is corroboration; CI's is the authoritative signal, and `.github/workflows/ci.yml` installs its own matching build.
- **Cross-reference:** **KI-32** (resolved — the parent entry, whose three earlier recurrences are all a different cause from this one); `docs/guidelines/cloud-agent-sessions.md` (the browser note recording two agents concluding the container had no usable browser).
- **First noted:** 2026-09-07, during the `/ki-sweep` Tier 3 e2e run on `claude/ki-sweep-cphxh2`.
- **Fixed:** 2026-09-12. Took fix path #2 (with #1's intent folded in): `link_playwright_shell` now checks, right before the manifest resolution, whether `apps/web/node_modules` exists; if it does not, it runs `pnpm install` (guarded with `|| true`, so a failure there still falls through to the pre-existing warn-and-`return 0` path — the never-fail-the-session property is unchanged) before resolving. This makes the resolution's actual dependency — a `require.resolve`-able `@playwright/test` — unconditional rather than trusting every call site to run strictly after some other `pnpm install`, which is exactly the ordering this entry names. On the ordinary already-installed path this costs one `[ -d ]` stat.
  **Reproduced without simulation**, on a genuinely fresh worktree checkout that had no `node_modules` anywhere in it (confirmed: `ls apps/web/node_modules` / `ls node_modules` both `No such file or directory`, `CLAUDE_CODE_REMOTE=true`). Sourcing the hook's function definitions and calling `link_playwright_shell` directly against that state, before the fix:
  ```
  cannot resolve Playwright from apps/web: MODULE_NOT_FOUND
  session-start: could not read Playwright's browser manifest — e2e may fail on a missing executable (KI-32)
  FUNCTION_RETURN=0
  ```
  — i.e. the exact silent no-op this entry describes. After the fix, run again against the same still-fresh worktree (still no `node_modules` at the start of this second run):
  ```
  session-start: created and linked Playwright's expected chromium_headless_shell-1234/chrome-headless-shell-linux64 -> /opt/pw-browsers/chromium-1194/chrome-linux/chrome
  session-start: created and linked Playwright's expected chromium-1234/chrome-linux64 -> /opt/pw-browsers/chromium-1194/chrome-linux/chrome
  FUNCTION_RETURN=0
  ```
  `apps/web/node_modules` existed afterward, and revision 1234 — what `@playwright/test@^1.62.1`'s manifest actually asks for — was correctly resolved and linked, not inferred from what happened to already be on disk. A third run against the now-installed worktree (the ordinary path) completed in 0.065s with no output, confirming the `pnpm install` branch is skipped once dependencies exist and the existing links are left alone (idempotent `-e` check, unchanged). Checked: `bash -n .claude/hooks/session-start.sh` passes.
