### KI-2026-09-19-a — a freshly bootstrapped local env has no `API_TOKEN_PEPPER`, and the M22 e2e spec fails as if the token UI were broken

> **Scope, narrowed 2026-09-19 after Mitchell's correction — read this first.**
> **Every deployed environment already has this variable.** Checked against the
> Vercel project rather than assumed: `API_TOKEN_PEPPER` is set on **preview,
> development and production**, all three as `sensitive`. CI sets its own
> (`ci-pepper`). The vitest configs set a test value.
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

- **Why no other lane catches it:** every other lane supplies a pepper of its
  own. `vitest.config.ts:19` and `vitest.setup.ts:18` both `??=` a test value,
  so the unit and `int` suites — including `export.int.test.ts`, which mints a
  token on every case — are green. CI sets `API_TOKEN_PEPPER: ci-pepper`
  (`.github/workflows/ci.yml:70`). **Only the e2e web server, started from the
  real environment, sees the blank**, which is exactly the lane that takes its
  configuration the way a deployment does.
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
