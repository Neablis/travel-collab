import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizationServerMetadata, mcpResource, oauthIssuer, protectedResourceMetadata } from "./metadata";

// What a client reads before it trusts us with anything. Each field below is
// one a client checks, and a wrong one fails the connection or widens it.

afterEach(() => vi.unstubAllEnvs());

describe("the metadata documents", () => {
  it("names the MCP endpoint as the resource, exactly, under the configured origin", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "caesura.today");
    expect(protectedResourceMetadata()).toMatchObject({
      resource: "https://caesura.today/api/mcp",
      authorization_servers: ["https://caesura.today"],
      bearer_methods_supported: ["header"],
    });
    expect(mcpResource()).toBe("https://caesura.today/api/mcp");
    expect(oauthIssuer()).toBe("https://caesura.today");
  });

  it("offers S256 only, public clients only, CIMD and the iss parameter", () => {
    const metadata = authorizationServerMetadata();
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.scopes_supported).toContain("offline_access");
    expect(metadata.issuer).toBe(oauthIssuer());
  });
});
