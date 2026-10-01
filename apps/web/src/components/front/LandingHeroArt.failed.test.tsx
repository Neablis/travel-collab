import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setViewportMatches } from "../../../vitest.setup";
import { LandingScreen } from "./LandingScreen";

// The real panels' code never arrives (a deploy replaced the chunk, the network
// dropped). `Suspense` does not catch a rejected `lazy` import, and the only
// boundary above `/welcome` is `app/global-error.tsx`, so without one of its
// own the hero would take the whole front door to the error screen the moment
// the rotation or a pill showed a panel. A file of its own because `lazy`
// resolves once per module (`SpendByDayBlock.failed.test.tsx`, same reason).
vi.mock("./LandingHeroPanels", () => Promise.reject(new Error("Failed to fetch dynamically imported module")));

afterEach(() => {
  cleanup();
  setViewportMatches({});
  vi.restoreAllMocks();
});

describe("LandingHeroArt when the real panels fail to load", () => {
  it("keeps the design's static art in each view, and the landing around it", async () => {
    // React logs the caught error; it is the expected one, not noise to hide.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LandingScreen />);
    const desktop = within(screen.getByTestId("desktop-landing"));

    // The static art is also what `Suspense` shows while loading, so it is
    // asserted only once the rejection has landed — the boundary's catch is
    // what React logs.
    fireEvent.click(desktop.getByRole("button", { name: "Day 7" }));
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(desktop.getByText("Day 7 · Kyoto → Osaka")).toBeDefined();

    logged.mockClear();
    fireEvent.click(desktop.getByRole("button", { name: "Day 5" }));
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(desktop.getByText("Getting to Kurama — Day 5")).toBeDefined();

    expect(desktop.getByRole("heading", { name: "Put the best day on repeat." })).toBeDefined();
  });

  // The eager prefetch (desktop only) meets the same failure with no view
  // asking for it. Uncaught, that is an unhandled rejection, which fails this
  // run on its own — so rendering and letting it settle is the assertion.
  it("swallows a failed prefetch rather than leaving it unhandled", async () => {
    setViewportMatches({ "(min-width: 768px)": true });
    render(<LandingScreen />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId("desktop-landing")).toBeDefined();
  });
});
