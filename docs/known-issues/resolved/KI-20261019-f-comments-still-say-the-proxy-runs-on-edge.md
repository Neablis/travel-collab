### KI-2026-10-19-f — Six comments still say `proxy.ts` runs in the Edge runtime; Next 16 builds it for Node only — RESOLVED

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
- **Resolved, 2026-10-24 (KI sweep):** comments only. Confirmed first: `grep -in edge` over the
  six files found each claim, and Next 16.4.2's own build refuses runtime config in a proxy with
  *"Proxy always runs on Node.js runtime"* (`next/dist/build/analysis/get-page-static-info.js`).
  Each comment now gives the reason that still holds, keeping the proxy free of the database and of
  `@/server/*` (ADR-024), and `actor.ts` no longer cites stale line numbers (`proxy.ts:63-66`).
  The two extra mentions (`proxy.ts`'s "edge-safe config" and `resolver.ts`'s "the Edge proxy")
  were reworded in the same pass. `authConfig.ts` keeps one deliberate mention, as history: ADR-024
  gave Edge as a reason and it no longer applies. ADR-024's "no database in the proxy" itself is
  unchanged (the separate decision the entry reserves). Proof: the same grep for "edge runtime",
  "edge-safe", "edge proxy" and "edge-compatible" over `apps/web/src` returns only that line;
  `eslint` on the eight files is clean.
