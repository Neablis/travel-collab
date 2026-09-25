### KI-2026-09-23-d — Billing imports Entitlements six times, and ADR-047 says it imports it zero times — RESOLVED

- **Severity:** cleanup with a design question in it. Nothing misbehaves; the
  defect is that a written decision and the code disagree, and the ADR is the
  document a reviewer reads *instead of* the code.
- **Area:** `apps/web/src/server/billing/{checkout,planChange,prices,webhook,revenue}.ts`
  → `apps/web/src/server/entitlements/planVersions.ts`;
  `apps/web/src/server/billing/revenue.ts` → `apps/web/src/server/entitlements/usage.ts`;
  and the other direction, `apps/web/src/server/entitlements/admin.ts` →
  `apps/web/src/server/billing/revenue.ts`. Rule `billing-imports-no-entitlements`
  and the `server/billing ↔ server/entitlements` `no-folder-cycle` entries in
  `.dependency-cruiser-known-violations.json`.

- **What the ADR says.** `docs/architecture/ADR-047-billing-is-a-module-and-the-webhook-is-its-only-writer.md`,
  Decision 1: *"The dependency runs **Entitlements → Billing**, one way. The
  resolver asks `standingFor(userId)` … Billing's store imports no plan file and
  no resolver, so nothing closes a cycle."*

- **What the code does** (dependency-cruiser, first run, 2026-09-23). The
  sanctioned direction exists — `entitlements/resolver.ts:24` → `billing/standing.ts`,
  `entitlements/accountPlan.ts:31` → `billing/config.ts` — and so does the
  other one:

  | Billing file | imports from `entitlements/planVersions.ts` |
  |---|---|
  | `checkout.ts:17-22` | `isPurchasable`, `livePlanVersion`, `planVersionRefOf`, `PlanVersion` |
  | `planChange.ts:16-21` | the same four |
  | `prices.ts:21-26` | `isPurchasable`, `planVersionRefOf`, `priceLookupKey`, `PlanVersion` |
  | `webhook.ts:27` | `isPublishedRef`, `livePlanVersion` |
  | `revenue.ts:20-21` | `PLAN_VERSIONS`, `planVersionRefOf`; and `costPerAccount` from `usage.ts` |

  So the folders are one cycle, and the ADR's "nothing closes a cycle" is
  false. Read narrowly, "Billing's **store** imports no plan file" is still
  true of `subscriptions.ts` — but the sentence is doing the work of a
  boundary, and a reader takes it as one.

- **Why this was not fixed in the PR that found it.** Every Billing import is
  of the plan **catalog** — ids, prices, lookup keys, whether a version is
  purchasable — and none is of what a plan **grants**. That is a real
  distinction and it points at three different fixes, which are Mitchell's
  choice rather than a cleanup's:
  1. **Split the catalog out of `planVersions.ts`** into a leaf both modules
     read (the price/lookup-key/purchasable half), leaving the grant sets in
     Entitlements. The cycle goes; the ADR becomes true as written.
  2. **Amend ADR-047** to say Billing reads the plan catalog and never the
     resolver or a grant set, and narrow the rule to
     `billing ↛ entitlements/(resolver|grants|capability|…)`. Honest, smaller,
     and it keeps a folder cycle the wall then has to name as allowed.
  3. **Move the operator console's composition out of Entitlements.**
     `entitlements/admin.ts` (with `requireAdmin.ts`) merges Billing's revenue
     into M20's tier panel — its own header says so, lines 13-21 — and is the
     one Entitlements → Billing edge that is not the resolver asking for
     standing. A `server/admin/` composition folder that may import both would
     remove that edge whichever of 1 or 2 is chosen. The header deliberately
     places this code in Entitlements, which is why it was not moved on sight.
  `revenue.ts` → `usage.ts` (Billing reading Entitlements' cost ledger) goes
  with whichever of these is picked.

- **Cross-reference:** ADR-045 (Entitlements is a module), ADR-047,
  `docs/reviews/2026-09-23-architecture-wall-first-run.md`,
  `docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md`.
- **First noted:** 2026-09-23, the first run of `pnpm arch` over the whole
  workspace.
- **Reproduction (2026-09-25, before the fix):** `pnpm arch` printed
  `warn no-folder-cycle-known: apps/web/src/server/billing → apps/web/src/server/entitlements → apps/web/src/server/billing`
  (and the reverse), and `‼ 6 known violations ignored`. With
  `--ignore-known` dropped, those six were
  `error billing-imports-no-entitlements: apps/web/src/server/billing/{checkout,planChange,prices,revenue,webhook}.ts → apps/web/src/server/entitlements/planVersions.ts`
  and `… billing/revenue.ts → apps/web/src/server/entitlements/usage.ts`
  (`x 15 dependency violations (6 errors, 9 warnings)`).
- **Fix (2026-09-25):** option 2, plus the ledger edge inverted.
  ADR-047 gets a dated amendment: Billing reads the plan **catalog**
  (`entitlements/planVersions.ts`: ids, refs, prices, lookup keys,
  purchasability) and nothing else of Entitlements. No resolver, capability,
  grant store or cost ledger. `billing-imports-no-entitlements` in
  `.dependency-cruiser.cjs` now forbids every Billing → Entitlements import
  except that one file (`pathNot`). All six entries are gone from
  `.dependency-cruiser-known-violations.json`, which is now `[]`.
  `revenue.ts` no longer imports `entitlements/usage.ts`:
  `revenueSummary`, `underwaterReport` and `revenueByPlan` take the trailing
  window's cost as an argument (`TrailingCost`, declared in Billing).
  `entitlements/admin.ts` reads the ledger once and hands it across. That edge
  runs Entitlements → Billing, the sanctioned direction. The folder cycle
  stays in `KNOWN_CYCLE_CLUSTERS`, relabelled as sanctioned by the amendment
  instead of pending this KI. It is bounded by the file-level rule, so it
  cannot contain a second Billing edge.
- **Proof:** `pnpm arch` after the fix exits 0 with
  `x 9 dependency violations (0 errors, 9 warnings)`, and the
  `6 known violations ignored` line is gone. Re-adding
  `import { costPerAccount } from "@/server/entitlements/usage"` to
  `revenue.ts` turned it red:
  `error billing-imports-no-entitlements: apps/web/src/server/billing/revenue.ts → apps/web/src/server/entitlements/usage.ts`
  (exit 1). So did a resolver import in `checkout.ts`:
  `… billing/checkout.ts → apps/web/src/server/entitlements/resolver.ts`.
  Restoring each made it green again. To confirm that
  `revenue.int.test.ts` still exercises the cost that is now handed in,
  `underwaterReport`'s `costs` was forced to `[]`. 4 of its 11 tests went red
  (`expected [] to deeply equal [ Array(1) ]`); restored, they are green.
  Checks run: `pnpm --filter web typecheck`, eslint on the three changed
  source files, billing + entitlements unit files (17 files / 150 tests),
  and billing + entitlements integration files (12 files / 108 tests).
- **Decision (2026-09-25 overnight sweep):** option 2, amending ADR-047 to
  sanction Billing → catalog and narrowing the rule to that one file. The
  ledger import was inverted instead of being sanctioned too. Rejected:
  **option 1**, moving the catalog to a neutral `server/plans/` leaf. That
  removes the folder cycle, but the `AGENTS.md` module map and ADR-045 rule 1
  both place plan versions in Entitlements. An entry carries its grant set,
  so a neutral file still hands Billing the grants as data. It would also
  touch about fifty importers, including a `packages/contracts` comment.
  **Option 3**, moving `entitlements/admin.ts` to `server/admin/`, was also
  rejected: its Billing edge already runs in the sanctioned direction, so the
  move removes nothing. Both rejections are recorded in the amendment itself.
