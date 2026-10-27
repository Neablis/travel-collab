import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiToken, ConnectedApp } from "@tc/contracts";
import { AccountScreen } from "./AccountScreen";

// **The Security tab with its real sections**, for an account without the API
// (Mitchell, M55 part 6 follow-up). Everything on the tab is Premium, so the
// tab says so once, above both sections, rather than the tokens section saying
// it alone. `AccountScreen.test.tsx` stubs the sections to keep itself about
// the tabs; what is asserted here is how the banner and the sections read
// together, which a stub cannot show.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=security"),
}));
vi.mock("./useSessionUser", () => ({ useSessionUser: () => ({ id: "user-a", email: "sam@example.com" }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;

const token: ApiToken = {
  tokenId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718",
  name: "Calendar sync",
  prefix: "tc_7Fq2xR9a",
  scopes: ["trips:read"],
  tripIds: null,
  createdAt: new Date(Date.now() - 10 * DAY).toISOString(),
  lastUsedAt: null,
  expiresAt: new Date(Date.now() + 12 * DAY).toISOString(),
  revokedAt: null,
  revokedReason: null,
};

const app: ConnectedApp = {
  grantId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60720",
  clientName: "Claude",
  redirectHost: "claude.ai",
  recognised: true,
  scopes: ["trips:read"],
  createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  lastUsedAt: null,
  expiresAt: new Date(Date.now() + 300 * DAY).toISOString(),
  revokedAt: null,
  revokedReason: null,
};

/** Serve the tab's three reads: the plan, the tokens and the connected apps. */
function serve(plan: { entitlements: string[]; billing?: { state: string } }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === "/api/account/plan") return new Response(JSON.stringify({ plan }), { status: 200 });
      if (href === "/api/account/tokens") return new Response(JSON.stringify({ tokens: [token] }), { status: 200 });
      if (href === "/api/account/connected-apps") return new Response(JSON.stringify({ apps: [app] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
}

/** The one live region on the page that says Premium; fails if there are none or several. */
function thePremiumBanner(): HTMLElement {
  const banners = screen.getAllByRole("status").filter((s) => /Premium/.test(s.textContent ?? ""));
  expect(banners).toHaveLength(1);
  return banners[0] as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Security tab on an account without the API", () => {
  it("says Premium once, above both sections, naming both", async () => {
    serve({ entitlements: [], billing: { state: "none" } });
    render(<AccountScreen />);
    const tokens = await screen.findByRole("region", { name: "API tokens" });
    await within(tokens).findByRole("row", { name: /Calendar sync/ });
    await screen.findByRole("link", { name: "See plans" });

    const banner = thePremiumBanner();
    expect(banner.textContent).toContain("API tokens");
    expect(banner.textContent).toContain("Claude");
    // Taking your trips with you is not Premium (§34.1), and says so beside the prompt.
    expect(banner.textContent).toMatch(/downloading a trip/i);
    expect(within(banner).getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
    // Over the sections, not inside one of them.
    expect(within(tokens).queryByText(/Premium/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Connected apps" })).queryByText(/Premium/)).toBeNull();
  });

  // **Only creating is Premium.** A lapsed or downgraded account still holds
  // its tokens and grants, and cutting one off must never cost a subscription.
  it("still offers Revoke and Disconnect on what the account already holds", async () => {
    serve({ entitlements: [], billing: { state: "lapsed" } });
    render(<AccountScreen />);
    const tokens = await screen.findByRole("region", { name: "API tokens" });
    const revoke = await within(tokens).findByRole("button", { name: "Revoke" });
    expect(revoke.hasAttribute("disabled")).toBe(false);
    expect(within(tokens).queryByRole("button", { name: "New token" })).toBeNull();

    const apps = screen.getByRole("region", { name: "Connected apps" });
    const disconnect = await within(apps).findByRole("button", { name: "Disconnect" });
    expect(disconnect.hasAttribute("disabled")).toBe(false);
  });

  // A lapsed account had the features; "subscribe" would tell it otherwise.
  it("tells a lapsed account both stopped, and how to restart them", async () => {
    serve({ entitlements: [], billing: { state: "lapsed" } });
    render(<AccountScreen />);
    await screen.findByRole("link", { name: "Restart it" });
    const banner = thePremiumBanner();
    expect(banner.textContent).toContain("stopped working");
    expect(banner.textContent).toContain("nothing was deleted");
    expect(within(banner).getByRole("link", { name: "Restart it" }).getAttribute("href")).toBe("/plans");
  });
});

describe("the Security tab on an account with the API", () => {
  it("shows no banner, and lets the account create a token", async () => {
    serve({ entitlements: ["api.tokens"], billing: { state: "active" } });
    render(<AccountScreen />);
    await screen.findByRole("button", { name: "New token" });
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  // The plan body without `billing` once took the whole token list down with it.
  it("still lists the tokens when the plan carries no billing", async () => {
    serve({ entitlements: ["api.tokens"] });
    render(<AccountScreen />);
    await screen.findByRole("button", { name: "New token" });
    expect(screen.getByRole("row", { name: /Calendar sync/ })).toBeTruthy();
  });
});
