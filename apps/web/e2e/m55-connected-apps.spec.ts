import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { openAccountPage, signInAsDevUser } from "./helpers";
import { grantCollaborators } from "./adminBootstrap";

// **M55 part 5, walked in a browser**: a connected app works, its owner
// disconnects it from Account → Connected apps, and it stops. The point is not
// that a row changes its badge; it is that the access token the app holds is
// refused on its next call and its refresh token can mint nothing more.
//
// Consent as `m55-consent.spec.ts` walks it: a loopback client, caught at its
// redirect. A fresh dev user, because this account's plan changes mid-spec.
test.use({ storageState: undefined });

const REGISTERED = "http://127.0.0.1/callback";
const PRESENTED = "http://127.0.0.1:61235/callback";

/** `tools/call whoami` on `/api/mcp` with `access` as the bearer. */
function whoami(request: APIRequestContext, access: string) {
  return request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${access}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } },
  });
}

test("connected apps: an app connected by consent works until its owner disconnects it", async ({ page, browser }) => {
  const username = `m55apps${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);
  await grantCollaborators(browser, `dev-${username}`);

  const { resource } = await (await page.request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  const registered = await page.request.post("/api/oauth/register", {
    data: { client_name: "E2E Connected App", redirect_uris: [REGISTERED] },
  });
  expect(registered.status(), "registration").toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  // ---- consent, and the code exchanged ---------------------------------------
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: PRESENTED,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "e2e-apps",
    scope: "account:read offline_access",
    resource,
  });
  await page.route(`${PRESENTED}**`, (route) => route.fulfill({ status: 200, body: "connected" }));
  const callback = page.waitForRequest((request) => request.url().startsWith(PRESENTED));
  await page.goto(`/oauth/authorize?${query.toString()}`);
  await page.getByRole("button", { name: "Allow" }).click();
  const code = new URL((await callback).url()).searchParams.get("code");
  expect(code, "the redirect carries a code").toMatch(/^tcc_/);

  const exchanged = await page.request.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: PRESENTED, client_id: clientId, resource },
  });
  expect(exchanged.status(), "token exchange").toBe(200);
  const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };

  // ---- the app works ----------------------------------------------------------
  const before = await whoami(page.request, tokens.access_token);
  expect(before.status(), "whoami while connected").toBe(200);
  const { result } = (await before.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text).userId).toBe(`dev-${username}`);

  // ---- its owner disconnects it ----------------------------------------------
  await page.goto("/home");
  await openAccountPage(page);
  await page.getByRole("button", { name: "Connected apps →" }).click();
  await expect(page.getByRole("heading", { name: "Connected apps", level: 2 })).toBeVisible();
  const row = page.getByRole("row", { name: /E2E Connected App/ });
  await expect(row).toContainText("127.0.0.1");
  await row.getByRole("button", { name: "Disconnect" }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect E2E Connected App?" });
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(row).toContainText("Disconnected");

  // ---- and it stops ----------------------------------------------------------
  expect((await whoami(page.request, tokens.access_token)).status(), "whoami after disconnect").toBe(401);
  const refreshed = await page.request.post("/api/oauth/token", {
    form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId, resource },
  });
  expect(refreshed.status(), "refresh after disconnect").toBe(400);
  expect(((await refreshed.json()) as { error: string }).error).toBe("invalid_grant");
});
