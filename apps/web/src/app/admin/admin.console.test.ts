// **The split this file guarded is over, and what replaces it is not nothing.**
//
// From M20 until 2026-09-14 this swept the console for revenue vocabulary. The
// reason was a scope leak that would have looked like extra credit in review:
//
// > *"The console the design draws is not all M20's, and the screen does not
// > say which half is which. Its four-number strip — MRR and its movement,
// > ARPU twice and labelled, median margin per paying account over a trailing
// > 30 days — is M21 link 7. […] An implementer working from the finished
// > screen will build the strip inside M20 and break the split."*
//
// **It worked.** M20 shipped without the strip, and M21 link 7 built it — in a
// diff that had to rewrite this file to land, which is exactly the forcing
// function it was for. M21's own file predicted the rewrite: *"that test is the
// first thing to update when the strip lands, not a wall to route around."*
//
// What is left is the half that was never about the split, and would be just as
// wrong today as it was then:
//
//   1. **No `Money` anywhere on this data path.** ADR-008's minor units round a
//      $0.0006 request to zero, and a revenue screen is where that would look
//      most like a real number. This is the third recurrence of the defect
//      class (KI-1, then the ledger, now here).
//   2. **No publish or migrate path over plan versions.** Versions are a
//      committed file and the console is read-only over them — the 2026-09-02
//      amendment, which a revenue screen has no reason to undo and every
//      opportunity to.
//   3. **The underwater list stays segmented.** Merging the two halves is a
//      one-line change that makes the metric worthless, and nothing about the
//      screen would look wrong afterwards.
//   4. **The report queue is read after the gate** (M12 link 6) — the page's
//      second server read, and the first that carries other people's words.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

const ADMIN_COMPONENTS_DIR = path.join(WEB, "src/components/admin");
const ADMIN_COMPONENTS = readdirSync(ADMIN_COMPONENTS_DIR)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .filter((name) => !name.endsWith(".test.tsx"))
  .map((name) => path.join(ADMIN_COMPONENTS_DIR, name));

const CONSOLE_FILES = [
  path.join(HERE, "page.tsx"),
  path.join(HERE, "layout.tsx"),
  // **Every component in the admin directory, read off disk rather than
  // listed.** This was two hand-written entries, and the list was wrong twice:
  // `GrantList` landed in the same phase as the sweep and was never added, and
  // then `GrantDialog` arrived and would have repeated it exactly (CodeRabbit,
  // PR #174). A sweep whose coverage depends on somebody remembering to extend
  // it is a sweep with a hole per new file, so the directory is the list.
  ...ADMIN_COMPONENTS,
  path.join(WEB, "src/lib/adminOverview.ts"),
  path.join(WEB, "src/server/entitlements/admin.ts"),
  path.join(WEB, "src/server/billing/revenue.ts"),
  path.join(WEB, "src/app/api/admin/overview/route.ts"),
  path.join(WEB, "src/app/api/admin/grants/route.ts"),
];

/** Prose removed: a comment explaining a rule is the rule, not a breach. */
const codeOf = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("the console's money is micro-dollars and never Money", () => {
  it("names no Money type and no minor-unit field on this data path", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(4);
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      // `amountMinor` is `Money`'s own field name — the tell that someone
      // reached for the contract type. `priceMinor` is the plan record's and is
      // legitimately read here, which is why the two are not one pattern.
      expect(code, file).not.toMatch(/\bamountMinor\b/);
      expect(code, file).not.toMatch(/\bMoney\b/);
      expect(code, file).not.toMatch(/from "@tc\/contracts\/money"/);
    }
  });

  // The positive half. A console that showed dollars would have converted
  // somewhere, and "somewhere" is the bug: every stored number here is an
  // integer count of micro-dollars until the moment it is displayed.
  it("keeps micro-dollars as the unit all the way to the formatter", () => {
    const revenue = codeOf(path.join(WEB, "src/server/billing/revenue.ts"));
    expect(revenue).toMatch(/MicroUsd/);
    // The one conversion, named and constant, rather than a `/ 100` in a query.
    expect(revenue).toMatch(/MICRO_USD_PER_MINOR/);
  });
});

describe("the console is read-only over plan versions", () => {
  // The 2026-09-02 amendment. The two plan-version operations left M20 with the
  // `plan_versions` table; a publish or migrate path here is that being undone,
  // and a revenue screen is the surface most likely to want one ("change this
  // price from the console").
  it("has no publish or migrate path", () => {
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(4);
    for (const file of CONSOLE_FILES) {
      expect(codeOf(file), file).not.toMatch(/publishVersion|publishPlan|migrateAccount|migratePlan/i);
    }
  });

  // `version-conflict` has no referent once nobody publishes from a browser —
  // a git conflict is where that collision now happens. Its customer-facing
  // half DOES exist (SPEC §29's stale-version conflict on the confirm step),
  // and that is a different screen in a different module.
  it("has no version-conflict state", () => {
    for (const file of CONSOLE_FILES) {
      expect(codeOf(file), file).not.toMatch(/version-conflict|versionConflict/i);
    }
  });
});

describe("the underwater list stays segmented", () => {
  // **M21 link 7's hardest requirement, and the one whose breakage is
  // invisible.** A comped account is underwater by construction — a decision
  // already taken, not a finding — and on this deployment every account
  // predating M20's migration holds a permanent founder grant. Merged, they
  // swamp the list and nothing about the screen looks wrong.
  it("keeps the paying and grant-funded halves as separate fields", () => {
    const revenue = codeOf(path.join(WEB, "src/server/billing/revenue.ts"));
    expect(revenue).toMatch(/paying\s*:/);
    expect(revenue).toMatch(/grantFunded\s*:/);
    // And no single flattened list for a panel to render as one table.
    expect(revenue).not.toMatch(/allUnderwater|underwaterAccounts\s*:/);
  });

  it("renders them as two blocks, not one filtered table", () => {
    const panel = codeOf(path.join(ADMIN_COMPONENTS_DIR, "UnderwaterPanel.tsx"));
    expect(panel).toMatch(/report\.paying/);
    expect(panel).toMatch(/report\.grantFunded/);
    // The granted half is a COUNT, never an enumeration: a list of comped
    // accounts reads as the same kind of finding as the rows that need one.
    expect(panel).not.toMatch(/grantFunded\.map\([^)]*\)\s*=>\s*[^]*userId/);
  });
});

describe("ARPU is reported twice and labelled", () => {
  // Link 7 is emphatic: *"a single unlabelled ARPU will be quoted as whichever
  // is convenient."* Two fields, and two labels a person can tell apart.
  it("carries both figures on the wire", () => {
    const wire = codeOf(path.join(WEB, "src/lib/adminOverview.ts"));
    expect(wire).toMatch(/arpuAllMicroUsd/);
    expect(wire).toMatch(/arpuPayingMicroUsd/);
  });

  it("labels them differently on the screen", () => {
    const strip = readFileSync(path.join(ADMIN_COMPONENTS_DIR, "RevenueStrip.tsx"), "utf8");
    expect(strip).toMatch(/ARPU · all accounts/);
    expect(strip).toMatch(/ARPU · paying only/);
  });
});

describe("the report queue is read behind the gate", () => {
  // M12 link 6 put a second server read on this page. The header's rule is
  // that `notFound()` runs before ANY data is read, and it is easy to break by
  // hoisting a `Promise.all` above the gate for a few milliseconds of latency:
  // the page would still 404, having first loaded every open report — who
  // filed it and what they said — for a caller who is not an operator.
  it("calls listReports only after the admin check has run", () => {
    const page = codeOf(path.join(HERE, "page.tsx"));
    const gate = page.indexOf("notFound()");
    const read = page.indexOf("listReports(");
    expect(gate, "page.tsx no longer calls notFound()").toBeGreaterThan(-1);
    expect(read, "page.tsx no longer reads the report queue").toBeGreaterThan(-1);
    expect(page.indexOf("adminUserId()")).toBeGreaterThan(-1);
    expect(page.indexOf("adminUserId()")).toBeLessThan(gate);
    expect(gate).toBeLessThan(read);
  });
});
