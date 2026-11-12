import { afterEach, describe, expect, it, vi } from "vitest";
import { API_SCOPES, SCOPE_CATALOGUE, SCOPE_HINTS } from "@tc/contracts";
import { OAUTH_SCOPES } from "@/server/oauth/metadata";
import { poppyDocument } from "./discovery";

// What a Personal Agent reads first (Poppy spec 3.1). Each field below is one
// it checks before it will use the document at all.

afterEach(() => vi.unstubAllEnvs());

function production() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "caesura.today");
}

describe("poppyDocument", () => {
  it("carries the pinned version, the organization from the deployment origin, the issuer, and the sign-in details", () => {
    production();
    const doc = poppyDocument();
    expect(doc.protocol_version).toBe("0.4");
    expect(doc.organization).toMatchObject({ domain: "caesura.today", name: "Caesura" });
    // The issuer is the same one the OAuth metadata publishes; a validator
    // that only reads poppy.json derives the token endpoint from it.
    expect(doc.auth.issuer).toBe("https://caesura.today");
    expect(doc.auth.scopes).toMatchObject(
      Object.fromEntries(API_SCOPES.map((scope) => [scope, SCOPE_CATALOGUE[scope].description])),
    );
    expect(doc.auth.scope_hints).toEqual(SCOPE_HINTS);
  });

  it("describes every scope the metadata publishes, offline_access included", () => {
    production();
    // The kit's metadata.scopes-described check reads scopes_supported against this.
    for (const scope of OAUTH_SCOPES) {
      expect(poppyDocument().auth.scopes, scope).toHaveProperty([scope], expect.stringMatching(/\S/));
    }
  });

  it("lists the MCP server and the OpenAPI description, the website and the tasks endpoint, and no agent", () => {
    production();
    const doc = poppyDocument();
    expect(doc.apis).toEqual([
      expect.objectContaining({ type: "mcp", url: "https://caesura.today/api/mcp" }),
      expect.objectContaining({ type: "openapi", url: "https://caesura.today/api/v1/openapi" }),
    ]);
    expect(doc.web).toEqual({});
    expect(doc).not.toHaveProperty("agent");
    // Spec 3.1: the endpoint the Session-bound tasks and feedback are reached from.
    expect(doc.tasks).toEqual({ endpoint: "https://caesura.today/api/poppy/tasks" });
  });

  it("takes its origin from configuration, so a preview names the preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "travel-collab-git-m60.example.app");
    const doc = poppyDocument();
    expect(doc.organization.domain).toBe("travel-collab-git-m60.example.app");
    expect(doc.auth.issuer).toBe("https://travel-collab-git-m60.example.app");
    expect(doc.apis[0]!.url).toBe("https://travel-collab-git-m60.example.app/api/mcp");
  });
});
