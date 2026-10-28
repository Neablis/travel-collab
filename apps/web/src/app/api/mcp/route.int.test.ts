// **`/api/mcp` as a client meets it** (ADR-083 §8), against a real database:
// the credential is answered before any MCP is read, the server keeps no
// session, a 2026-07-28 request is answered as JSON and a 2025-11-25 one as a
// single SSE event, and a refused credential is HTTP on both revisions.
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

/** A 2025-11-25 answer: the SDK's stateless fallback streams exactly one JSON-RPC message, then ends. */
async function oneEvent(res: Response) {
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const data = (await res.text()).split("\n").filter((line) => line.startsWith("data: "));
  expect(data).toHaveLength(1);
  return JSON.parse(data[0]!.slice("data: ".length));
}

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
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const { result } = await oneEvent(res);
    const publish = result.tools.find((t: { name: string }) => t.name === "publish_playbook");
    expect(publish.annotations).toEqual(expect.objectContaining({ readOnlyHint: false, openWorldHint: true }));
  });

  // A 2025-11-25 client may send 2026-07-28's `Mcp-Method` / `Mcp-Name` or
  // not; with no per-request envelope it is the handshake era either way.
  it("answers tools/call with and without the Mcp-Method and Mcp-Name headers", async () => {
    const owner = await entitled();
    const access = await connect(owner, ["account:read"]);
    const call = rpc("tools/call", { name: "whoami", arguments: {} });
    const forms: Record<string, string>[] = [{}, { "mcp-method": "tools/call", "mcp-name": "whoami" }];
    for (const extra of forms) {
      const res = await mcp(call, { ...bearer(access), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(200);
      const { result } = await oneEvent(res);
      expect(result.isError, JSON.stringify(extra)).toBeUndefined();
      expect(JSON.parse(result.content[0].text).userId).toBe(owner);
    }
  });

  it("answers a scope the grant lacks as a tool error, not an HTTP one", async () => {
    const access = await connect(await entitled(), ["trips:read"]);
    const res = await mcp(rpc("tools/call", { name: "whoami", arguments: {} }), bearer(access));
    expect(res.status).toBe(200);
    const { result } = await oneEvent(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^This token does not hold the "account:read" scope\. \(insufficient-scope\)/);
  });
});

// MCP 2026-07-28 has no handshake: each request names its revision in a
// header and again in `_meta`, with `Mcp-Method` / `Mcp-Name` beside it.
const MODERN = "2026-07-28";

function modern(secret: string, method: string, params: Record<string, unknown>, name?: string): Promise<Response> {
  const envelope = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} };
  return mcp(rpc(method, { ...params, _meta: envelope }), {
    authorization: `Bearer ${secret}`,
    "mcp-protocol-version": MODERN,
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
  });
}

describe("POST /api/mcp on MCP 2026-07-28, with no initialize", () => {
  it("lists the tools, with a short private cache life", async () => {
    const access = await connect(await entitled(), ["account:read"]);
    const res = await modern(access, "tools/list", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const { result } = await res.json();
    expect(result.tools.map((t: { name: string }) => t.name)).toContain("whoami");
    expect(result).toEqual(expect.objectContaining({ ttlMs: 60_000, cacheScope: "private" }));
  });

  it("calls a tool whose Mcp-Name matches the body, and refuses one whose does not", async () => {
    const owner = await entitled();
    const access = await connect(owner, ["account:read"]);
    const ok = await modern(access, "tools/call", { name: "whoami", arguments: {} }, "whoami");
    expect(ok.status).toBe(200);
    expect(JSON.parse((await ok.json()).result.content[0].text).userId).toBe(owner);

    // The client's mistake, so a warning: the error log is kept for our own faults.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await modern(access, "tools/call", { name: "whoami", arguments: {} }, "get_trip");
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(/Mcp-Name header names "get_trip"/);
      expect(warn).toHaveBeenCalledWith("mcp request rejected", { error: expect.any(Error) });
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // The route reads every answer to its end before replying, so a listen
  // stream left open would hang the request rather than stream.
  it("acknowledges subscriptions/listen and closes it, with nothing to listen for", async () => {
    const access = await connect(await entitled(), ["account:read"]);
    const res = await modern(access, "subscriptions/listen", { notifications: { toolsListChanged: true } });
    expect(res.status).toBe(200);
    const messages = (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)));
    expect(messages.map((m) => m.method ?? "result")).toEqual(["notifications/subscriptions/acknowledged", "result"]);
    expect(messages[0].params.notifications).toEqual({});
  });
});

describe("POST /api/mcp logs a client's mistake as a warning, not an error", () => {
  const call = rpc("tools/call", { name: "whoami", arguments: {} });
  const unsupported = "2099-01-01";
  const envelope = { "io.modelcontextprotocol/protocolVersion": unsupported, "io.modelcontextprotocol/clientCapabilities": {} };
  const mistakes: Record<string, { send: (secret: string) => Promise<Response>; status: number }> = {
    "a revision the SDK does not serve": {
      send: (secret) =>
        mcp(rpc("tools/call", { name: "whoami", arguments: {}, _meta: envelope }), {
          authorization: `Bearer ${secret}`,
          "mcp-protocol-version": unsupported,
          "mcp-method": "tools/call",
          "mcp-name": "whoami",
        }),
      status: 400,
    },
    "a body that is not JSON": { send: (secret) => mcp(call, { ...bearer(secret), "content-type": "text/plain" }), status: 415 },
    // Refused by the 2025 transport, whose reports reach the server's own
    // `onerror` rather than the handler's.
    "a 2025 client that will not take a stream": {
      send: (secret) => mcp(call, { ...bearer(secret), accept: "application/json" }),
      status: 406,
    },
    "a 2025 client whose body does not parse": { send: (secret) => mcp("{not json", bearer(secret)), status: 400 },
    "a 2025 client's batch over the SDK's limit": {
      send: (secret) => mcp(`[${Array.from({ length: 101 }, () => call).join(",")}]`, bearer(secret)),
      status: 400,
    },
  };

  it.each(Object.keys(mistakes))("for %s", async (mistake) => {
    const access = await connect(await entitled(), ["account:read"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await mistakes[mistake]!.send(access);
      expect(res.status).toBe(mistakes[mistake]!.status);
      expect(warn).toHaveBeenCalledWith("mcp request rejected", { error: expect.any(Error) });
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("POST /api/mcp on MCP 2025-11-25, after the handshake", () => {
  it("answers initialize with 2025-11-25, then tools/list", async () => {
    const access = await connect(await entitled(), ["account:read"]);
    const init = await mcp(
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "claude-ai", version: "1.0" },
      }),
      { authorization: `Bearer ${access}` },
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect((await oneEvent(init)).result.protocolVersion).toBe("2025-11-25");

    const res = await mcp(rpc("tools/list", {}), bearer(access));
    expect(res.status).toBe(200);
    const { result } = await oneEvent(res);
    expect(result.tools.map((t: { name: string }) => t.name)).toContain("whoami");
    // Cache fields are 2026-07-28 vocabulary; a 2025 client is not sent them.
    expect(result.ttlMs).toBeUndefined();
  });
});

describe("POST /api/mcp when a tool call meets a refused credential", () => {
  // ADR-083 §8: a refused credential is HTTP, which the client refreshes or
  // reconnects on, never a tool error the model reads and gives up on.
  const callWhoami: Record<string, (secret: string) => Promise<Response>> = {
    "2025-11-25": (secret) => mcp(rpc("tools/call", { name: "whoami", arguments: {} }), bearer(secret)),
    [MODERN]: (secret) => modern(secret, "tools/call", { name: "whoami", arguments: {} }, "whoami"),
  };

  it.each(Object.keys(callWhoami))("answers the refusal's 401 and challenge on the MCP response itself, on %s", async (revision) => {
    const access = await connect(await entitled(), ["account:read"]);
    revokeAfterResolve = access;
    const res = await callWhoami[revision]!(access);
    expect(revokeAfterResolve).toBeNull();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(`Bearer resource_metadata="${METADATA}", error="invalid_token"`);
    expect((await res.json()).error.code).toBe("token-revoked");
  });

  // A scope the grant lacks is the model's to read, not the client's to refresh on.
  it(`answers a scope the grant lacks as a tool error on ${MODERN} too`, async () => {
    const res = await callWhoami[MODERN]!(await connect(await entitled(), ["trips:read"]));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/\(insufficient-scope\)/);
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
