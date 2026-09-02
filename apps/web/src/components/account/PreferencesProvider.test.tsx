import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateUserPreferences, UserPreferences } from "@tc/contracts";

// Each PATCH is held open until the test releases it, which is the only way to
// get two saves genuinely in flight at once — the condition the ordering rule
// below exists for, and one that cannot be reproduced by awaiting them in turn.
const pending: Array<{ patch: UpdateUserPreferences; settle: (value: UserPreferences) => void }> = [];

vi.mock("@/lib/apiClient", () => ({
  fetchPreferences: async () => ({
    ok: true as const,
    value: { displayName: null, homeAirport: null, distanceUnit: "km" } satisfies UserPreferences,
  }),
  updatePreferences: (patch: UpdateUserPreferences) =>
    new Promise((resolve) => {
      pending.push({ patch, settle: (value) => resolve({ ok: true as const, value }) });
    }),
}));

const { PreferencesProvider, useAccountPreferences } = await import("./PreferencesProvider");

/** Renders the live preferences and exposes `save` to the test. */
let save: (patch: UpdateUserPreferences) => Promise<unknown>;
function Probe() {
  const ctx = useAccountPreferences();
  save = ctx.save;
  return (
    <div>
      <span data-testid="unit">{ctx.preferences.distanceUnit}</span>
      <span data-testid="name">{ctx.preferences.displayName ?? "—"}</span>
    </div>
  );
}

beforeEach(() => {
  pending.length = 0;
});
afterEach(cleanup);

describe("PreferencesProvider", () => {
  // Found by review on pull request 112. Every PATCH response carries the WHOLE
  // preferences object rather than a patch, so an older response arriving
  // second used to reinstate the values it was built from — silently undoing
  // the newer save on screen and in the map labels until the next reload.
  //
  // The Sheet makes this reachable without contrivance: committing a name on
  // blur and flipping the distance unit can be in flight together.
  it("ignores a stale response that resolves after a newer one", async () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("km"));

    // Two saves in flight: the name first, then the unit.
    void save({ displayName: "Sam" });
    void save({ distanceUnit: "mi" });
    await waitFor(() => expect(pending).toHaveLength(2));

    // The NEWER one lands first…
    pending[1]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "mi" });
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("mi"));

    // …and the older one lands second, carrying the world as it was before the
    // unit changed. Adopting it would put the unit back to km.
    pending[0]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "km" });

    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Sam"));
    expect(screen.getByTestId("unit").textContent).toBe("mi");
  });

  // The ordering rule must not cost a legitimate later save: sequence numbers
  // rise, so the newest response is always adopted no matter how many precede
  // it. Without this, "ignore the stale one" could be implemented as "ignore
  // everything after the first" and still pass the test above.
  it("still adopts each save when they resolve in order", async () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("km"));

    void save({ displayName: "Sam" });
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "km" });
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Sam"));

    void save({ distanceUnit: "mi" });
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "mi" });
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("mi"));
  });
});
