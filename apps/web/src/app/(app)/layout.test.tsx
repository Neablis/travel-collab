// M45 decision 3: the layout sends the reader's plan with the page. A read
// that fails falls back to `null` so the app stays up, but it must still be
// reported: a version reference that no longer resolves has to fail loudly
// (ADR-045 rule 3), and the fallback alone would hide it.
//
// The preferences go down the same way, read beside the plan, and fail on
// their own: a failed read serves nothing, and `PreferencesProvider` (whose
// own tests prove it) fetches for itself as it did before they were served.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPreferencesRead } from "@/lib/apiClient";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "authjs.session-token", value: "x" }] }),
}));
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: "user-a" } }) }));
const fault = vi.hoisted(() => new Error("plan version v9 does not resolve"));
const entitlementsFor = vi.hoisted(() => vi.fn());
vi.mock("@/server/entitlements/resolver", () => ({ entitlementsFor }));
const readAccountPreferences = vi.hoisted(() => vi.fn());
vi.mock("@/server/accountPreferences", () => ({ readAccountPreferences }));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

import AppLayout from "./layout";

// What the endpoint would answer for an operator who chose miles: values a
// default could not produce, so a served read cannot pass for the fallback.
const read: AccountPreferencesRead = {
  preferences: {
    displayName: "Sam",
    homeAirport: "LHR",
    distanceUnit: "mi",
    timeFormat: "24h",
    avatar: null,
    color: null,
    publicDisplayName: false,
  },
  defaultColor: null,
  isAdmin: true,
};

// The layout's root is `SessionUserProvider`; its child the provider the plan
// goes down through, and that one's child the preferences provider.
type Tree = React.ReactElement<{
  initialUser: unknown;
  children: React.ReactElement<{
    entitlements: unknown;
    children: React.ReactElement<{ initialRead: unknown }>;
  }>;
}>;
const render = async () => (await AppLayout({ children: null })) as Tree;

beforeEach(() => {
  captureException.mockClear();
  entitlementsFor.mockReset().mockRejectedValue(fault);
  readAccountPreferences.mockReset().mockResolvedValue(read);
});

describe("the app layout's plan read", () => {
  it("reports a failed read and serves no plan", async () => {
    const tree = await render();
    expect(captureException).toHaveBeenCalledWith(fault);
    // `null`, not `[]`: an empty list is a served answer, and would withhold
    // the Ask from every paying reader whenever the read fails.
    expect(tree.props.children.props.entitlements).toBeNull();
  });

  // The session the layout already read goes down with the page, so the client
  // does not ask /api/auth/session again; a failed plan read does not lose it.
  it("hands the reader it resolved to the session provider", async () => {
    const tree = await render();
    expect(tree.props.initialUser).toEqual({ id: "user-a", name: null, email: null });
  });
});

describe("the app layout's preferences read", () => {
  it("serves the reader's preferences to the provider, even when the plan read fails", async () => {
    const tree = await render();
    expect(readAccountPreferences).toHaveBeenCalledWith("user-a");
    expect(tree.props.children.props.children.props.initialRead).toEqual(read);
  });

  // Beside the plan, not after it: serving them must not add a sequential
  // database read to every server render.
  it("starts the preferences read before the plan read has settled", async () => {
    let release: (value: { entitlements: string[] }) => void = () => {};
    entitlementsFor.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const rendering = render();
    await vi.waitFor(() => expect(readAccountPreferences).toHaveBeenCalledWith("user-a"));
    release({ entitlements: [] });
    await rendering;
  });

  it("serves no preferences when the read fails, reports it, and keeps the plan", async () => {
    const preferencesFault = new Error("users row unreadable");
    readAccountPreferences.mockRejectedValue(preferencesFault);
    entitlementsFor.mockResolvedValue({ entitlements: ["ai"] });

    const tree = await render();
    expect(captureException).toHaveBeenCalledWith(preferencesFault);
    // `undefined` is what tells the provider to fetch for itself.
    expect(tree.props.children.props.children.props.initialRead).toBeUndefined();
    expect(tree.props.children.props.entitlements).toEqual(["ai"]);
  });
});
