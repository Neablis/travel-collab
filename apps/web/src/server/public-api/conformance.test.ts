// **What makes "the directory is the registry" true rather than intended**
// (M22 Phase 2, Decision 11).
//
// The public API has no registry file, deliberately: a route is public if and
// only if its module lives under `src/app/api/v1/**`. The Next.js file router
// already decides the URL and cannot drift from itself, and a hand-kept list
// beside it is exactly the second copy AGENTS.md invariant 5 and ADR-037 exist
// to forbid.
//
// The cost of having no list is that nothing stops a hurried future session from
// writing `export async function GET` under `v1/` and shipping an endpoint with
// no scope, no response schema, no rate limit and no error envelope. **This file
// is what stops it.** It walks the directory, imports every module, and fails on
// any exported method that did not come through `route()`.
//
// It follows the repo's own precedent of proving a claim rather than asserting
// it — `planVersions.fourthPlan.test.ts`, `moduleBoundary.test.ts`,
// `check-lint-wall.mjs`.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ApiScope } from "@tc/contracts";
import { DECLARED, type DeclaredHandler } from "./route";

// This test IMPORTS every v1 module, which transitively pulls in `@/server/auth`
// and therefore `next-auth`, which does not resolve in the node test
// environment. Nothing here calls it — the brand is read off the exported
// function without invoking it — so a stub is enough and is honest: what is
// under test is the shape of the declaration, not what it does.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V1 = path.resolve(HERE, "../../app/api/v1");

/** Every `route.ts` under `v1/`, which is every public endpoint by definition. */
function routeModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") out.push(full);
    }
  };
  walk(V1);
  return out.sort();
}

const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"] as const;

const RELATIVE = (full: string) => path.relative(path.resolve(HERE, "../.."), full).split(path.sep).join("/");

describe("every v1 route declares itself through route()", () => {
  // If this finds nothing, the sweep below is vacuous and every other test in
  // this file passes by inspecting an empty list. Phase 2 ships two pilots.
  it("finds the public surface at all", () => {
    expect(routeModules().length).toBeGreaterThan(0);
  });

  it("has no raw handler anywhere under v1", async () => {
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const mod: Record<string, unknown> = await import(file);
      for (const method of HTTP_METHODS) {
        const exported = mod[method];
        if (exported === undefined) continue;
        // **The brand is the whole check.** `route()` stamps every handler it
        // builds; a hand-written `export async function GET` is a function like
        // any other and carries nothing.
        if (typeof exported !== "function" || (exported as DeclaredHandler)[DECLARED] === undefined) {
          offenders.push(`${RELATIVE(file)} exports a raw ${method}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares a scope from the contracts vocabulary on every method", async () => {
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const mod: Record<string, unknown> = await import(file);
      for (const method of HTTP_METHODS) {
        const handler = mod[method] as DeclaredHandler | undefined;
        const declared = handler?.[DECLARED];
        if (declared === undefined) continue;
        if (!ApiScope.safeParse(declared.scope).success) {
          offenders.push(`${RELATIVE(file)} ${method} declares scope "${String(declared.scope)}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A route that is about a trip must say what role it needs. Without this a
  // `trip: "path"` declaration silently falls back to `viewer`, which is the
  // safe default for a read and a disaster for a write.
  it("declares a role wherever it declares a trip, and neither without the other", async () => {
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const mod: Record<string, unknown> = await import(file);
      for (const method of HTTP_METHODS) {
        const declared = (mod[method] as DeclaredHandler | undefined)?.[DECLARED];
        if (declared === undefined) continue;
        if (declared.trip !== undefined && declared.role === undefined) {
          offenders.push(`${RELATIVE(file)} ${method} is about a trip and names no role`);
        }
        if (declared.trip === undefined && declared.role !== undefined) {
          offenders.push(`${RELATIVE(file)} ${method} names a role and no trip for it to apply to`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // **No scope may name a surface Mitchell excluded at placement.** The scope
  // enum already cannot express one; this catches the other direction — a v1
  // file that reaches admin or AI code regardless of what it declared.
  it("reaches no admin surface and no AI surface", async () => {
    const { readFileSync } = await import("node:fs");
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "server/admission",
        "requireAdminApi",
        "handleAskRequest",
        "api/admin",
        "modelSelection",
      ]) {
        if (source.includes(forbidden)) offenders.push(`${RELATIVE(file)} reaches ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
