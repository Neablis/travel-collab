### KI-2026-09-19-a — an unset `API_TOKEN_PEPPER` fails the M22 e2e spec as if the token UI were broken

- **Severity:** reliability (a local-environment gap that costs a full e2e run and reads as a product defect; nothing is wrong in the app)
- **Area:** `.env.example:149` (`API_TOKEN_PEPPER=`, shipped blank), `apps/web/src/server/api-tokens/index.ts:79` (the throw), `apps/web/e2e/m22-api-tokens.spec.ts:70`
- **Symptom:** on a local or container environment whose `apps/web/.env.local` was copied from `.env.example` and never given a pepper, `pnpm --filter web test:e2e:ci-like` fails **one** spec:

  ```
  1) [desktop] › e2e/m22-api-tokens.spec.ts:29:1 › api tokens: minted by clicking, …
     Locator: getByTestId('token-revealed')
     Expected substring: "not shown again"
     Error: element(s) not found
  ```

  The reveal panel is missing because `mintToken` threw — correctly, and by
  design — but nothing in the failure says so. It reads as *the token UI does
  not render*, which is a product defect, and the spec fails identically on the
  retry, so **CLAUDE.md rule 2's own heuristic points at a real defect**: a
  failure that does not move between runs is not a timeout. Here it is neither.

- **Why the rest of the suite does not catch it:** every other lane supplies a
  pepper of its own. `vitest.config.ts:19` and `vitest.setup.ts:18` both
  `??=` a test value, so the unit and `int` suites — including
  `export.int.test.ts`, which mints tokens on every case — are green. CI sets
  `API_TOKEN_PEPPER: ci-pepper` (`.github/workflows/ci.yml:70`). **Only the e2e
  web server, which is started from the real environment, sees the blank.** So
  the one lane that takes its configuration the way production does is the one
  lane that fails, and it fails nowhere else.
- **Found by:** running the full Definition of Done for M25, 2026-09-19. Proven
  rather than inferred: setting `API_TOKEN_PEPPER` in `apps/web/.env.local` and
  re-running `m22` turned 1 failed / 2 passed into 2 passed, with no code
  change.
- **Why it is filed rather than fixed:** the fix is not "ship a default". The
  variable's whole argument, spelled out in `.env.example` directly above it, is
  that an empty pepper still produces a *stable* digest — so a fallback would
  make tokens keep working while the property the key exists for silently did
  not hold, "the worst failure mode a credential store has because nothing
  errors". **Refusing to start is correct; refusing legibly is what is missing**,
  and the seam where that legibility belongs is not obviously this repo's e2e
  setup rather than `.env.example`'s text.
- **Fix path, if taken:** the cheapest honest version is to make the e2e lane
  *say it*, next to the two things it already asserts about its own
  environment. `e2e/global.setup.ts` already refuses to start unless
  `AI_LIVE=false` (KI-25), which is exactly this shape — an environment
  precondition checked once, loudly, before 137 specs run against it. Adding
  `API_TOKEN_PEPPER` to that check turns three and a half minutes and a
  misleading locator error into one line at startup. A second, smaller half:
  `.env.example` documents the variable thoroughly and never mentions that
  leaving it blank fails a spec.
- **What bounds the damage today:** CI is unaffected, so this never reaches a
  PR check or a deploy. It costs exactly one local full-suite run per fresh
  environment, and the cost is paid by whoever is least equipped to recognise
  it — somebody new to the repo, on their first Definition of Done.
- **Cross-reference:** `KI-20260916-d` (the same variable, the same class, one
  environment over — M22's last gate box needs it set on a *preview*, and is
  open for that reason). `e2e/global.setup.ts`'s `AI_LIVE` check is the
  precedent for the fix.
- **First noted:** 2026-09-19, running M25's Definition of Done.
