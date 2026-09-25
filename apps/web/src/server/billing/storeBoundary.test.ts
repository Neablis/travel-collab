// **Billing reads no Entitlements table** (ADR-047's 2026-09-25 amendment,
// KI-2026-09-25-d), as a sweep rather than as a sentence.
//
// `billing-imports-no-entitlements` in `.dependency-cruiser.cjs` forbids every
// Billing → `server/entitlements/` import but the plan catalog. It cannot see a
// Billing file that reaches the grant store or the cost ledger through the
// shared `server/db/schema` module instead: that import is of `db/schema`,
// which every module may use. `revenue.ts` did exactly that for
// `entitlement_grants` until 2026-09-25. What Billing needs from either table
// arrives as an argument from `entitlements/admin.ts`.
//
// **Why a sweep of names and not an import rule.** The property is "no Billing
// source uses this table", and a table is used by naming its Drizzle symbol —
// imported by name, reached as `schema.entitlementGrants`, or written as raw
// SQL. Matching the identifier and the SQL name in comment-stripped source
// catches all three; an import rule sees only the first.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceFilesUnder, strippedIfMentions } from "@/test-support/sourceSweep";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The grant store and the cost ledger: the two Entitlements stores the
// amendment names. Each by its Drizzle export and by its SQL name.
const ENTITLEMENTS_TABLES = /\b(?:entitlementGrants|entitlement_grants|aiUsage|ai_usage)\b/;

describe("Billing reads no Entitlements table", () => {
  it("names neither the grant store nor the cost ledger in any source file", () => {
    const files = sourceFilesUnder(HERE).filter((file) => !/\.test\.tsx?$/.test(file));
    expect(files.map((file) => path.basename(file))).toContain("revenue.ts");
    const offenders = files.flatMap((file) => {
      const source = strippedIfMentions(file, ENTITLEMENTS_TABLES);
      const hit = source?.match(ENTITLEMENTS_TABLES);
      return hit ? [`${path.basename(file)}: ${hit[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
