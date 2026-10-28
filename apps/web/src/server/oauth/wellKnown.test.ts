import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { GET as serverMetadata } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";

// The two discovery routes, as a client reaches them. The Host-header case is
// amendment B: the issuer is ours to configure, never the requester's to name.

const PREVIEW = "https://travel-collab-git-m55.example.app";

afterEach(() => vi.unstubAllEnvs());

/** A request whose every origin-bearing header names somebody else. */
function forged(path: string): Request {
  return new Request(`https://evil.example${path}`, {
    headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
  });
}

const at = (...path: string[]) => ({ params: Promise.resolve(path.length === 0 ? {} : { path }) });

describe("/.well-known/oauth-protected-resource", () => {
  it("answers bare and with the MCP path, and 404s any other path", async () => {
    for (const path of [[], ["api", "mcp"]]) {
      const res = await resourceMetadata(forged("/.well-known/oauth-protected-resource"), at(...path));
      expect(res.status).toBe(200);
    }
    const other = await resourceMetadata(forged("/.well-known/oauth-protected-resource/api/v1"), at("api", "v1"));
    expect(other.status).toBe(404);
  });
});

describe("/.well-known/oauth-authorization-server", () => {
  it("answers bare and with the MCP path, and 404s any other path", async () => {
    for (const path of [[], ["api", "mcp"]]) {
      const res = await serverMetadata(forged("/.well-known/oauth-authorization-server"), at(...path));
      expect(res.status).toBe(200);
    }
    expect((await serverMetadata(forged("/x"), at("x"))).status).toBe(404);
  });
});

describe("a Host-header issuer", () => {
  it("names the configured origin as issuer and resource, whatever Host and X-Forwarded-Host say", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", PREVIEW.replace("https://", ""));
    const server = await (await serverMetadata(forged("/.well-known/oauth-authorization-server"), at())).json();
    const resource = await (
      await resourceMetadata(forged("/.well-known/oauth-protected-resource/api/mcp"), at("api", "mcp"))
    ).json();
    expect(server.issuer).toBe(PREVIEW);
    expect(server.token_endpoint).toBe(`${PREVIEW}/api/oauth/token`);
    expect(resource.resource).toBe(`${PREVIEW}/api/mcp`);
    expect(resource.authorization_servers).toEqual([PREVIEW]);
  });
});
