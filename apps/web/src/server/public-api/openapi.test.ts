// **The docs cannot drift from the implementation** (Decision 9), enforced.
//
// This file is BOTH the generator and the check, on purpose. Two walks — one in
// a script, one in a test — would be two chances to disagree, which is the exact
// failure the derived-docs claim exists to rule out. Run with
// `pnpm --filter web openapi:generate` (which sets `UPDATE_OPENAPI=1`) to
// rewrite the committed file; run it any other way and it compares.
//
// So a schema changed without regenerating fails CI **in the same diff that
// changed it**, which is the repo's standing preference: caught by a test rather
// than by a reviewer noticing.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildOpenApi, routeModulePaths, urlOf } from "./openapi";
import { DECLARED, type DeclaredHandler } from "./route";

// Importing every v1 module pulls in `@/server/auth` and therefore `next-auth`,
// which does not resolve in the node test environment. Nothing here calls it —
// the declarations are read off the exported handlers without invoking them.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V1 = path.resolve(HERE, "../../app/api/v1");
const COMMITTED = path.join(V1, "openapi.json");

async function generate(): Promise<string> {
  const entries = [];
  for (const file of routeModulePaths(V1)) {
    entries.push({ url: urlOf(V1, file), module: (await import(file)) as Record<string, unknown> });
  }
  return `${JSON.stringify(buildOpenApi(entries), null, 2)}\n`;
}

describe("openapi.json is derived from the declarations", () => {
  it("matches what the routes currently declare", async () => {
    const generated = await generate();
    if (process.env.UPDATE_OPENAPI === "1") {
      writeFileSync(COMMITTED, generated);
      return;
    }
    expect(
      readFileSync(COMMITTED, "utf8"),
      "openapi.json is stale — run `pnpm --filter web openapi:generate`",
    ).toBe(generated);
  });

  it("documents every declared endpoint and invents none", async () => {
    const doc = JSON.parse(await generate()) as {
      paths: Record<string, Record<string, unknown>>;
    };

    // **Pairs, not a count.** This compared `Object.keys(doc.paths).length`
    // against the number of route FILES, which says nothing about which paths
    // came out and nothing at all about methods: a module declaring `GET` and
    // `POST` whose `POST` the generator dropped kept the path count identical
    // and passed. The claim being made is "every declared operation is
    // documented and no undeclared one is", so that is what is compared.
    const declared: string[] = [];
    for (const file of routeModulePaths(V1)) {
      const url = urlOf(V1, file);
      const exported = (await import(file)) as Record<string, unknown>;
      for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
        const handler = exported[method] as DeclaredHandler | undefined;
        if (handler?.[DECLARED] !== undefined) declared.push(`${method} ${url}`);
      }
    }

    const documented: string[] = [];
    for (const [url, methods] of Object.entries(doc.paths)) {
      for (const method of Object.keys(methods)) documented.push(`${method.toUpperCase()} ${url}`);
    }

    // `openapi/route.ts` serves the document and is deliberately absent from
    // it — the one exemption, and it is `GET /v1/openapi`.
    const expected = declared.filter((op) => op !== "GET /v1/openapi").sort();
    expect(documented.sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);

    // Path params are OpenAPI's `{tripId}`, never Next's `[tripId]`.
    for (const url of Object.keys(doc.paths)) {
      expect(url, url).not.toContain("[");
      expect(url.startsWith("/v1"), url).toBe(true);
    }
  });

  it("names the scope and the role on every operation", async () => {
    const doc = JSON.parse(await generate()) as {
      paths: Record<string, Record<string, { description: string; security: unknown[] }>>;
    };
    for (const [url, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        // A caller reading the reference must be able to see which scope to
        // ask for without trying the call and reading the 403.
        expect(operation.description, `${method} ${url}`).toContain("scope");
        expect(operation.security, `${method} ${url}`).toBeDefined();
      }
    }
  });
});
