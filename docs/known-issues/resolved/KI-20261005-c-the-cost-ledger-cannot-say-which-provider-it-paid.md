### KI-2026-10-05-c — the cost ledger cannot say which provider a step was billed by — RESOLVED

- **Severity:** moderate (every cost figure is an estimate whose error is unknown, in either
  direction).
- **Area:** `apps/web/src/server/entitlements/modelRates.ts` (one list rate per model),
  `handleAskRequest.ts` (`providerOptions: { gateway: { caching: "auto" } }`, no provider pinned),
  the `ai_usage_steps` table.
- **Symptom / What happens:** Mitchell, comparing models on 2026-10-05, read DeepSeek V4.1 Flash
  at $0.02 / $0.38 and GLM at $0.10 / $0.50 in the Vercel dashboard, against the $0.30 / $1.20 and
  $0.15 / $0.50 the repo used. The Gateway sells each model through many providers
  (`GET /v1/models/{model}/endpoints`: about 20 for `zai/glm-5.3-flash`, $0.075–0.45 input per
  MTok; the dashboard's DeepSeek figure is the `morph` provider's) and routes each request to one
  of them. The ledger priced every GLM step at `zai`'s list rate, and recorded nothing that said
  which provider served it or what was debited.
- **Fixed 2026-10-05:** each step row now carries `provider` (the Gateway's
  `routing.finalProvider`) and `gateway_generation_id` (migration `0038`). The billed cost is
  looked up from the Gateway by that id, or summed by `GET /v1/report?group_by=provider`, as the
  `ai-usage` skill's *What a turn was billed* says; query 9 of `ledger.sql` lists the providers.
  **No dollar is stored**: Mitchell chose ids over a billed-cost column, so ADR-062's "no dollar
  is stored at all" and `usage.noMoney.test.ts` stand unchanged.
- **Proof:** `askAnalytics.test.ts` (the recorder reads the final provider and id; malformed
  values are null) and `route.int.test.ts` (through the real handler, a routed model's
  provider and per-step ids land on every step row), each seen red with the recorder's read
  removed (`expected [ [ null, null ], [ null, null ] ] to deeply equal …`);
  `usage.int.test.ts` red with the writer dropping the two columns, for both insert and replay.
- **Not done here, a decision for later:** pinning a cheaper provider
  (`providerOptions.gateway.order`). It wants a few days of query 9 and the billed totals first,
  and an eval pass per candidate provider, since providers serve one model differently.
