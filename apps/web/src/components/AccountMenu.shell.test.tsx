import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

// **The account menu and the preferences provider, as the shell mounts them,
// over the REAL typed client** — `AccountMenu.test.tsx` mocks `@/lib/apiClient`
// outright, so it cannot see how many requests reach the wire.
//
// KI-2026-09-14-f: `fetchIsAdmin` and `fetchPreferences` each issued their own
// `GET /api/account/preferences`, so every page load read the same row twice
// (captured 78ms apart in PR #175's browser walk). `isAdmin` rides in that one
// response, so the provider reads it once and the menu takes it from there.
let preferencesReads = 0;
let isAdmin = false;

beforeEach(() => {
  preferencesReads = 0;
  isAdmin = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/account/preferences") && (init?.method ?? "GET") === "GET") {
      preferencesReads += 1;
      return new Response(
        JSON.stringify({
          preferences: { displayName: null, homeAirport: null, distanceUnit: "km" },
          isAdmin,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in this test: ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openMenu() {
  render(
    <PreferencesProvider>
      <AccountMenu name="Ana" email="ana@example.com" />
    </PreferencesProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
}

describe("the shell's account read", () => {
  it("reads /api/account/preferences once for both the preferences and the operator flag", async () => {
    isAdmin = true;
    await openMenu();

    // Wait for the answer that needs `isAdmin`, so both consumers have had
    // every chance to ask — then count.
    await screen.findByRole("link", { name: "Operator console" });
    await waitFor(() => expect(preferencesReads).toBe(1));
    // And it stays one: a late second read would still be a second read.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preferencesReads).toBe(1);
  });

  it("offers no console to an ordinary account from that same read", async () => {
    isAdmin = false;
    await openMenu();

    await waitFor(() => expect(preferencesReads).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("link", { name: "Operator console" })).toBeNull();
    expect(preferencesReads).toBe(1);
  });
});
