### KI-22 — The AI response envelope is not in `packages/contracts`
- **Severity:** cleanup
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts`, `apps/web/src/lib/apiClient.ts`
- The `/api/trips/:id/ai` response (`message`, `meta`, `simulated`,
  `resolvedCommands`, `resolutionErrors`, `locationReport`) is assembled ad hoc
  in the handler and parsed loosely by the client — `message` and `simulated`
  are read with `typeof` / `=== true` guards rather than through a schema. This
  sits against Invariant 5 ("contracts change by protocol, not by drift"): the
  envelope is a cross-boundary type that lives in neither `packages/contracts`
  nor the contracts changelog. It surfaced while adding `simulated`
  (2026-08-19), which needed no changelog entry precisely because there is no
  contract to change. Fixing it means schematizing the whole envelope and
  routing both AI client functions through it.
