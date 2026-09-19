// **The two discovery documents point at a reference that exists.**
//
// `GET /api/v1` and `GET /.well-known/api-catalog` each hard-code where the
// OpenAPI document is served. Nothing else ties those strings to the route that
// serves it, so moving `openapi/route.ts` would leave both answering 200 with a
// link to a 404 — the exact dead end they exist to prevent.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET as index } from "../../app/api/v1/route";
import { GET as catalog } from "../../app/.well-known/api-catalog/route";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");

/** `/api/v1/openapi` → does `app/api/v1/openapi/route.ts` exist. */
const served = (urlPath: string) => existsSync(path.join(APP, urlPath, "route.ts"));

describe("API discovery", () => {
  it("GET /api/v1 points at the served OpenAPI document", async () => {
    const body = (await index().json()) as { openapi: string };
    expect(served(body.openapi), body.openapi).toBe(true);
  });

  it("/.well-known/api-catalog is an RFC 9727 linkset whose service-desc is that document", async () => {
    const response = catalog(new Request("https://example.test/.well-known/api-catalog"));
    expect(response.headers.get("content-type")).toMatch(/^application\/linkset\+json/);
    const body = (await response.json()) as {
      linkset: { anchor: string; "service-desc": { href: string }[] }[];
    };
    const href = new URL(body.linkset[0]!["service-desc"][0]!.href);
    expect(href.origin).toBe("https://example.test");
    expect(served(href.pathname), href.pathname).toBe(true);
  });
});
