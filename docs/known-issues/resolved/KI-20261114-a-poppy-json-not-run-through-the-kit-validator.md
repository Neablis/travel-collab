### KI-2026-11-14-a — `/.well-known/poppy.json` has never been run through the kit validator — RESOLVED

- **Severity:** reliability. The document's shape is asserted in CI, but the verdict M60's gate asked
  for (the kit validator's) was never recorded, so a field the validator checks and our tests do not
  could be wrong on production without anyone knowing.
- **Area:** `apps/web/src/app/.well-known/poppy.json/route.ts`,
  `apps/web/src/server/poppy/discovery.ts` and `discovery.test.ts` (the document and the CI cases
  that pin it), `docs/milestones/M60-personal-agents-act-for-you.md` (the exit-gate box this entry
  carries).
- **Symptom / What happens:** M60's gate box "`poppy.json` passes the kit validator's `check --file`
  and `--milestone foundation`" was closed by deferral on 2026-11-14, not passed: neither command
  was run or recorded. In CI, `discovery.test.ts` (pinned version and sign-in details; every
  published scope described; MCP server, OpenAPI and tasks endpoint listed; origin from
  configuration) and `oauth/wellKnown.test.ts` assert the document's shape. That is not the
  validator's verdict. PR 733 added `auth.issuer` to the document after the part that wrote it, and
  the kit's 0.4 validator is the check of record (ADR-089 D13), so the present document has not been
  seen by it at all.
- **Why not fixed here:** the run was waiting on sign-in on PR previews (which never worked, see
  M60's retro) and was then not done before the close. It needs the validator kit and the live
  site, not a code change.
- **Fix path:** run the kit's `check --file` against the document saved from
  `https://caesura.today/.well-known/poppy.json`, and `--milestone foundation` against
  `https://caesura.today`, and record both outputs in the M60 milestone file. Then move this entry
  to `resolved/`. If either fails, fix `discovery.ts` and add the failing case to `discovery.test.ts`
  first.
- **Cross-reference:** M60 exit gate (amended out at the close); ADR-089 D13; KI-2026-11-14-b (the
  other deferred box).
- **First noted:** 2026-11-14, M60 gate close.
- **Resolved:** 2026-11-15, by running the kit validator (Poppy 1.0, `personal-agent-protocol`
  plugin, cache `85b41ff27e8f`) against production `https://caesura.today` with test identity
  `https://neablis.github.io/poppy-test-agent/agent.json`; no code change was needed. Proof:
  `check --file` on the live `poppy.json`, 7 passed, 0 failed, 7 skipped (network-only);
  `--milestone foundation`, 26 passed, 0 failed, 8 inconclusive, 31 skipped; `--milestone
  interfaces --probe https://caesura.today/api/v1/discover/playbooks --probe-session`,
  Foundation 50 passed, 1 failed, 9 inconclusive, 5 skipped and Interfaces 11 passed, 0 failed,
  54 skipped. The one failure (`session.missing`) comes from passing `--probe-session` on a route
  that also serves M22 API-token clients (spec 1.0 §5.3); re-run without it, `session.start`
  passed and `session.missing` skipped. The output, and why each non-pass is not a defect, is
  under the amended-out box in `docs/milestones/M60-personal-agents-act-for-you.md`.
  The nine inconclusive checks (`assertion.*`, `token.invented`) needed an `oauth_clients` row
  for the test agent; Mitchell clicked Allow at `/oauth/authorize` on production the same day
  (after `migrate-production` run 43737004995 applied `0078`, KI-2026-11-15-b), and the re-run
  without `--probe-session` gave Foundation 56 passed, 0 failed, 1 inconclusive, 1 warning, 7
  skipped; Interfaces 11 passed, 0 failed, 54 skipped. Left over, none of them in `poppy.json`:
  `assertion.jti-reuse` warns because production's cache is off or down (KI-2026-11-15-a);
  `token.invented` is inconclusive (fixed in PR 757, re-run after it deploys); `assertion.ps384` and
  `session.delegation-ps384` skip because the test agent has no RSA key (optional follow-up).
