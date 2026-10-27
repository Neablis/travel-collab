// **`POST /api/oauth/token`**, as a client calls it: form-encoded, against a
// real database. The grants' own refusals are `tokens.int.test.ts`'s; this is
// the wire: the body format, the grant types, and the RFC 6749 §5 answer shape.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
import { POST } from "./route";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

const form = (fields: Record<string, string>, type = "application/x-www-form-urlencoded") =>
  POST(
    new Request("http://localhost/api/oauth/token", {
      method: "POST",
      headers: { "content-type": type },
      body: new URLSearchParams(fields).toString(),
    }),
  );

async function freshCode(): Promise<{ code: string; clientId: string }> {
  const registered = await registerClient({ redirect_uris: [REDIRECT] }, randomUUID());
  const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
  if (!resolved.ok) throw new Error("no client");
  const now = new Date();
  const grant = await createGrant({
    ownerId: `dev-${randomUUID()}`,
    client: resolved.client,
    redirectUri: REDIRECT,
    scopes: ["trips:read"],
    resource: mcpResource(),
    now,
  });
  const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
  return { code, clientId: resolved.client.clientId };
}

describe("POST /api/oauth/token", () => {
  it("exchanges a code and then refreshes, each answer uncacheable", async () => {
    const { code, clientId } = await freshCode();
    const exchanged = await form({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
      client_id: clientId,
      resource: mcpResource(),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("cache-control")).toBe("no-store");
    const body = await exchanged.json();
    expect(body).toEqual(expect.objectContaining({ token_type: "Bearer", scope: "trips:read" }));
    const refreshed = await form({ grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
  });

  it("answers unsupported_grant_type for any other grant", async () => {
    const res = await form({ grant_type: "client_credentials" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "unsupported_grant_type" }));
  });

  // Each body below would get a different answer if its check were missing:
  // read as a form anyway, or by its first value, it names an unsupported grant.
  it("answers invalid_request for a body not sent as a form, for no grant_type, and for a repeated parameter", async () => {
    const notAForm = await form({ grant_type: "client_credentials" }, "application/json");
    expect((await notAForm.json()).error).toBe("invalid_request");
    expect((await (await form({})).json()).error).toBe("invalid_request");
    const repeated = await POST(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&grant_type=authorization_code",
      }),
    );
    expect((await repeated.json()).error).toBe("invalid_request");
  });

  it("answers invalid_grant with RFC 6749's error body for a code that does not verify", async () => {
    const { code, clientId } = await freshCode();
    const res = await form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant", error_description: expect.any(String) });
  });
});
