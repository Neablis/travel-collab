// **The discovery documents point at things that exist.**
//
// `GET /api/v1`, `GET /.well-known/api-catalog` and `GET /llms.txt` each
// hard-code where the reference, the developers page and the OpenAPI document
// are served. Nothing else ties those strings to the routes and pages that
// serve them, so moving one would leave all three answering 200 with a link to
// a 404 — the exact dead end they exist to prevent.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_SCOPES } from "@tc/contracts";
import { GET as index } from "../../app/api/v1/route";
import { GET as catalog } from "../../app/.well-known/api-catalog/route";
import { GET as llms } from "../../app/llms.txt/route";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");

/**
 * Every URL path the app directory serves with a `route.ts` or a `page.tsx`,
 * route groups (`(front)`) dropped the way Next drops them.
 */
function servedPaths(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const group = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(path.join(dir, entry.name), group ? segments : [...segments, entry.name]);
      } else if (entry.name === "route.ts" || entry.name === "page.tsx") {
        out.add(`/${segments.join("/")}`);
      }
    }
  };
  walk(APP, []);
  return out;
}

const SERVED = servedPaths();
const served = (urlPath: string) => SERVED.has(urlPath);

describe("API discovery", () => {
  it("GET /api/v1 points at the served OpenAPI document and the reference page", async () => {
    const body = (await index().json()) as { openapi: string; docs: string };
    expect(served(body.openapi), body.openapi).toBe(true);
    expect(served(body.docs), body.docs).toBe(true);
  });

  it("/.well-known/api-catalog is an RFC 9727 linkset: service-desc the document, service-doc the reference", async () => {
    const response = catalog(new Request("https://example.test/.well-known/api-catalog"));
    expect(response.headers.get("content-type")).toMatch(/^application\/linkset\+json/);
    const body = (await response.json()) as {
      linkset: { anchor: string; "service-desc": { href: string }[]; "service-doc": { href: string }[] }[];
    };
    const desc = new URL(body.linkset[0]!["service-desc"][0]!.href);
    expect(desc.origin).toBe("https://example.test");
    expect(served(desc.pathname), desc.pathname).toBe(true);
    const doc = new URL(body.linkset[0]!["service-doc"][0]!.href);
    expect(doc.origin).toBe("https://example.test");
    expect(doc.pathname).toBe("/developers/reference");
    expect(served(doc.pathname), doc.pathname).toBe(true);
  });
});

describe("/llms.txt", () => {
  const read = async () => {
    const response = llms(new Request("https://example.test/llms.txt"));
    return { response, text: await response.text() };
  };
  /** Every markdown link target in the document. */
  const links = (text: string) => [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);

  it("is plain text in llmstxt.org's shape: an H1, then a one-line summary", async () => {
    const { response, text } = await read();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const [h1, blank, summary] = text.split("\n");
    expect(h1).toBe("# Caesura");
    expect(blank).toBe("");
    expect(summary).toMatch(/^> \S/);
  });

  it("links the catalog, the OpenAPI document and the token path absolutely, on the request's origin", async () => {
    const targets = links((await read()).text);
    for (const href of [
      "https://example.test/.well-known/api-catalog",
      "https://example.test/api/v1/openapi",
      "https://example.test/developers",
      "https://example.test/developers/reference",
    ]) {
      expect(targets).toContain(href);
    }
    for (const href of targets) expect(new URL(href).origin, href).toBe("https://example.test");
  });

  it("links only to routes and pages that exist", async () => {
    for (const href of links((await read()).text)) {
      const { pathname } = new URL(href);
      expect(served(pathname), href).toBe(true);
    }
  });

  it("says how a person mints a token, and lists every scope", async () => {
    const { text } = await read();
    expect(text).toContain("Account → Profile → API tokens → New token");
    expect(text).toContain("Authorization: Bearer tc_");
    for (const scope of API_SCOPES) expect(text, scope).toContain(`- [${scope}](`);
  });
});
