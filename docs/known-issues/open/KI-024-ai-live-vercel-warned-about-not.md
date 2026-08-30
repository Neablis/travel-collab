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
