import { afterEach, describe, expect, it, vi } from "vitest";
import { API_SCOPES, SCOPE_CATALOGUE, SCOPE_HINTS } from "@tc/contracts";
import { OAUTH_SCOPES } from "@/server/oauth/metadata";
import { poppyDocument, poppyDocument04 } from "./discovery";

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
    expect(doc.protocol_version).toBe("1.0");
    // Poppy 1.0 §3.4: the pinned version, and the older ones still served —
    // as a map from version to that version's document URL, not a list: the
    // official 1.0 kit validator's discovery.schema fails an array.
    expect(doc.supported_versions).toEqual({ "0.4": "https://caesura.today/.well-known/poppy-0.4.json" });
    expect(doc.organization).toMatchObject({ domain: "caesura.today", name: "Caesura" });
    // Spec 1.0 §3.1: when present, auth.issuer MUST name the one server the
    // protected resource metadata lists, which is the OAuth issuer.
    expect(doc.auth.issuer).toBe("https://caesura.today");
    expect(doc.auth.scopes).toMatchObject(
      Object.fromEntries(API_SCOPES.map((scope) => [scope, SCOPE_CATALOGUE[scope].description])),
    );
    expect(doc.auth.scope_hints).toEqual(SCOPE_HINTS);
  });

  it("serves the 0.4 document supported_versions links to: 0.4, no supported_versions, same company", () => {
    production();
    const doc = poppyDocument04();
    expect(doc.protocol_version).toBe("0.4");
    // Spec 3.4 (discovery.supported-versions): a linked document is exactly
    // one version's document, so it carries no supported_versions of its own.
    expect(doc).not.toHaveProperty("supported_versions");
    // Spec 3.4 (discovery.versions-same-company): the linked document names
    // the same domain and issuer as the 1.0 document.
    const one = poppyDocument();
    expect(doc.organization).toEqual(one.organization);
    expect(doc.auth.issuer).toBe(one.auth.issuer);
    expect(doc.apis).toEqual(one.apis);
    expect(doc.tasks).toEqual(one.tasks);
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
    expect(doc.supported_versions).toEqual({
      "0.4": "https://travel-collab-git-m60.example.app/.well-known/poppy-0.4.json",
    });
  });
});
