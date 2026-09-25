import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "@tc/contracts";
import { AccountMenu, HeaderSessionChrome } from "./AccountMenu";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

// **`useSessionUser` reads `/api/auth/session` directly** rather than through
// next-auth's `getSession()`, which returns `null` for a FAILED request and a
// confirmed signed-out session alike (CodeRabbit, PR #196). The mock above is
// still the one place a test says who is signed in; this carries its answer
// over the transport the hook now uses, so every `mockResolvedValueOnce` and
// `toHaveBeenCalled` below reads exactly as it did.
beforeEach(() => {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/auth/session")) {
      const { getSession } = await import("next-auth/react");
      const session = await vi.mocked(getSession)();
      return new Response(JSON.stringify(session ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch in this test: ${url}`);
  });
});

const resetDemoDataMock = vi.fn();
// Typed as the helper's real return so a `{ ok: false }` case can be driven —
// `ApiResult`, like every other apiClient helper (its totality witness is what
// keeps that one shape true).
//
// M20 link 7: `isAdmin` rides in this same read, and the menu takes it from the
// provider rather than asking again (KI-2026-09-14-f). Default false, so every
// test written before the console keeps describing the menu it was written for.
const fetchPreferencesMock = vi.fn<
  () => Promise<
    | { ok: true; value: { preferences: UserPreferences; isAdmin: boolean } }
    | { ok: false; error: { status: number; message: string } }
  >
>(async () => ({
  ok: true,
  value: { preferences: { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "12h" }, isAdmin: false },
}));
vi.mock("@/lib/apiClient", () => ({
  resetDemoData: (...args: unknown[]) => resetDemoDataMock(...args),
  fetchPreferences: () => fetchPreferencesMock(),
  updatePreferences: vi.fn(async () => ({ ok: false as const, error: { status: 0, message: "no" } })),
}));

afterEach(cleanup);

describe("AccountMenu", () => {
  it("shows the signed-in identity behind the avatar", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("sam@example.com")).toBeTruthy();
  });

  // KI-48 (design audit A8): a dev-login account has no email, and the menu
  // drew an empty second line under the name for it — in every preview
  // screenshot. No email means no line, not a blank one.
  it("draws no email line for an account without an email", async () => {
    render(<AccountMenu name="Dev Alice" email={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const menu = within(screen.getByRole("dialog"));
    expect(menu.getByText("Dev Alice")).toBeTruthy();
    // An element whose own text is empty is the blank line itself — the email
    // span with nothing in it is the only one this menu could draw.
    expect(menu.queryAllByText((text, element) => element?.tagName === "SPAN" && text === "")).toHaveLength(0);
  });

  // M17. Task 8b.2 omitted this item rather than ship one that did nothing, so
  // for four milestones the design's own "Your account" was simply absent — it
  // never flashed "not built yet", whatever the milestone file said. It is real
  // now, and this is what says so.
  // **It opened a Sheet until M26 link 1; it is a link to `/account` now**
  // (SPEC §34.4). Asserted as a real anchor with the right href rather than as
  // a rendered screen: a menu item's job is to point somewhere, and the screen
  // it points at has its own tests. A `<button>` with a `router.push` would
  // pass a "clicking it navigates" test and still break middle-click, open in
  // new tab, and every assistive technology that reads links as links.
  it("links to the account route from Your account", async () => {
    render(
      <PreferencesProvider>
        <AccountMenu name="Sam K" email="sam@example.com" />
      </PreferencesProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const link = screen.getByRole("link", { name: "Your account" });
    expect(link.getAttribute("href")).toBe("/account");
  });

  it("signs out", async () => {
    const onSignOut = vi.fn();
    render(<AccountMenu name="Sam K" email="sam@example.com" onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  // "Your account" (M17) and "Sign out" are the design's two items; this third
  // one is only real outside preview (see AppHeader.tsx / demoDataReset.ts),
  // so its absence when the prop is false must be exact: no disabled item, no
  // trace.
  it("hides the reset item when demoResetEnabled is false", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("button", { name: "Reset to demo data" })).toBeNull();
  });

  it("requires confirmation before calling onResetDemoData", async () => {
    const onResetDemoData = vi.fn().mockResolvedValue(undefined);
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    expect(onResetDemoData).not.toHaveBeenCalled();

    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalled());
  });

  it("cancels the reset confirmation without calling onResetDemoData", async () => {
    const onResetDemoData = vi.fn();
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResetDemoData).not.toHaveBeenCalled();
  });

  // Mitchell's report, verbatim: "Im really suprised how long the reset
  // took, and there was no ui indicator that it was still seeding which made
  // it dangerous to run." Two greyed-out buttons with unchanged copy reads
  // as broken, not busy — the label and a live region both have to say so.
  it("shows a busy label and announces reset progress while the request is in flight", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByRole("button", { name: "Resetting…" })).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/few seconds/i);

    resolveReset();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resetting…" })).toBeNull());
  });

  it("keeps the dialog open when Escape is pressed mid-reset", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await screen.findByRole("button", { name: "Resetting…" });

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();

    resolveReset();
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalledTimes(1));
  });

  it("does not fire a second reset from a repeat click while one is already in flight", async () => {
    let resolveReset!: () => void;
    const onResetDemoData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));

    const resetButton = screen.getByRole("button", { name: "Reset" });
    await userEvent.click(resetButton);
    await screen.findByRole("button", { name: "Resetting…" });
    // No @testing-library/jest-dom in this repo — check the DOM property
    // directly, same pattern as SettingsSheet.test.tsx's status-text match.
    expect((resetButton as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(resetButton);
    resolveReset();
    await waitFor(() => expect(onResetDemoData).toHaveBeenCalledTimes(1));
  });

  it("shows an error inline when the reset fails, without closing the dialog", async () => {
    const onResetDemoData = vi.fn().mockRejectedValue(new Error("boom"));
    render(<AccountMenu name="Sam K" email="sam@example.com" demoResetEnabled onResetDemoData={onResetDemoData} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reset to demo data" })).toBeTruthy();
  });
});

// Through HeaderSessionChrome — the one production entry point that resolves
// the session and wires the menu. (These used to render a second, test-only
// entry point, `AccountMenuFromSession`, removed as dead in KI-2026-09-05-w.)
describe("HeaderSessionChrome's account menu", () => {
  it("renders nothing while signed out", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce(null);

    render(<HeaderSessionChrome />);

    await waitFor(() => expect(vi.mocked(getSession)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("resolves the session client-side and dispatches the real signOut on click", async () => {
    const { getSession, signOut } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });

    render(<HeaderSessionChrome />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    // `/welcome`, not `/`: see AccountMenu.tsx's onSignOut comment — routing
    // sign-out through `/` raced the session cookie being cleared.
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/welcome" });
  });

  it("defaults demoResetEnabled to off, so no reset item appears without an explicit prop", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });

    render(<HeaderSessionChrome />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("button", { name: "Reset to demo data" })).toBeNull();
  });

  it("calls the real resetDemoData endpoint and reloads on success", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });
    resetDemoDataMock.mockResolvedValueOnce({ ok: true, value: { tripId: "trip-1" } });
    // jsdom's window.location.reload isn't a configurable own property, so
    // vi.spyOn can't redefine it directly — replace the whole location object
    // for the span of this test instead.
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(<HeaderSessionChrome demoResetEnabled />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(resetDemoDataMock).toHaveBeenCalled());
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});

// **The operator console's entry point** (M20 link 7). Advisory only — the
// route and every admin endpoint answer 404 to a non-admin whatever this
// renders — so what is asserted is that the console is reachable by CLICKING
// for an operator and invisible to everyone else, which is the reviewability
// half AGENTS.md's Definition of Done asks for.
// Inside the provider, as the shell mounts it: the flag comes from the
// provider's one preferences read, not from a request of the menu's own.
const PREFS: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "12h" };
function renderInShell() {
  render(
    <PreferencesProvider>
      <AccountMenu name="Ana" email="ana@example.com" />
    </PreferencesProvider>,
  );
}

describe("AccountMenu — the operator console", () => {
  it("offers no console to an ordinary account", async () => {
    fetchPreferencesMock.mockResolvedValue({ ok: true, value: { preferences: PREFS, isAdmin: false } });
    renderInShell();
    await userEvent.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.queryByRole("link", { name: "Operator console" })).toBeNull();
  });

  it("offers it to an operator, pointing at /admin", async () => {
    fetchPreferencesMock.mockResolvedValue({ ok: true, value: { preferences: PREFS, isAdmin: true } });
    renderInShell();
    await userEvent.click(screen.getByRole("button", { name: /account/i }));
    const link = await screen.findByRole("link", { name: "Operator console" });
    expect(link.getAttribute("href")).toBe("/admin");
  });

  // A failed read is a menu without the item, never a menu with it: an item
  // that fails to appear costs an operator one typed URL, and one that appears
  // wrongly is a 404 nobody expected.
  it("offers nothing when the read fails", async () => {
    fetchPreferencesMock.mockResolvedValue({ ok: false, error: { status: 0, message: "offline" } });
    renderInShell();
    await userEvent.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.queryByRole("link", { name: "Operator console" })).toBeNull();
  });
});
