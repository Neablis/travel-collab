import { UNBUILT_SOCIAL } from "@/test-support/unbuiltSocial";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setViewportMatches } from "../../../vitest.setup";
import { LandingScreen } from "./LandingScreen";

// The real panels' code never arrives (a deploy replaced the chunk, the network
// dropped). `Suspense` does not catch a rejected `lazy` import, and the only
// boundary above `/welcome` is `app/global-error.tsx`, so without one of its
// own the hero would take the whole front door to the error screen the moment
// the rotation or a pill showed a panel. A file of its own because `lazy`
// resolves once per module (`SpendByDayBlock.failed.test.tsx`, same reason).
vi.mock("./LandingHeroPanels", () => Promise.reject(new Error("Failed to fetch dynamically imported module")));

// The feature blocks' panels do load, and a cold worker's first transform of
// them outruns `findBy*` (`LandingHeroArt.test.tsx`), so they are loaded first.
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

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

    // The static art is also what `Suspense` shows while loading —
    // the hero hands the same art to `Suspense` and to the boundary — so the
    // art cannot tell "rejection landed" from "still loading", and waiting on
    // it gates nothing. The log is the only signal, but it must be narrowed to
    // our error: the spy sees every console.error, and under load React logs
    // warnings for unrelated reasons (act warnings), so a bare
    // toHaveBeenCalled() can pass before the boundary caught the rejection.
    // Vitest wraps the mock factory's rejection in its own error ("There was
    // an error when mocking a module"); our original error rides along as its
    // `cause`. Nothing else logged here is an Error with that cause.
    const landedRejection = async () => {
      await waitFor(() => {
        expect(
          logged.mock.calls.some((args) =>
            args.some(
              (a) =>
                a instanceof Error &&
                a.cause instanceof Error &&
                a.cause.message.includes("Failed to fetch dynamically imported module"),
            ),
          ),
        ).toBe(true);
      });
    };
    // The feature blocks' real panels are a module of their own and still
    // load; they are waited for so the Together drawing they replace, which
    // draws a suggestion's Accept, is not on the page for the checks below.
    await desktop.findByRole("list", { name: "Day 7 timeline" });

    fireEvent.click(desktop.getByRole("button", { name: "Day 7" }));
    await landedRejection();
    expect(desktop.getByText("Day 7 · Kyoto → Osaka")).toBeDefined();
    // The static art pictures only what trips have: suggestions, not comment
    // threads with replies (Mitchell, 2026-10-11).
    expect(desktop.queryAllByText(UNBUILT_SOCIAL).map((el) => el.textContent)).toEqual([]);

    logged.mockClear();
    fireEvent.click(desktop.getByRole("button", { name: "Day 5" }));
    await landedRejection();
    expect(desktop.getByText("Getting to Kurama — Day 5")).toBeDefined();
    expect(desktop.queryAllByText(UNBUILT_SOCIAL).map((el) => el.textContent)).toEqual([]);
    // A notebook offers no Accept, so its drawing draws none (review of PR 405);
    // only the map's suggestion, on the board, has one.
    expect(desktop.queryByText("Accept")).toBeNull();

    expect(desktop.getByRole("heading", { name: "Plan the trip together." })).toBeDefined();
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
