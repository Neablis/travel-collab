// **The split, as a test** (M20 link 7's split note).
//
// > *"The console the design draws is not all M20's, and the screen does not
// > say which half is which. Its four-number strip — MRR and its movement,
// > ARPU twice and labelled, median margin per paying account over a trailing
// > 30 days — is M21 link 7. Same for the MRR and median-margin columns of the
// > per-tier panel. M20 builds the console WITHOUT the strip; M21 adds it. An
// > implementer working from the finished screen will build the strip inside
// > M20 and break the split in the direction `DRIFT.md` §2c only warns about
// > in reverse."*
//
// That is the failure this file exists to catch: not a bug, a **scope leak**,
// and one that would look like extra credit in review. Every one of those
// numbers needs a subscription to exist, and M20 takes no money.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

const ADMIN_COMPONENTS_DIR = path.join(WEB, "src/components/admin");
const ADMIN_COMPONENTS = readdirSync(ADMIN_COMPONENTS_DIR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => path.join(ADMIN_COMPONENTS_DIR, name));

const CONSOLE_FILES = [
  path.join(HERE, "page.tsx"),
  path.join(HERE, "layout.tsx"),
  // **Every component in the admin directory, read off disk rather than
  // listed.** This was two hand-written entries, and the list was wrong twice:
  // `GrantList` landed in the same phase as the sweep and was never added (so
  // revenue or pricing vocabulary could enter through the one component the
  // test did not read — CodeRabbit, PR #174), and then `GrantDialog` arrived
  // and would have repeated it exactly. A sweep whose coverage depends on
  // somebody remembering to extend it is a sweep with a hole per new file, so
  // the directory is the list. `ADMIN_COMPONENTS` below asserts it is not
  // empty, because a glob that matches nothing passes every assertion in here.
  ...ADMIN_COMPONENTS,
  path.join(WEB, "src/lib/adminOverview.ts"),
  path.join(WEB, "src/server/entitlements/admin.ts"),
  path.join(WEB, "src/app/api/admin/overview/route.ts"),
  path.join(WEB, "src/app/api/admin/grants/route.ts"),
];

/** Prose removed: a comment saying "MRR is M21's" is the rule, not a breach. */
const codeOf = (file: string) => stripComments(readFileSync(file, "utf8"));

// **The console may now name what a PLAN costs, and may still not name what an
// ACCOUNT pays.** That line moved on 2026-09-14 and it moved for one reason:
// M21 link 2 puts `price` on the plan-version record itself, and both wire
// shapes mirror that record field for field under a compile-time identity
// check. A price reaching `lib/adminOverview.ts` is therefore the plan file
// arriving, not the revenue strip arriving.
//
// Everything the split actually turns on is still refused below — MRR, ARPU,
// margin, underwater, subscription, invoice — because each needs a
// subscription and belongs to link 7, which has not built them yet. When it
// does, THIS file is the first thing to change, not a wall to route around.
//
// `stripePriceId` crosses with the record; `stripe` as a word does not, and
// this ONE file is exempted for it. `server/entitlements/admin.ts` passes the
// record through without naming any of its fields, so it needs no exemption —
// and it is deliberately not given one, because an exemption nothing needs is a
// hole nothing is watching.
const PLAN_RECORD_FILES = new Set([path.join(WEB, "src/lib/adminOverview.ts")]);

describe("M20's console has no revenue on it", () => {
  it("names no MRR, ARPU or margin anywhere", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(3);
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\bMRR\b/i);
      expect(code, file).not.toMatch(/\bARPU\b/i);
      expect(code, file).not.toMatch(/\bmargin\b/i);
      expect(code, file).not.toMatch(/\brevenue\b/i);
      expect(code, file).not.toMatch(/\bunderwater\b/i);
    }
  });

  // The other door the strip arrives through: M21's own vocabulary. None of
  // these exists yet, and a reference to one here would be M20 building into
  // M21 rather than beside it.
  it("names nothing a subscription would be needed for", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(3);
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\bsubscription/i);
      // `stripePriceId` is a field of the plan-version record (M21 link 2) and
      // rides across the wall with it; a Stripe CALL from the console is still
      // the thing being refused, and no such call can hide inside that one
      // identifier.
      if (!PLAN_RECORD_FILES.has(file)) expect(code, file).not.toMatch(/\bstripe/i);
      expect(code, file).not.toMatch(/\bwebhook/i);
      expect(code, file).not.toMatch(/\binvoice/i);
      expect(code, file).not.toMatch(/\bcheckout/i);
    }
  });

  it("carries no price", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(3);
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      // The two files that mirror the plan-version record carry its `price`
      // field and nothing else about money — see the note above.
      if (PLAN_RECORD_FILES.has(file)) continue;
      // `pric(e|ing)` as a whole word, so the ledger's honest `unpriced`
      // count — rows whose model has no published rate — is not mistaken for a
      // price the operator charges. Reporting those separately is the opposite
      // of the defect this sweeps for.
      expect(code, file).not.toMatch(/(?<![a-z])pric(e|ing)(?![a-z])/i);
      expect(code, file).not.toMatch(/priceMinor|stripePriceId|amountMinor|listPrice/i);
      expect(code, file).not.toMatch(/\bper month\b/i);
      // `$` appears in template literals; what must not appear is a currency
      // amount written out.
      expect(code, file).not.toMatch(/\$\s?\d/);
    }
  });

  // The tier panel is READ-ONLY over plans (the 2026-09-02 amendment). The two
  // plan-version operations left M20 with the table; a publish or migrate path
  // here is the amendment being undone.
  it("has no publish or migrate path over plan versions", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(3);
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/publishVersion|publishPlan|migrateAccount|migratePlan/i);
    }
  });

  // `version-conflict` has no referent once nobody publishes from a browser —
  // a git conflict is where that collision now happens, and it is better
  // handled there. Named explicitly because the design still lists it.
  it("has no version-conflict state", () => {
    // The witness floor this repo's own test guidance asks for: an empty or
    // mis-pathed glob would make every loop below vacuous.
    expect(ADMIN_COMPONENTS.length).toBeGreaterThanOrEqual(3);
    for (const file of CONSOLE_FILES) {
      expect(codeOf(file), file).not.toMatch(/version-conflict|versionConflict/i);
    }
  });
});
