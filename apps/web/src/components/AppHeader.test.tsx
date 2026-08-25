import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  demoResetEnabled = false;
});

describe("AppHeader", () => {
  it("links to both routes so every page has a way back", () => {
    render(<AppHeader />);

    expect(screen.getByRole("link", { name: "Trips" }).getAttribute("href")).toBe("/");
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
