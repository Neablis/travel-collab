### KI-32 — The container image's Playwright browsers are a different build from the pinned @playwright/test — RESOLVED, repaired on session start
- **Severity:** reliability (local e2e could not run without a manual workaround; CI unaffected)
- **Area:** the remote container image's `/opt/pw-browsers`, `apps/web/package.json`'s `@playwright/test`
- **Symptom:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` ships Chromium build **1194**. `@playwright/test@^1.61.1` resolves to a version that wants build **1228**, so `pnpm --filter web test:e2e` fails immediately at `auth.setup.ts` with "Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1228/...". The image's own guidance is not to run `playwright install`.
- **Scope:** local/container only. **CI is not affected** — `.github/workflows/ci.yml:88` runs `playwright install chromium` against its own cache, so CI gets the matching build and remains the authoritative e2e signal.
- **Workaround used (M10 Wave 2 Phase 6):** symlinked the missing `chromium-1228` / `chromium_headless_shell-1228` directories at the 1194 build. Chromium 141.0.7390.37 then drove the full 22-test suite green against a production build. The symlinks live in `/opt`, not the repo, and do not survive a new container. The sanctioned alternative is a Playwright `executablePath` pointing at `/opt/pw-browsers/chromium`.
- **Caveat this leaves on any local e2e result:** the suite ran on a Chromium build the pinned Playwright does not target. Nothing observed suggested a behavioral difference, but a green local run is corroboration, not a substitute for CI's.
- **RECURRED 2026-08-28, and the repair is not at fault.** A dispatched subagent's first e2e attempt died on this entry's verbatim symptom: `/opt/pw-browsers` held only build 1194 and nothing had linked 1228. Running `link_playwright_shell` from `.claude/hooks/session-start.sh` *unmodified* created and linked both directories and everything worked after — so the fix is correct, it simply had not run. The hook fires on session start; a subagent dispatched into an existing session apparently does not get one. Two consequences worth knowing: an agent that hits this may wrongly conclude the environment has no usable browser (see the browser note in `docs/guidelines/cloud-agent-sessions.md`, where two agents did exactly that on adjacent evidence), and the `/opt` symlinks do not survive a new container, so this will keep recurring per-container until the repair runs somewhere a subagent inherits it.
- **Why it was thought unfixable, and why that was wrong:** the original entry read *"it is an image-level mismatch, not a repo one — nothing in `travel-collab` produced it and no repo change fixes it."* The premise is right and the conclusion does not follow. `.claude/hooks/session-start.sh` **is** repo-owned and **does** run inside the container, which is exactly the seam where an image-level problem can be repaired from this repo. Pinning `@playwright/test` down to the 1194-era version would still be the tail wagging the dog; that was never the only option.
- **Fix (2026-08-26, PR #55):** `link_playwright_shell` in `.claude/hooks/session-start.sh` links any `chromium_headless_shell-*` build missing its binary at the first full `chromium-*/chrome-linux/chrome` in the image, on every remote session start. Deliberately generic — it matches on *an empty shell dir*, not on 1228 — so a Playwright bump does not silently reintroduce it. Verified by deleting the link and re-running the function: it repaired both 1194 and 1228, and `smoke` passed after. This also retires the entry's own caveat about local runs happening on an untargeted Chromium build, since the link is now applied deterministically rather than by hand.
- **Recurrence (2026-08-27, landing-page design pass) — the 2026-08-26 fix was
  not as generic as this entry claimed.** `test:e2e:ci-like` died at
  `auth.setup.ts` on the original symptom verbatim: `Executable doesn't exist at
  /opt/pw-browsers/chromium_headless_shell-1228/...`. The session-start hook had
  run and reported linking **1194**, not 1228. Cause: the loop globs
  `"$browsers"/chromium_headless_shell-*` and matches *an empty shell dir* — but
  a fresh container ships only `chromium_headless_shell-1194`, so the 1228
  directory does not exist at all, the glob never yields it, and nothing is
  linked. **The 2026-08-26 verification could not have caught this**: it deleted
  the *link* and left the directory in place, which is a different starting
  state from the one every new container actually has. "Matches on an empty
  shell dir, not on 1228" was true and was still insufficient.
- **Second fix (2026-08-27):** `link_playwright_shell` now also reads the
  required revisions from playwright-core's own `browsers.json` and creates the
  directory when it is missing, rather than only repairing directories that
  already exist. Still not pinned to 1228 — it tracks whatever the installed
  Playwright asks for, so a version bump is followed rather than silently
  reintroducing this. Verified from the real fresh-container state: deleted both
  `chromium-1228` and `chromium_headless_shell-1228` outright, ran the function
  alone, and it recreated and linked both (`Chromium 141.0.7390.37` responds).
  The full `test:e2e:ci-like` suite then ran 23 passed / 1 flaky (the flake is
  KI-28, unrelated).
- **Third fix (2026-08-27, PR #58 review) — the second fix was itself wrong on
  one of its two paths.** It hardcoded the destination layout, and Playwright's
  `EXECUTABLE_PATHS` is architecture-specific. From
  `playwright-core@1.61.1`'s own table:

  | browser | linux-x64 | linux-arm64 |
  |---|---|---|
  | `chromium` | `chrome-linux64/chrome` | `chrome-linux/chrome` |
  | `chromium-headless-shell` | `chrome-headless-shell-linux64/chrome-headless-shell` | `chrome-linux/headless_shell` |

  The headless-shell link was right for x64, which is the only reason the suite
  went green — that is what the e2e projects launch. Headed chromium was linked
  at the **arm64** path on an x64 container, so Playwright would never have
  found it. A dead link that costs nothing until something launches headed
  chromium, and nothing in the suite does. **This is the failure mode to
  remember: a green suite proved one of the two paths, and it was read as
  proving both.** Now derived from `uname -m`, and confirmed against
  Playwright's own resolver rather than a reading of the table —
  `chromium.executablePath()` returns
  `/opt/pw-browsers/chromium-1228/chrome-linux64/chrome`, which the hook now
  creates and previously did not.
- **Also third fix:** the manifest is resolved through `apps/web`'s own
  `@playwright/test` instead of `find node_modules/.pnpm … | head -1`. Only one
  `playwright-core` is in the store today, so this was latent, but two would
  have made the choice arbitrary and could link revisions the e2e suite does not
  use. `browsers.json` is not in playwright-core's `exports`, so the resolution
  walks up from the package main to the package root.
- **Lesson for the next "resolved" claim here:** verify an environment repair
  from the state a *new container* is in, not from the state you reached by
  partially undoing your own fix — and when a repair writes more than one path,
  a green test run only vouches for the paths that run actually exercised.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 6). **Fixed:** 2026-08-26 (PR #55, design-sync audit branch); **gap found and closed** 2026-08-27 (landing-page design pass).
