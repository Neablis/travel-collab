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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

const CONSOLE_FILES = [
  path.join(HERE, "page.tsx"),
  path.join(HERE, "layout.tsx"),
  path.join(WEB, "src/components/admin/GrantForm.tsx"),
  path.join(WEB, "src/lib/adminOverview.ts"),
  path.join(WEB, "src/server/entitlements/admin.ts"),
  path.join(WEB, "src/app/api/admin/overview/route.ts"),
  path.join(WEB, "src/app/api/admin/grants/route.ts"),
];

/** Prose removed: a comment saying "MRR is M21's" is the rule, not a breach. */
const codeOf = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("M20's console has no revenue on it", () => {
  it("names no MRR, ARPU or margin anywhere", () => {
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
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\bsubscription/i);
      expect(code, file).not.toMatch(/\bstripe/i);
      expect(code, file).not.toMatch(/\bwebhook/i);
      expect(code, file).not.toMatch(/\binvoice/i);
      expect(code, file).not.toMatch(/\bcheckout/i);
    }
  });

  // **No price string in M20's diff, anywhere**, and the console is the surface
  // most likely to grow one: it is where an operator would want to see what a
  // plan costs.
  it("carries no price", () => {
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
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
    for (const file of CONSOLE_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/publishVersion|publishPlan|migrateAccount|migratePlan/i);
    }
  });

  // `version-conflict` has no referent once nobody publishes from a browser —
  // a git conflict is where that collision now happens, and it is better
  // handled there. Named explicitly because the design still lists it.
  it("has no version-conflict state", () => {
    for (const file of CONSOLE_FILES) {
      expect(codeOf(file), file).not.toMatch(/version-conflict|versionConflict/i);
    }
  });
});

describe("the wire shape the page reads mirrors the server's", () => {
  // `src/lib/adminOverview.ts` restates the server's types because the lint
  // wall forbids a page importing `@/server/*`. Two declarations of one shape
  // can drift, so the fields are compared by name — the same trade
  // `apiClient.ts` makes for its duplicated refusal codes.
  it("declares the same top-level fields on both sides", () => {
    const fieldsOf = (source: string, name: string): string[] => {
      const body = source.slice(source.indexOf(`interface ${name} {`));
      const inner = body.slice(body.indexOf("{") + 1, body.indexOf("\n}"));
      return [...inner.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((match) => match[1]!).sort();
    };
    const ui = readFileSync(path.join(WEB, "src/lib/adminOverview.ts"), "utf8");
    const server = readFileSync(path.join(WEB, "src/server/entitlements/admin.ts"), "utf8");
    expect(fieldsOf(ui, "AdminOverview")).toEqual(fieldsOf(server, "AdminOverview"));
    expect(fieldsOf(ui, "AdminAccountRow")).toEqual(fieldsOf(server, "AdminAccountRow"));
  });
});
