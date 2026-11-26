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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_SCOPES } from "@tc/contracts";
import { TOOLS } from "../../app/api/mcp/tools";
import { mcpToolScopes } from "../mcp/toolScopes";
import { config as proxyConfig } from "../../proxy";
import { GET as index } from "../../app/api/v1/route";
import { GET as catalog } from "../../app/.well-known/api-catalog/route";
import { GET as poppy } from "../../app/.well-known/poppy.json/route";
import { GET as securityTxt } from "../../app/.well-known/security.txt/route";
import { GET as llms } from "../../app/llms.txt/route";
import { GET as agentsMd } from "../../app/agents.md/route";
import { SECURITY_CONTACTS } from "@/lib/securityContacts";

// The configured origin these documents link against. Stubbed, not read from
// the request: the routes must name the deployment's public origin even when
// the request arrives on the container's bind address (see the bind-address
// test below).
beforeEach(() => {
  vi.stubEnv("PUBLIC_ORIGIN", "https://example.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
/** Whether the app serves `urlPath` as a route or a page. */
const served = (urlPath: string) => SERVED.has(urlPath);

describe("API discovery", () => {
  it("GET /api/v1 points at the served OpenAPI document and the reference page", async () => {
    const body = (await index().json()) as { openapi: string; docs: string };
    expect(served(body.openapi), body.openapi).toBe(true);
    expect(served(body.docs), body.docs).toBe(true);
  });

  it("/.well-known/api-catalog is an RFC 9727 linkset: service-desc the document, service-doc the reference", async () => {
    // The request arrives on the container's bind address, as it does in
    // production: the links must still name the configured origin, never it.
    const response = catalog(new Request("http://0.0.0.0:3000/.well-known/api-catalog"));
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

  it("/.well-known/api-catalog links /agents.md as the item's describedby", async () => {
    const response = catalog(new Request("http://0.0.0.0:3000/.well-known/api-catalog"));
    const body = (await response.json()) as { linkset: { describedby: { href: string; type: string }[] }[] };
    expect(body.linkset[0]!.describedby).toEqual([{ href: "https://example.test/agents.md", type: "text/markdown" }]);
  });
});

describe("/.well-known/poppy.json", () => {
  it("lists only APIs the app serves, on the configured origin", async () => {
    const body = (await poppy().json()) as { apis: { url: string }[] };
    expect(body.apis.length).toBeGreaterThan(0);
    for (const api of body.apis) {
      const { pathname } = new URL(api.url);
      expect(served(pathname), api.url).toBe(true);
    }
  });
});

describe("/.well-known/security.txt", () => {
  it("names its Canonical on the configured origin, not the bind address", async () => {
    const response = securityTxt(new Request("http://0.0.0.0:3000/.well-known/security.txt"));
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text).toContain("Canonical: https://example.test/.well-known/security.txt");
    expect(text).not.toContain("0.0.0.0");
  });

  // M63 D13: the page is the policy, and the contacts have one home.
  it("names /security as its Policy and takes its Contact lines from SECURITY_CONTACTS", async () => {
    const text = await securityTxt().text();
    expect(text.split("\n")).toContain("Policy: https://caesura.today/security");
    expect(served("/security")).toBe(true);
    const contacts = text.split("\n").filter((line) => line.startsWith("Contact: "));
    expect(contacts).toEqual(SECURITY_CONTACTS.map((contact) => `Contact: ${contact.href}`));
    expect(contacts).toEqual(["Contact: mailto:mitchell@demarcosoftware.com"]);
    expect(text.toLowerCase()).not.toContain("github");
  });

  it("keeps its Expires date", async () => {
    expect(await securityTxt().text()).toContain("Expires: 2027-10-01T00:00:00.000Z");
  });
});

describe("/llms.txt", () => {
  /** The served document for a request on the container's bind address, and its body. */
  const read = async () => {
    const response = llms(new Request("http://0.0.0.0:3000/llms.txt"));
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

  it("links the catalog, the OpenAPI document and the token path absolutely, on the configured origin", async () => {
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

  it("names the landing by its canonical address, /, not /welcome", async () => {
    expect((await read()).text).toContain("- [Caesura](https://example.test/): the landing page");
  });

  it("links only to routes and pages that exist", async () => {
    for (const href of links((await read()).text)) {
      const { pathname } = new URL(href);
      expect(served(pathname), href).toBe(true);
    }
  });

  it("says how a person mints a token, and lists every scope", async () => {
    const { text } = await read();
    expect(text).toContain("Account → Security → API tokens → New token");
    expect(text).toContain("Authorization: Bearer tc_");
    for (const scope of API_SCOPES) expect(text, scope).toContain(`- [${scope}](`);
  });

  // M55: an agent handed the host learns there is a connector, and where.
  it("names the MCP connector at the configured origin's /api/mcp", async () => {
    expect((await read()).text).toContain("- [MCP connector](https://example.test/api/mcp): ");
  });

  it("links /agents.md, absolutely, to a route that exists", async () => {
    expect(links((await read()).text)).toContain("https://example.test/agents.md");
    expect(served("/agents.md")).toBe(true);
  });

  it("links the AI page, absolutely, to a page that exists", async () => {
    expect(links((await read()).text)).toContain("https://example.test/ai");
    expect(served("/ai")).toBe(true);
  });

  it("does not send an agent looking for an invite: anyone can sign up (M50)", async () => {
    expect((await read()).text).not.toContain("invite code");
  });
});

describe("/agents.md", () => {
  const read = async () => {
    const response = agentsMd(new Request("http://0.0.0.0:3000/agents.md"));
    return { response, text: await response.text() };
  };

  it("answers 200 as markdown and lists every scope from the catalogue", async () => {
    const { response, text } = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    for (const scope of API_SCOPES) expect(text, scope).toContain(`\`${scope}\``);
  });

  // toolScopes.test covers the join; this holds the markdown rendering of it.
  it("renders one table row per MCP tool, with an `or` for a tool that takes either of two scopes", async () => {
    const { text } = await read();
    const rows = text.split("\n").filter((line) => line.startsWith("| `"));
    const tools = mcpToolScopes(TOOLS);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const row = rows.find((line) => line.startsWith(`| \`${tool.name}\` |`));
      expect(row, tool.name).toBeDefined();
      expect(row, tool.name).toContain(`\`${tool.scope}\``);
      if (tool.orScope !== undefined) expect(row, tool.name).toContain(` or \`${tool.orScope}\``);
    }
    expect(tools.some((tool) => tool.orScope !== undefined), "no tool with an orScope to check").toBe(true);
  });

  it("links /security, absolutely, to a page that exists", async () => {
    expect((await read()).text).toContain("](https://example.test/security)");
    expect(served("/security")).toBe(true);
  });

  // Signed out means outside the proxy: a path entry that reached it would
  // send a visitor with no session to /signin. The `ref` entry carries a `has`
  // condition, so it only fires on a launch link and only banks a cookie.
  it("is served signed out: no path entry of the proxy's matcher reaches it", async () => {
    const { getMiddlewareMatchers } = (await import("next/dist/build/analysis/get-page-static-info")) as unknown as {
      getMiddlewareMatchers: (matchers: unknown[], nextConfig: object) => { regexp: string }[];
    };
    const unconditional = proxyConfig.matcher.filter((m) => typeof m === "string");
    const reached = getMiddlewareMatchers(unconditional, {}).some((m) => new RegExp(m.regexp, "i").test("/agents.md"));
    expect(reached).toBe(false);
  });

  // The page is for an agent acting for a person, not for someone building
  // Caesura (M63 D2): nothing about how it is built, hosted or stored.
  it("never mentions how Caesura is built or run", async () => {
    const { text } = await read();
    for (const word of [
      "github", "AGENTS.md", "repository", "Neon", "Hetzner", "Coolify", "Vercel", "Next.js",
      "Scalar", "Strict-Transport-Security", "Content-Security-Policy",
    ]) {
      expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });
});
