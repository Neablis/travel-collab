import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The consent page's three ways out: sign in and come back to this exact URL,
// show a refusal without redirecting, or render consent. The checks themselves
// are `authorizeRequest.test.ts`'s; this is what the page does with each answer.

let userId: string | null = null;
// What `parseAuthorizeRequest` answers; its shape is held by the page's own types.
let parsed: unknown;
let entitled = true;

vi.mock("@/server/auth", () => ({ auth: async () => (userId === null ? null : { user: { id: userId } }) }));
vi.mock("@/server/entitlements/resolver", () => ({ accountCan: async () => entitled }));
vi.mock("@/server/oauth/authorizeRequest", () => ({ parseAuthorizeRequest: async () => parsed }));

/** `redirect()` ends the render by throwing; so does this, carrying where it was sent. */
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { default: AuthorizePage } = await import("./page");

const open = (params: Record<string, string | string[]>) => AuthorizePage({ searchParams: Promise.resolve(params) });

async function redirectedTo(params: Record<string, string | string[]>): Promise<string> {
  const error = await open(params).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Redirected)) throw new Error("expected a redirect");
  return error.to;
}

afterEach(() => {
  userId = null;
  entitled = true;
});

describe("/oauth/authorize", () => {
  it("sends a signed-out person to sign in and back to this exact authorize URL", async () => {
    const params = { client_id: "c", redirect_uri: "https://example.com/cb", state: "a b&c", scope: "trips:read" };
    const to = new URL(await redirectedTo(params), "https://caesura.test");
    expect(to.pathname).toBe("/signin");
    const back = new URL(to.searchParams.get("callbackUrl")!, "https://caesura.test");
    expect(back.pathname).toBe("/oauth/authorize");
    expect(Object.fromEntries(back.searchParams)).toEqual(params);
  });

  it("shows a refusal on the page rather than redirecting", async () => {
    userId = "dev-a";
    parsed = { show: { error: "invalid_client", description: "unknown app" } };
    render(await open({ client_id: "c" }));
    expect(screen.getByRole("heading", { level: 1, name: "This app cannot connect" })).toBeTruthy();
  });

  it("sends an error back to a recognised redirect without a click", async () => {
    userId = "dev-a";
    const to = "https://claude.ai/api/mcp/auth_callback?error=invalid_scope&iss=x";
    parsed = { redirectTo: to, automatic: true, description: "bad scope" };
    expect(await redirectedTo({ client_id: "c" })).toBe(to);
  });

  // Amendment M: open registration means a proven redirect can still be an
  // attacker's site, so any other client's error waits for the person's click.
  it("shows any other client's error with a link back, rather than redirecting", async () => {
    userId = "dev-a";
    const to = "https://evil.example/login?error=invalid_scope&state=s&iss=x";
    parsed = { redirectTo: to, automatic: false, description: "a requested scope is not offered here" };
    render(await open({ client_id: "c" }));
    expect(screen.getByRole("heading", { level: 1, name: "This app's request was refused" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return to evil.example" }).getAttribute("href")).toBe(to);
  });

  it("renders consent for a valid request, with Allow off for a free account", async () => {
    userId = "dev-a";
    entitled = false;
    parsed = {
      request: {
        client: { id: "r", clientId: "r", kind: "dcr", clientName: "Test", redirectUris: [], cimdHost: null },
        redirectUri: "https://example.com/cb",
        scopes: ["trips:read"],
        state: "s",
        codeChallenge: "x",
        resource: "https://caesura.test/api/mcp",
        marking: "unverified",
      },
    };
    render(await open({ client_id: "r" }));
    expect(screen.getByRole("heading", { level: 2, name: "example.com" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
