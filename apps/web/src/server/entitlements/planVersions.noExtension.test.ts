// **The box M20 says is a one-way door.**
//
// > *"No plan is defined in terms of another. `premium` enumerates its own
// > entitlements; a test fails if any plan definition spreads, extends or
// > otherwise references another plan, and if any authorisation path reads a
// > plan's display order. This is the requirement the design most easily loses,
// > and losing it silently is what makes the ladder permanent."*
//
// The three launch plans happen to nest, so every cheap move works today and
// only fails years later, when the first plan that grants `trip.collaborators`
// without `ai.command` cannot be expressed without unpicking every reader. That
// is why this is written in Phase 1 rather than after there is something to
// catch.
//
// **It reads the AST, not the text.** A regex for `...` is defeated by a
// newline, a comment, `Object.assign`, `.concat`, a `structuredClone` or a
// helper three lines up. Walking the syntax tree of the plan definitions and
// requiring every leaf to be a LITERAL is the only form of this check that
// cannot be routed around: there is no way to reference another plan without
// putting an identifier or a call inside the definition, and neither is
// allowed here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";
import ts from "typescript";
import { Entitlement, PLAN_IDS } from "@tc/contracts";
import { PLAN_VERSIONS } from "./planVersions";

const PLAN_FILE = fileURLToPath(new URL("./planVersions.ts", import.meta.url));
const SOURCE = readFileSync(PLAN_FILE, "utf8");
const AST = ts.createSourceFile(PLAN_FILE, SOURCE, ts.ScriptTarget.ESNext, true);
/** The file with its prose removed — for the sweeps that are about code, not about comments. */
const CODE = stripComments(SOURCE);

/** The `PLAN_VERSIONS = [...]` initializer — the plan definitions themselves. */
function planVersionsInitializer(): ts.ArrayLiteralExpression {
  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "PLAN_VERSIONS" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(AST);
  if (!found) throw new Error("PLAN_VERSIONS is no longer an array literal — read this file's header.");
  return found;
}

/** Every node inside the plan definitions, depth first. */
function nodesInDefinitions(): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    out.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(planVersionsInitializer(), visit);
  return out;
}

describe("no plan is defined in terms of another", () => {
  // The literal shape of the rule: a plan definition is data, and data has no
  // identifiers in it. `[...PLUS, "trip.collaborators"]` fails here on `PLUS`;
  // so does `PLUS_ENTITLEMENTS`, `BASE.entitlements`, and a `premium` entry
  // that says `entitlements: plusEntitlements()`.
  //
  // Property names are allowed (they are the object's own keys, not a
  // reference to anything) and so are the `true`/`false`/`null` keywords, which
  // are their own node kinds rather than identifiers.
  it("contains no identifier at all inside any plan definition", () => {
    const identifiers = nodesInDefinitions()
      .filter(ts.isIdentifier)
      .filter((node) => {
        const parent = node.parent;
        // `entitlements:` in `{ entitlements: [...] }` is a key, not a read.
        return !(ts.isPropertyAssignment(parent) && parent.name === node);
      })
      .map((node) => node.text);
    expect(identifiers).toEqual([]);
  });

  // The mechanisms an extension would have to arrive through, each checked as a
  // node kind rather than as text. A spread is the one the milestone names; the
  // other three are what someone reaches for once a spread is blocked.
  it("uses no spread, no call, no property access and no conditional", () => {
    const offenders = nodesInDefinitions().filter(
      (node) =>
        ts.isSpreadElement(node) ||
        ts.isSpreadAssignment(node) ||
        ts.isCallExpression(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node) ||
        ts.isConditionalExpression(node) ||
        ts.isBinaryExpression(node) ||
        ts.isTemplateExpression(node),
    );
    expect(offenders.map((node) => node.getText(AST))).toEqual([]);
  });

  // Every entitlement is written out, in the plan's own entry, as a string
  // literal from the contracts enum. This is the positive statement of the same
  // rule, and it is what makes `premium` repeating `plus`'s two strings a
  // requirement rather than duplication to tidy away.
  it("enumerates every entitlement as a literal from the contracts vocabulary", () => {
    for (const entry of planVersionsInitializer().elements) {
      expect(ts.isObjectLiteralExpression(entry)).toBe(true);
      const properties = (entry as ts.ObjectLiteralExpression).properties;
      const entitlements = properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "entitlements",
      ) as ts.PropertyAssignment | undefined;
      expect(entitlements).toBeDefined();
      const list = entitlements!.initializer;
      expect(ts.isArrayLiteralExpression(list)).toBe(true);
      for (const element of (list as ts.ArrayLiteralExpression).elements) {
        expect(ts.isStringLiteral(element)).toBe(true);
        expect(Entitlement.options).toContain((element as ts.StringLiteral).text);
      }
    }
  });

  // A runtime restatement, so the rule survives someone rewriting the file in a
  // shape this AST walk does not recognise: the arrays are distinct objects, so
  // no entry is holding another's list.
  it("gives every version its own entitlement array", () => {
    const arrays = PLAN_VERSIONS.map((entry) => entry.entitlements);
    expect(new Set(arrays).size).toBe(arrays.length);
  });
});

describe("the ladder is presentation only", () => {
  // `displayOrder` exists so a pricing page can sort three cards. The moment an
  // authorisation path reads it, the ladder is in the data and the first
  // non-nested plan is unexpressible.
  //
  // Allowlisted files are the definition itself and rendering. Phase 6's admin
  // console joins this list when it lands; a *gate* joining it is the failure
  // this test exists to catch.
  const DISPLAY_ORDER_READERS_ALLOWED = [
    "src/server/entitlements/planVersions.ts",
    "src/server/entitlements/planVersions.noExtension.test.ts",
    // **Rendering, which is what the field is for.** The operator console
    // carries a plan's display order across the wire so a pricing page can one
    // day sort three cards by it; neither of these compares two plans with it,
    // and a GATE joining this list is the failure this test exists to catch.
    //
    // `server/entitlements/admin.ts` is deliberately NOT here: it hands whole
    // `PlanVersion` objects to the console without naming this field, so it
    // never appears in its source. Exact equality rather than a subset, so an
    // allowlist entry that stops being needed fails too.
    "src/lib/adminOverview.ts",
  ];

  // **The file's declaration order and `displayOrder` agree**, and that is now a
  // checked fact rather than a coincidence.
  //
  // `accountPlan.ts` builds the account sheet's plan chooser and needs the
  // plans in the order a person should read them. Sorting by `displayOrder`
  // there put the ladder inside a module that also resolves entitlements, and
  // this suite refused it in CI — correctly, per the rule above. It takes the
  // file's own order instead, which is only safe while the two agree. This
  // asserts they do, from inside the one file already allowed to name the
  // field, so a future edit that reorders the plans without moving their
  // `displayOrder` fails here instead of quietly reordering a pricing page.
  it("declares plans in the order the ladder claims", () => {
    const firstVersionPerPlan = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))].map(
      (planId) => PLAN_VERSIONS.find((entry) => entry.planId === planId)!,
    );
    const ladder = firstVersionPerPlan.map((entry) => entry.displayOrder);
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
  });

  it("is read by no authorisation path", () => {
    const root = path.resolve(path.dirname(PLAN_FILE), "../../..");
    const hits = grepRepo(root, /\bdisplayOrder\b/);
    expect(hits.sort()).toEqual([...DISPLAY_ORDER_READERS_ALLOWED].sort());
  });

  // The other half of *a plan is a set, not a rank*: nothing anywhere compares
  // two plans. `PLAN_IDS` exists to iterate, and iterating is not ordering.
  it("defines no rank over plans", () => {
    const code = CODE;
    // Substring, not `\b`-delimited: `PLAN_RANK` has no word boundary before
    // `RANK`, so a `\b`-anchored alternation misses the exact constant this
    // refuses. Found by writing the constant and watching the test pass.
    expect(code).not.toMatch(/rank|atleast|tierof|compareplans|ordinal/i);
    // A rank needs an index into an ordered list of plan ids.
    expect(code).not.toMatch(/PLAN_IDS\s*\.\s*indexOf/);
    // Four, since the fourth-plan proof landed — three sold and one disabled.
    expect(PLAN_IDS.length).toBe(4);
  });
});

describe("M20 publishes versions that are free by construction", () => {
  // M21 link 2 adds `priceMinor`, `currency` and `stripePriceId` to these same
  // entries. A price here today means the M20/M21 split failed — which is the
  // one thing both milestone files say in the same words.
  it("carries no price of any kind", () => {
    // Comments are stripped first: the header explains the rule by naming the
    // fields M21 adds, and a sentence saying "no price here" is not a price.
    expect(CODE).not.toMatch(/\b(price|priceMinor|amountMinor|currency|stripe|usd|money)\b/i);
    for (const entry of PLAN_VERSIONS) {
      const keys = Object.keys(entry);
      expect(keys.filter((key) => /price|currency|stripe|money|amount/i.test(key))).toEqual([]);
    }
  });
});

describe("a published entry is append-only", () => {
  // The gate box: *"Editing `premium`'s entitlements or ceilings creates `v2`;
  // `v1`'s entry is byte-identical afterwards."* Git is the audit trail, and
  // this is the mechanical half of it — v1 is pinned here field by field, so
  // editing a published entry in place fails a test in the same diff that does
  // it, rather than being caught only if a reviewer notices.
  //
  // **Publishing `v2` does not touch this test.** Adding an entry is expected;
  // changing one of these three is not.
  const V1_AS_PUBLISHED = [
    {
      planId: "free",
      version: 1,
      entitlements: [],
      ceilings: { perUserRequestsPerDay: 0, perUserStepsPerDay: 0, maxTier: null },
      displayOrder: 1,
      publishedAt: "2026-09-13",
      enabled: true,
    },
    {
      planId: "plus",
      version: 1,
      entitlements: ["ai.ask", "ai.command"],
      ceilings: { perUserRequestsPerDay: 50, perUserStepsPerDay: 400, maxTier: null },
      displayOrder: 2,
      publishedAt: "2026-09-13",
      enabled: true,
    },
    {
      planId: "premium",
      version: 1,
      entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
      ceilings: { perUserRequestsPerDay: 200, perUserStepsPerDay: 1600, maxTier: null },
      displayOrder: 3,
      publishedAt: "2026-09-13",
      enabled: true,
    },
  ];

  it("still grants exactly what v1 was published granting", () => {
    for (const published of V1_AS_PUBLISHED) {
      const live = PLAN_VERSIONS.find(
        (entry) => entry.planId === published.planId && entry.version === 1,
      );
      expect(live).toBeDefined();
      expect(JSON.parse(JSON.stringify(live))).toEqual(published);
    }
  });

  // Frozen, so "no code path can update a published entry" is enforced at
  // runtime and not only promised by `readonly`.
  it("throws rather than accepting a mutation", () => {
    const premium = PLAN_VERSIONS.find((entry) => entry.planId === "premium")!;
    expect(() => {
      (premium as { displayOrder: number }).displayOrder = 99;
    }).toThrow();
    expect(() => {
      (premium.entitlements as Entitlement[]).push("trip.collaborators");
    }).toThrow();
    expect(() => {
      (PLAN_VERSIONS as PlanVersionArray).push(premium);
    }).toThrow();
  });
});

type PlanVersionArray = (typeof PLAN_VERSIONS)[number][];

/** Every repo-relative file under `src/` whose text matches, excluding build output. */
function grepRepo(root: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (pattern.test(readFileSync(full, "utf8"))) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
}
