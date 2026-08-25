import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// AppHeader renders AccountMenuFromSession (task 8b.2), which calls
// next-auth/react's getSession() on mount — mock it so these stay plain
// jsdom unit tests with no real network call.
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
}));

const { AppHeader } = await import("./AppHeader");

afterEach(cleanup);

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
});
