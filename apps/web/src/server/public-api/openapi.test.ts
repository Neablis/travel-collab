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
import {
  API_FINGERPRINT,
  API_VERSION,
  buildOpenApi,
  fingerprintOf,
  routeModulePaths,
  urlOf,
  withoutTupleItems,
} from "./openapi";
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

  // **A changed document is a new version.** `info.version` stayed "1.0.0"
  // through two contract changes because nothing tied it to the document. This
  // does: the fingerprint excludes `info.version` itself, so the only way to
  // make this pass after changing a schema, a summary or the scope text is to
  // record the new fingerprint — beside `API_VERSION`, in the same diff, where
  // a reviewer sees whether the version moved with it. Runs under
  // `openapi:generate` too, so regenerating prints the value to paste.
  it("records the fingerprint of the document its info.version was published for", async () => {
    const doc = JSON.parse(await generate()) as Parameters<typeof fingerprintOf>[0];
    expect(doc.info.version).toBe(API_VERSION);
    const fingerprint = fingerprintOf(doc);
    expect(
      fingerprint,
      `The published API document changed but its version record did not. In openapi.ts, bump ` +
        `API_VERSION (now ${API_VERSION}) by semver — patch for prose only, minor for additive, major ` +
        `for breaking — set API_FINGERPRINT to "${fingerprint}", and add a docs/contracts/CHANGELOG.md line.`,
    ).toBe(API_FINGERPRINT);
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

  // OpenAPI 3.0's `items` is one Schema Object; the array form is a draft-04
  // tuple that 3.0 does not have. Six of them made the document invalid and
  // broke the Scalar reference (see `withoutTupleItems`).
  it("never publishes a tuple-form `items`, which OpenAPI 3.0 does not have", async () => {
    const tuples: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${at}/${i}`));
      else if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "items" && Array.isArray(value)) tuples.push(`${at}/items`);
          walk(value, `${at}/${key}`);
        }
      }
    };
    walk(JSON.parse(await generate()), "");
    expect(tuples).toEqual([]);
  });

  // The rewrite above only knows how to make an *empty* tuple valid. A
  // non-empty one cannot be expressed in 3.0 without widening the contract, so
  // the generator must refuse it and say where — not quietly publish `anyOf`.
  it("refuses a non-empty tuple, naming its JSON path, instead of widening it", () => {
    const schema = {
      type: "object",
      properties: {
        empty: { type: "array", items: [], maxItems: 0 },
        pair: { type: "array", items: [{ type: "string" }, { type: "number" }], minItems: 2, maxItems: 2 },
      },
    };
    expect(() => withoutTupleItems(schema)).toThrow(
      /non-empty tuple at #\/properties\/pair\/items \(2 positions\)/,
    );
    expect(withoutTupleItems({ items: [], maxItems: 0 })).toEqual({ items: {}, maxItems: 0 });
  });

  // The page tree is the document's one recursive schema. It is generated
  // once as `components.schemas.PageNode`, and every route that carries page
  // content references it — so the recursion is a real `$ref`, nested content
  // is the node union rather than `any`, and no `$ref` points anywhere the
  // document does not define (an inline-path `$ref` would break once the
  // per-route schema is embedded under `paths`).
  it("publishes the recursive page tree as one shared $ref component", async () => {
    const doc = JSON.parse(await generate()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    const pageNode = doc.components.schemas["PageNode"];
    expect(pageNode, "components.schemas.PageNode exists").toBeDefined();

    // Every `$ref` under `node`, collected with a single walk.
    const refsUnder = (node: unknown): string[] => {
      const refs: string[] = [];
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n === null || typeof n !== "object") return;
        for (const [key, value] of Object.entries(n)) {
          if (key === "$ref" && typeof value === "string") refs.push(value);
          else walk(value);
        }
      };
      walk(node);
      return refs;
    };

    // Resolve an internal `$ref` against the document root, per RFC 6901.
    // Returns undefined when any segment is missing — a dangling ref.
    const resolveRef = (root: unknown, ref: string): unknown => {
      if (!ref.startsWith("#/")) return undefined;
      let node: unknown = root;
      for (const raw of ref.slice(2).split("/")) {
        const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
        if (node === null || typeof node !== "object" || !(key in node)) return undefined;
        node = (node as Record<string, unknown>)[key];
      }
      return node;
    };

    // Every $ref in the document names a component schema — none dangles at
    // an inline path or a `#/definitions/` the rewrite missed.
    const allRefs = refsUnder(doc);
    expect(allRefs.length).toBeGreaterThan(0);
    for (const ref of allRefs) {
      expect(ref, `ref ${ref} names a component schema`).toMatch(/^#\/components\/schemas\//);
      expect(resolveRef(doc, ref), `ref ${ref} resolves`).toBeDefined();
    }

    // The component refers to ITSELF: that self-reference is the recursion,
    // expressed instead of the old `any` fallback.
    const componentRefs = refsUnder(pageNode);
    expect(
      componentRefs.filter((r) => r === "#/components/schemas/PageNode"),
      "PageNode references itself",
    ).not.toEqual([]);

    // And routes that carry page content point at it rather than inlining it.
    const pathRefs = refsUnder(doc.paths);
    expect(
      pathRefs.filter((r) => r === "#/components/schemas/PageNode"),
      "at least one route references the PageNode component",
    ).not.toEqual([]);
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

  // PR #354 review: the server sends a Discover card's `cover` on every card,
  // null for none, so the document must not call it optional — as the app's
  // own defaulted `DiscoverDay.cover` would have it published.
  it("publishes a Discover card's cover as always present, and null for none", async () => {
    const doc = JSON.parse(await generate()) as {
      paths: Record<string, { get: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }>;
    };
    const page = doc.paths["/v1/discover/playbooks"]!.get.responses["200"]!.content["application/json"]!.schema as {
      properties: { items: { items: { required: string[]; properties: Record<string, { nullable?: boolean; default?: unknown }> } } };
    };
    const card = page.properties.items.items;
    expect(card.required).toContain("cover");
    expect(card.properties.cover).toMatchObject({ nullable: true });
    expect(card.properties.cover).not.toHaveProperty("default");
  });

  // **A summary says what the call does, not where it lives.** Every operation
  // used to be titled `"GET /v1/…"`, and an external agent reading the reference
  // never found the place search behind `GET …/geocode`. The type makes a
  // summary required; this makes sure the generator publishes it rather than
  // falling back to restating the path.
  it("titles every operation with its declared summary, never its path", async () => {
    const doc = JSON.parse(await generate()) as {
      paths: Record<string, Record<string, { summary: string }>>;
    };
    for (const [url, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const op = `${method.toUpperCase()} ${url}`;
        expect(operation.summary, op).not.toContain(url);
        expect(operation.summary.split(" ").length, op).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
