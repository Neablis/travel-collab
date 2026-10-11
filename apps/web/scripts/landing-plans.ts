// Writes `src/lib/landingPlans.generated.json` — the plans and prices the
// landing page's `#pricing` section shows — or, with `--check`, fails if the
// committed file differs from a fresh generation.
//
//   pnpm --filter web landing:plans:generate   # rewrite the snapshot
//   pnpm landing:plans:verify                  # the drift check (also inside `pnpm test`)
//
// The same arrangement as `landing-demo.ts`, for the same reason: the landing
// may not fetch (SPEC §14) and cannot import `@/server/*`. This reimplements
// nothing — the catalogue is `planCatalogue`, what `/plans` renders, with no
// plan held because a visitor holds none.
//
// Run with `node --import ./scripts/lib/ts-resolve-register.mjs`, which lets
// Node follow `src/**`'s extensionless imports and the `@/` alias.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { planCatalogue } from "@/server/entitlements/planCatalogue";

export const SNAPSHOT_PATH = fileURLToPath(new URL("../src/lib/landingPlans.generated.json", import.meta.url));

/** Every enabled plan's live version, as a signed-out reader sees it. */
export function buildLandingPlans(): AccountPlanChoice[] {
  return planCatalogue(null);
}

/** The snapshot file's exact bytes: what the generator writes and what the verify step compares. */
export function serializeLandingPlans(plans: readonly AccountPlanChoice[]): string {
  return `${JSON.stringify(plans, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fresh = serializeLandingPlans(buildLandingPlans());
  if (process.argv.includes("--check")) {
    const committed = readFileSync(SNAPSHOT_PATH, "utf8");
    if (committed !== fresh) {
      console.error(
        "landing:plans:verify — src/lib/landingPlans.generated.json is stale: planVersions.ts changed what the landing's pricing shows.\n" +
          "Regenerate it with `pnpm --filter web landing:plans:generate` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`landing:plans:verify OK (${Buffer.byteLength(fresh)} bytes)`);
  } else {
    writeFileSync(SNAPSHOT_PATH, fresh);
    console.log(`wrote ${SNAPSHOT_PATH} (${Buffer.byteLength(fresh)} bytes)`);
  }
}
