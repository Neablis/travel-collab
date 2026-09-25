### KI-2026-09-25-d — Billing's `underwaterReport` reads Entitlements' `entitlement_grants` table directly, a boundary crossing dependency-cruiser cannot see

- **Severity:** cleanup — nothing misbehaves. It is the same boundary breach
  KI-2026-09-23-d closed for imports, by a route the wall does not watch.
- **Area:** `apps/web/src/server/billing/revenue.ts` (`underwaterReport`,
  counting accounts by grant source through `@/server/db/schema`),
  `apps/web/src/server/entitlements/admin.ts` (its only caller),
  ADR-047's 2026-09-25 amendment.
- **Symptom:** after 2026-09-25 Billing imports nothing of Entitlements but the
  plan catalog (`.dependency-cruiser.cjs`, `billing-imports-no-entitlements`),
  and `revenue.ts` takes trailing AI costs as an argument instead of reading
  Entitlements' ledger. It still queries `entitlement_grants` itself via the
  shared schema module, which the rule cannot see because the import is of
  `server/db/schema`, not of `server/entitlements/`.
- **Why not fixed here:** found by KI-2026-09-23-d's fixer (overnight sweep,
  2026-09-25), outside that entry's scope. Intended fix: the same reversal the
  ledger got — `admin.ts` reads the grant holders and passes them in.
- **Cross-reference:** `resolved/KI-20260923-d-billing-imports-entitlements-against-adr-047.md`, ADR-047.
- **First noted:** 2026-09-25, overnight KI sweep.
