import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "./fixtures/test";
import { signInAsDevUser } from "./helpers";
import { grantCollaborators } from "./adminBootstrap";

// **M55 part 2, walked in a browser**: a client registers, a premium account
// reads the consent page and clicks Allow, and the browser is sent back to the
// client's loopback redirect with a code, the client's `state` and our `iss`
// (ADR-083 amendment A). The code is then exchanged, so the spec ends on a
// token rather than a string that merely looks like a code.
//
// The client is a loopback one, registered without a port and redirected to
// with one (RFC 8252 §7.3), which is also the case the consent page has to
// warn about. Nothing listens on that port: the browser's request to it is
// caught and answered here.
//
// The client asks for one read and one write, so the page shows both sections:
// the read ticked, the write an opt-in the person takes from the keyboard
// (M55 part 7), and the token comes back holding both.
//
// A fresh dev user, not the shared alice session: this account's plan changes
// mid-spec (`m22-api-tokens.spec.ts`'s reason).
test.use({ storageState: undefined });

const REGISTERED = "http://127.0.0.1/callback";
const PRESENTED = "http://127.0.0.1:61234/callback";

test("oauth consent: a premium account allows a loopback client, and the code comes back with state and iss", async ({
  page,
  browser,
}) => {
  const username = `m55${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);
  await grantCollaborators(browser, `dev-${username}`);

  // Discovery first, as a client does: the issuer and the resource come from here.
  const server = await (await page.request.get("/.well-known/oauth-authorization-server")).json();
  const { resource } = await (await page.request.get("/.well-known/oauth-protected-resource/api/mcp")).json();

  const registered = await page.request.post("/api/oauth/register", {
    data: { client_name: "E2E Inspector", redirect_uris: [REGISTERED] },
  });
  expect(registered.status(), "registration").toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: PRESENTED,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "trips:read notebook:write offline_access",
    resource,
  });

  await page.route(`${PRESENTED}**`, (route) => route.fulfill({ status: 200, body: "connected" }));
  const callback = page.waitForRequest((request) => request.url().startsWith(PRESENTED));

  await page.goto(`/oauth/authorize?${query.toString()}`);
  await expect(
    page.getByRole("heading", { level: 1, name: 'An app calling itself "E2E Inspector" wants to connect to your Caesura account' }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "127.0.0.1:61234" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "a program on this computer" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Read trips/ })).toBeChecked();
  const notebookWrite = page.getByRole("checkbox", { name: /Write the Notebook/ });
  await expect(notebookWrite).not.toBeChecked();
  await page.getByRole("button", { name: "Select all write access" }).focus();
  await page.keyboard.press("Enter");
  await expect(notebookWrite).toBeChecked();
  await page.getByRole("button", { name: "Allow" }).click();

  const answer = new URL((await callback).url());
  const code = answer.searchParams.get("code");
  expect(code, "the redirect carries a code").toMatch(/^tcc_/);
  expect(answer.searchParams.get("state")).toBe("e2e-state");
  expect(answer.searchParams.get("iss")).toBe(server.issuer);

  const exchanged = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: code!,
      code_verifier: verifier,
      redirect_uri: PRESENTED,
      client_id: clientId,
      resource,
    },
  });
  expect(exchanged.status(), "token exchange").toBe(200);
  const token = (await exchanged.json()) as { access_token: string; scope: string };
  expect(token.access_token).toMatch(/^tco_/);
  expect(token.scope.split(" ").sort(), "the write the person opted into is granted").toEqual(["notebook:write", "trips:read"]);
});
