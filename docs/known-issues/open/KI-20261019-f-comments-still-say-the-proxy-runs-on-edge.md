### KI-2026-10-19-f — Six comments still say `proxy.ts` runs in the Edge runtime; Next 16 builds it for Node only

- **Severity:** cleanup. Comments only; a reader may keep constraints (no database, no Node
  APIs) that no longer bind, or trust a reason that is no longer true.
- **Area:** each comment names the Edge runtime as the reason for a design choice:
  - `apps/web/src/lib/authConfig.ts:11`
  - `apps/web/src/lib/pendingAdmission.ts:9`
  - `apps/web/src/server/auth.ts:11`
  - `apps/web/src/server/admission.ts:31`
  - `apps/web/src/lib/playbooksPageReader.ts:5`
  - `apps/web/src/server/public-api/actor.ts:60`
- **Symptom / What happens:** `apps/web/src/proxy.ts:20` says *"Next 16 builds a `proxy` file for
  Node only, never Edge."* The six comments above still describe it as Edge. (Two more mentions,
  `proxy.ts:23-25` "edge-safe config" and `server/entitlements/resolver.ts:11` "the Edge proxy",
  are worth a look in the same pass.)
- **Why not fixed here:** found during M50's build; the close is prose-only and these are in
  `apps/`.
- **Fix direction:** reword each to the reason that still holds (the split-config keeps the proxy
  free of the database and of `@/server/*`, ADR-024), not the runtime. Decide separately whether
  ADR-024's "no database in the proxy" is still wanted now that the runtime allows one; a comment
  pass must not change that.
- **Cross-reference:** ADR-024; `apps/web/src/proxy.ts:15-20`.
- **First noted:** 2026-10-19, during M50's build (recorded in the build's hand-off for the close).
