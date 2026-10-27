// **`/api/mcp` as a client meets it** (ADR-083 §8), against a real database:
// the credential is answered before any MCP is read, the server is stateless
// and answers JSON, and a tool call works whether or not the client sends the
// 2026-07-28 revision's `Mcp-Method` / `Mcp-Name` headers.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiScope } from "@tc/contracts";
import { mintToken } from "@/server/api-tokens";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";
import { revokeSecret } from "@/server/oauth/tokens";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { upsertUser } from "@/server/users";

// A session must never reach a tool, so the cookie path is armed with a real user.
let sessionUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (sessionUserId === null ? null : { user: { id: sessionUserId } })),
}));

// A token revoked while its request is in flight: the route's up-front resolve
// sees it live, and the tool's v1 handler, resolving it again, sees it revoked.
let revokeAfterResolve: string | null = null;
vi.mock("@/server/public-api/actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/public-api/actor")>();
  return {
    ...actual,
    resolveActor: async (request: Request) => {
      const resolved = await actual.resolveActor(request);
      if (revokeAfterResolve !== null) {
        await revokeSecret(revokeAfterResolve);
        revokeAfterResolve = null;
      }
      return resolved;
    },
  };
});

const { POST, GET, DELETE } = await import("./route");

const METADATA = `${oauthIssuer()}/.well-known/oauth-protected-resource/api/mcp`;

async function entitled(): Promise<string> {
  const id = `mcp-route-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M55 MCP route fixture.",
    expiresAt: null,
  });
  return id;
}

/** The access token a client connected by `ownerId` holds. */
const connect = async (ownerId: string, scopes: ApiScope[]) => (await connectForTest(ownerId, scopes)).access;

const ACCEPT = "application/json, text/event-stream";

function mcp(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request(mcpResource(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
      body,
    }),
  );
}

const rpc = (method: string, params: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}`, "mcp-protocol-version": "2025-11-25" });

describe("POST /api/mcp before any MCP is read", () => {
  it("answers 401 with the resource_metadata challenge, even to a body that is not JSON-RPC", async () => {
    const res = await mcp("not json at all");
    expect(res.status).toBe(401);
    // No credential was presented, so RFC 6750 §3.1 wants no error code.
    expect(res.headers.get("WWW-Authenticate")).toBe(`Bearer resource_metadata="${METADATA}"`);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });

  it("answers a dead bearer, a live REST token, or another scheme beside a session, with invalid_token", async () => {
    sessionUserId = await entitled();
    const minted = await mintToken(sessionUserId, { name: "REST", scopes: ["account:read"], tripIds: null, expiresInDays: 30 });
    if (!minted.ok) throw new Error("no token");
    try {
      for (const header of ["Bearer tco_not-a-real-token", `Bearer ${minted.created.secret}`, "Basic dXNlcjpwYXNz"]) {
        const res = await mcp(rpc("tools/list", {}), { authorization: header });
        expect(res.status, header).toBe(401);
        expect(res.headers.get("WWW-Authenticate"), header).toBe(
          `Bearer resource_metadata="${METADATA}", error="invalid_token"`,
        );
      }
    } finally {
      sessionUserId = null;
    }
  });
});

describe("POST /api/mcp with a connected client's token", () => {
  it("lists every tool with its annotations, statelessly", async () => {
    const access = await connect(await entitled(), ["account:read"]);
    const res = await mcp(rpc("tools/list", {}), bearer(access));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const { result } = await res.json();
    const publish = result.tools.find((t: { name: string }) => t.name === "publish_playbook");
    expect(publish.annotations).toEqual(expect.objectContaining({ readOnlyHint: false, openWorldHint: true }));
  });

  // MCP 2026-07-28 adds `Mcp-Method` / `Mcp-Name`; the pinned SDK targets
  // 2025-11-25, so a client sending them and one that does not both answer.
  it("answers tools/call with and without the Mcp-Method and Mcp-Name headers", async () => {
    const owner = await entitled();
    const access = await connect(owner, ["account:read"]);
    const call = rpc("tools/call", { name: "whoami", arguments: {} });
    const forms: Record<string, string>[] = [{}, { "mcp-method": "tools/call", "mcp-name": "whoami" }];
    for (const extra of forms) {
      const res = await mcp(call, { ...bearer(access), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(200);
      const { result } = await res.json();
      expect(result.isError, JSON.stringify(extra)).toBeUndefined();
      expect(JSON.parse(result.content[0].text).userId).toBe(owner);
    }
  });

  it("answers a scope the grant lacks as a tool error, not an HTTP one", async () => {
    const access = await connect(await entitled(), ["trips:read"]);
    const res = await mcp(rpc("tools/call", { name: "whoami", arguments: {} }), bearer(access));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^This token does not hold the "account:read" scope\. \(insufficient-scope\)/);
  });
});

describe("POST /api/mcp when a tool call meets a refused credential", () => {
  // ADR-083 §8: a refused credential is HTTP, which the client refreshes or
  // reconnects on, never a tool error the model reads and gives up on.
  it("answers the refusal's 401 and challenge on the MCP response itself", async () => {
    const access = await connect(await entitled(), ["account:read"]);
    revokeAfterResolve = access;
    const res = await mcp(rpc("tools/call", { name: "whoami", arguments: {} }), bearer(access));
    expect(revokeAfterResolve).toBeNull();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(`Bearer resource_metadata="${METADATA}", error="invalid_token"`);
    expect((await res.json()).error.code).toBe("token-revoked");
  });
});

describe("the methods a stateless server has no use for", () => {
  it("answers GET and DELETE 405, naming POST", async () => {
    for (const handler of [GET, DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });
});
