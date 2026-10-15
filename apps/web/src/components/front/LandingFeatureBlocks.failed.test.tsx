import { UNBUILT_SOCIAL } from "@/test-support/unbuiltSocial";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingFeatureBlocks } from "./LandingFeatureBlocks";

// The real panels' code never arrives (a deploy replaced the chunk, the network
// dropped). `Suspense` does not catch a rejected `lazy` import, so without a
// boundary of its own each block would take the front door to
// `app/global-error.tsx`. A file of its own because `lazy` resolves once per
// module (`LandingHeroArt.failed.test.tsx`, same reason).
vi.mock("./LandingFeaturePanels", () => Promise.reject(new Error("Failed to fetch dynamically imported module")));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LandingFeatureBlocks when the real panels fail to load", () => {
  it("keeps each block's drawing, and the blocks around it", async () => {
    // React logs the caught error; it is the expected one, not noise to hide.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LandingFeatureBlocks />);

    // The drawings are also what shows while loading — `LandingFeaturePanel`
    // hands the same children to `Suspense` and to the boundary — so the art
    // cannot tell "rejection landed" from "still loading", and waiting on the
    // art gates nothing. The log is the only signal, but it must be narrowed
    // to our error: the spy sees every console.error, and under load React
    // logs warnings for unrelated reasons (act warnings), so a bare
    // toHaveBeenCalled() can pass before the boundary caught the rejection and
    // the assertions run too early. Vitest wraps the mock factory's rejection
    // in its own error ("There was an error when mocking a module"); our
    // original error rides along as its `cause`. Nothing else logged here is
    // an Error with that cause.
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
    expect(within(screen.getByRole("region", { name: "Relive someone’s perfect day." })).getByText("A perfect Phuket beach day")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "The trip starts before the trip." })).getByText("Pontocho, maybe")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "How you’ll remember it." })).getByText(/best night of the trip/)).toBeDefined();
    // The drawings picture only what trips have: suggestions and past changes,
    // not replies or anybody "here now" (Mitchell, 2026-10-11).
    expect(screen.queryAllByText(UNBUILT_SOCIAL).map((el) => el.textContent)).toEqual([]);
  });
});
