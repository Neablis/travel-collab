import type { AccountPlanChoice } from "@/lib/accountPlan";
import snapshot from "./landingPlans.generated.json";

// The plans and prices the landing page's `#pricing` section shows (M42 D3).
//
// A committed snapshot for the same reason as `landingDemo.ts`: the landing
// may not fetch (SPEC §14), and `server/entitlements/planVersions.ts` is behind
// the lint wall. `scripts/landing-plans.ts` writes it from `planCatalogue`, the
// function the account sheet and `/plans` read per request, and
// `pnpm landing:plans:verify` (and `landing-plans.test.ts` inside `pnpm test`)
// fails on any difference — so publishing a new plan version cannot leave the
// front door quoting the old price without failing CI.
//
// Nothing is `held`: a visitor holds no plan, so no column is emphasised.

export const LANDING_PLANS: readonly AccountPlanChoice[] = snapshot;
