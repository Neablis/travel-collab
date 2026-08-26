import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// AppHeader renders AccountMenuFromSession (task 8b.2), which calls
// next-auth/react's getSession() on mount — mock it so these stay plain
// jsdom unit tests with no real network call.
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
}));

let demoResetEnabled = false;
vi.mock("@/lib/demoDataReset", () => ({
  isDemoDataResetEnabled: () => demoResetEnabled,
}));

const { AppHeader } = await import("./AppHeader");
const { getSession: getSessionMock } = await import("next-auth/react");

afterEach(() => {
  cleanup();
  demoResetEnabled = false;
  vi.mocked(getSessionMock).mockResolvedValue(null);
  vi.mocked(getSessionMock).mockClear();
});

describe("AppHeader", () => {
  // getSession is mocked to null by default above, i.e. signed out.
  it("offers a signed-out visitor no links into authenticated routes", async () => {
    render(<AppHeader />);

    // The wordmark resolves synchronously; the session-gated half does not,
    // so await something before asserting absence — otherwise this passes
    // for the wrong reason, by running before the nav could have appeared.
    expect(screen.getByText("Caesura")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(getSessionMock)).toHaveBeenCalled());

    expect(screen.queryByRole("link", { name: "Trips" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Playbooks" })).toBeNull();
  });

  // CodeRabbit, PR #55: the first version of HeaderSessionChrome rendered
  // AccountMenuFromSession, which resolves the session itself — so the header
  // fetched the same fact twice while a comment claimed it fetched it once.
  it("resolves the session exactly once for the whole header", async () => {
    vi.mocked(getSessionMock).mockResolvedValue({ user: { name: "Sam K", email: "sam@example.com" }, expires: "" });
    render(<AppHeader />);

    await screen.findByRole("link", { name: "Trips" });
    await screen.findByRole("button", { name: "Account menu" });
    expect(vi.mocked(getSessionMock)).toHaveBeenCalledTimes(1);
  });

  it("links to both routes once signed in, so every page has a way back", async () => {
    vi.mocked(getSessionMock).mockResolvedValue({ user: { name: "Sam K", email: "sam@example.com" }, expires: "" });
    render(<AppHeader />);

    expect((await screen.findByRole("link", { name: "Trips" })).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Playbooks" }).getAttribute("href")).toBe("/playbooks");
  });

  it("wordmarks the product as Caesura", () => {
    render(<AppHeader />);
    expect(screen.getByText("Caesura")).toBeTruthy();
  });

  it("is a banner landmark", () => {
    render(<AppHeader />);
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("threads the demo-data-reset gate down to the account menu as a prop", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValue({ user: { name: "Sam K", email: "sam@example.com" }, expires: "" });

    demoResetEnabled = false;
    const { unmount } = render(<AppHeader />);
    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("button", { name: "Reset to demo data" })).toBeNull();
    unmount();

    demoResetEnabled = true;
    render(<AppHeader />);
    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("button", { name: "Reset to demo data" })).toBeTruthy();
  });
});
