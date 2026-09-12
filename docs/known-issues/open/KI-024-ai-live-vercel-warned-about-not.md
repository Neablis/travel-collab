### KI-24 — `AI_LIVE` on Vercel is warned-about, not prevented
- **Severity:** cleanup (defense-in-depth, not a live bypass)
- **Area:** `apps/web/src/server/ai/modelSelection.ts`
- "Never set `AI_LIVE` in a Vercel environment" is documented in
  `.env.example`, `docs/guidelines/environments-and-deploys.md`, ADR-019, and
  `modelSelection.ts`'s own comment — but the only enforcement is a
  module-load `console.warn` when `process.env.VERCEL && process.env.AI_LIVE
  !== undefined`. If `AI_LIVE=true` were ever actually set on Vercel, it would
  still fully override the `ai-live` flag (and the dashboard/Toolbar controls
  built around it) with only a log line as evidence. A stronger fix — making
  `AI_LIVE` inert on Vercel, so it can only force *simulated*, never *live* —
  was deliberately not applied during the 2026-08-19 branch's final review:
  it trades away an emergency escape hatch (a way to force AI on from a
  Vercel env if the Flags product itself misbehaves) that the project owner
  may want to keep. Recorded here as an open decision rather than a bug;
  revisit if `AI_LIVE` is ever set on Vercel by accident, or if Mitchell
  decides the escape hatch isn't worth the risk.
- **Milestone:** **M9, carried (assigned 2026-09-01)** — owned by M9, not a gate box: defense-in-depth on a switch that works. Assignment rationale — why three of the twelve AI entries gate M9 and nine are carried — is in `docs/milestones/M9-ai-planning-partner.md`, section "The AI known issues".
- **Fix (2026-09-12):** the "making `AI_LIVE` inert on Vercel" fix this entry
  itself rejects (it trades away the emergency escape hatch) is still not
  applied, and still shouldn't be — that trade-off is unchanged and is not
  this fixer's call to make. What was a real, separate defect underneath the
  documented decision: the warning lived at **module load**, so on Vercel it
  fired at most once per cold start. A serverless function instance stays
  warm and keeps serving requests for a long time after that — every request
  the override actually decided for, for the rest of that container's life,
  left nothing further in the logs. `warnIfVercelOverride()` in
  `modelSelection.ts` moves the same `console.warn` out of module scope and
  into `aiLiveMode()`'s `AI_LIVE !== undefined` branch, so it now fires on
  every resolution the override decides, not just the first. The override
  itself is unchanged: still exactly as live-capable, still not a hard
  failure at startup or anywhere else, still local/CI-only by convention. This
  is strictly a better evidence trail for a decision that stands as recorded.
- **Proven:** reproduced first — with `VERCEL=1` and `AI_LIVE=true` stubbed
  before import, the pre-fix code warned exactly once at import and then
  `aiLiveMode()` could be called any number of times with zero further log
  output (confirmed via a scratch repro: `{"live":true,"source":"env"}
  warnCalls=1`, one message, no matter how many times `aiLiveMode()` ran
  after). A new regression test in `modelSelection.test.ts` ("Vercel AI_LIVE
  override warning (KI-24)") pins this: run red against the pre-fix source
  (`expected "warn" to be called 2 times, but got 0 times`), green after the
  fix (`aiLiveMode()` called twice on Vercel → `console.warn` called twice);
  a second case pins that the escape hatch stays silent outside Vercel, which
  is its documented, expected path. `pnpm --filter web typecheck`,
  `pnpm --filter web lint`, and
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts
  src/server/ai/modelSelection.test.ts` (19/19) all pass.

- **2026-09-12 — the warning got better; THIS ENTRY STAYS OPEN.** The overnight KI sweep swept this entry by mistake and its agent closed it. Reopened deliberately, because closing it would misfile a decision as a fix.
- **What the sweep changed, and it is worth keeping:** the `console.warn` was at **module scope**, so on Vercel it fired at most once per cold start — a warm serverless instance then honoured the override for every subsequent request with no further evidence, and the single line could age out of log retention before anyone investigating a spend spike went looking. It now lives in `warnIfVercelOverride()`, called from `aiLiveMode()`'s `AI_LIVE !== undefined` branch, so it fires on every resolution the override actually decides. Regression tests in `modelSelection.test.ts` (`describe("Vercel AI_LIVE override warning (KI-24)")`) cover both that and the no-warning-outside-Vercel path, proven red first: `AssertionError: expected "warn" to be called 2 times, but got 0 times`.
- **Why the entry is still open regardless.** Its headline claim is unchanged: `AI_LIVE=true` on Vercel still fully overrides the `ai-live` flag. Better evidence of the override is not prevention of it. This entry says of itself that it is *"an open decision rather than a bug"*, to be revisited if `AI_LIVE` is ever set on Vercel by accident **or if Mitchell decides the escape hatch isn't worth the risk** — and that decision has not been made. It is also marked **owned by M9** (assigned 2026-09-01), the current milestone, which puts it outside backlog-sweep scope in the first place.
- **What would actually close it:** either Mitchell giving up the escape hatch (making `AI_LIVE` able to force only *simulated* on Vercel, never *live*), or a platform-level control outside this codebase — Vercel environment-variable protection — so the variable cannot be set there by accident. Neither is a code change a sweep agent should make alone.
