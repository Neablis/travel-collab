### KI-2026-09-19-a — a freshly bootstrapped local env has no `API_TOKEN_PEPPER`, and the M22 e2e spec fails as if the token UI were broken

> **Scope, narrowed 2026-09-19 after Mitchell's correction — read this first.**
> **Every deployed environment already carries this variable.** Checked against
> the Vercel project rather than assumed: `API_TOKEN_PEPPER` is bound to
> **preview, development and production**, all three as `sensitive`, created
> 2026-09-16 19:54. CI sets its own (`ci-pepper`). The vitest configs set a test
> value.
>
> **What that check does NOT establish**, said plainly because the distinction
> is the whole reason this entry was nearly filed wrong: Vercel's env listing
> returns `decrypted: false`, and a `sensitive` variable's value is never
> returned at all. **Binding was confirmed; content was not.** A variable set to
> an empty string would look identical. Nothing here should be read as "the
> deployed pepper is known to work" — only as "a pepper is configured in every
> deployed target, so a blank one is not what this entry is about."
>
> So this entry is **only** about a local checkout bootstrapped by
> `pnpm setup` — which is every fresh worktree and every cloud session, because
> `.claude/hooks/session-start.sh` runs it automatically. It is a papercut in
> the local dev bootstrap, **not** a gap in any environment the product runs in.
>
> The first draft of this entry claimed it was "the same variable, one
> environment over" as `KI-2026-09-16-d`. **That was wrong**, and it was wrong
> in the direction that matters: `KI-2026-09-16-d` is about `ADMIN_USER_IDS`,
> not this variable at all. See that entry, and the 2026-09-19 note in
> `docs/milestones/README.md`.

- **Severity:** cleanup (a local-bootstrap gap that costs one full e2e run per
  fresh environment and presents as a product defect; nothing is wrong in the
  app, and nothing deployed is affected)
- **Area:** `.env.example:149` (`API_TOKEN_PEPPER=`, shipped blank),
  `scripts/setup-env.mjs` (copies that file verbatim to `apps/web/.env.local`),
  `apps/web/src/server/api-tokens/index.ts:79` (the throw),
  `apps/web/e2e/m22-api-tokens.spec.ts:70`
- **Symptom:** in a checkout whose `apps/web/.env.local` came from `pnpm setup`
  and was never hand-edited, `pnpm --filter web test:e2e:ci-like` fails **one**
  spec:

  ```
  1) [desktop] › e2e/m22-api-tokens.spec.ts:29:1 › api tokens: minted by clicking, …
     Locator: getByTestId('token-revealed')
     Expected substring: "not shown again"
     Error: element(s) not found
  ```

  The reveal panel is missing because `mintToken` threw — correctly, and by
  design — but nothing in the failure says so. It reads as *the token UI does
  not render*, and it fails identically on the retry, so **CLAUDE.md rule 2's
  own heuristic points the wrong way**: a failure that does not move between
  runs is supposed to be a real defect. Here it is neither that nor a flake.

- **~~Why no other lane catches it~~ — WRONG, AND MEASURED WRONG ON
  2026-09-23. The `int` lane catches it too, 86 tests at a time.** The
  paragraph below is kept because its reasoning is the interesting part and
  because it is exactly the shape of claim that gets believed:

  > every other lane supplies a pepper of its own. `vitest.config.ts:19` and
  > `vitest.setup.ts:18` both `??=` a test value, so the unit and `int` suites
  > — including `export.int.test.ts`, which mints a token on every case — are
  > green. CI sets `API_TOKEN_PEPPER: ci-pepper`
  > (`.github/workflows/ci.yml:70`). **Only the e2e web server, started from
  > the real environment, sees the blank**, which is exactly the lane that
  > takes its configuration the way a deployment does.

  Both cited lines are real and both do exactly what that says. **`??=` assigns
  only when the left side is `undefined` or `null`.** `.env.local` sets
  `API_TOKEN_PEPPER=`, which is the empty string — present, not nullish — so
  the default never fires and `pepper()` throws exactly as it does for the e2e
  server. The `int` lane reads `.env.local` like every other local lane; the
  only thing that protected it in the original measurement was that the
  measurement was never taken.

  Measured in a cloud session, `pnpm --filter web test:int`, no code change
  between the two runs:

      as bootstrapped                     8 failed | 56 passed (64 files)
                                         86 failed | 731 passed | 7 skipped
      API_TOKEN_PEPPER=<anything> set     64 passed (64 files)
                                             824 passed

  All eight failing files trace to the same frame — `pepper`
  (`src/server/api-tokens/index.ts:111`) → `hashOf` → `mintToken`:
  `apiTokens.int.test.ts`, `locations.int.test.ts`, `collections`, `export`,
  `rateLimit`, `route`, `surface` and `accounts`. One of them surfaces as
  `relation "api_tokens" does not exist`, which looks like a migration problem
  and is not — it is a cascade from a `beforeAll` that threw.

  **This is `docs/guidelines/cloud-agent-sessions.md`'s own "an `.env.local`
  KEY can be present and its VALUE still empty" trap**, one level further in:
  there the failing check is a `grep` for the name, here it is `??=`. Both pass
  on a key that is present and useless. **CI is unaffected** — it sets
  `ci-pepper` explicitly rather than relying on a default — so this stays a
  local-bootstrap papercut, but it is a much larger one than this entry
  claimed: 86 integration tests plus one e2e spec, not one e2e spec.

  **It also raises the cost of the "filed rather than fixed" call below.** Fix
  1 (a visible fake value in `.env.example`) would close both lanes at once;
  fix 2 (make the e2e lane say it) closes only the smaller half. That is new
  information about a choice this entry left open, not a decision — still
  Mitchell's.
- **Found by:** running the full Definition of Done for M25, 2026-09-19. Proven
  rather than inferred: adding `API_TOKEN_PEPPER` to `apps/web/.env.local` and
  re-running `m22` turned 1 failed / 2 passed into 2 passed, with no code
  change.
- **Why it is filed rather than fixed:** there are two candidate fixes and
  neither is obviously this session's to pick.
  1. **Give `.env.example` a visible, obviously-fake dev value** instead of a
     blank. The file's own prose argues against an empty pepper — *"tokens
     would keep working while the property this key exists for silently did not
     hold"* — but that argument is about a **code fallback**, not about a
     checked-in local placeholder, and the two are different things. This is
     the one-line fix and it touches a security-adjacent file, which is why it
     is proposed rather than done.
  2. **Make the e2e lane say it**, next to the environment precondition it
     already enforces. `e2e/global.setup.ts` refuses to start unless
     `AI_LIVE=false` (KI-25) — an environment fact checked once, loudly, before
     137 specs run against it. Adding this variable to that check turns three
     and a half minutes and a misleading locator error into one line at
     startup. It fixes the *legibility* rather than the gap, which may be the
     more honest target.
- **What bounds the damage:** CI, preview and production are all unaffected, so
  this never reaches a PR check or a deploy. It costs one local full-suite run
  per fresh environment, paid by whoever is least equipped to recognise it.
- **Cross-reference:** `KI-2026-09-16-d` is **not** this — it is
  `ADMIN_USER_IDS` on a Vercel preview, and conflating the two is the mistake
  this entry's header exists to stop repeating. `e2e/global.setup.ts`'s
  `AI_LIVE` check is the precedent for fix 2.
- **First noted:** 2026-09-19, running M25's Definition of Done. Scope narrowed
  the same day, by Mitchell.
