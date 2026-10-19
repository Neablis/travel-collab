import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DISMISSED_PUBLISH_OFFERS, type UpdateUserPreferences, type UserPreferences } from "@tc/contracts";

// Each PATCH is held open until the test releases it, which is the only way to
// get two saves genuinely in flight at once — the condition the ordering rule
// below exists for, and one that cannot be reproduced by awaiting them in turn.
const pending: Array<{ patch: UpdateUserPreferences; settle: (value: UserPreferences) => void; fail: () => void }> = [];

const preferencesRead = vi.fn();
// What the mocked endpoint answers for the name; one test sets it to tell a
// fetched read from the defaults.
let fetchedName: string | null = null;
// One test makes the read fail, as a layout read and a mount fetch both can.
let readFails = false;
vi.mock("@/lib/apiClient", () => ({
  fetchPreferences: async () => (preferencesRead(), readFails ? { ok: false as const, error: { status: 500, message: "down" } } : {
    ok: true as const,
    value: {
      preferences: { displayName: fetchedName, homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false } satisfies UserPreferences,
      isAdmin: false,
    },
  }),
  updatePreferences: (patch: UpdateUserPreferences) =>
    new Promise((resolve) => {
      pending.push({
        patch,
        settle: (value) => resolve({ ok: true as const, value }),
        fail: () => resolve({ ok: false as const, error: { status: 500, message: "down" } }),
      });
    }),
}));

const { PreferencesProvider, useAccountPreferences, useIsAdmin, usePublishOfferDismissals } = await import("./PreferencesProvider");

/** Renders the live preferences and exposes `save` to the test. */
let save: (patch: UpdateUserPreferences) => Promise<unknown>;
function Probe() {
  const ctx = useAccountPreferences();
  save = ctx.save;
  return (
    <div>
      <span data-testid="unit">{ctx.preferences.distanceUnit}</span>
      <span data-testid="name">{ctx.preferences.displayName ?? "—"}</span>
      <span data-testid="admin">{useIsAdmin() ? "admin" : "member"}</span>
    </div>
  );
}

beforeEach(() => {
  pending.length = 0;
  preferencesRead.mockClear();
  fetchedName = null;
  readFails = false;
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
    pending[1]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "mi", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false });
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("mi"));

    // …and the older one lands second, carrying the world as it was before the
    // unit changed. Adopting it would put the unit back to km.
    pending[0]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false });

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
    pending[0]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false });
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Sam"));

    void save({ distanceUnit: "mi" });
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.settle({ displayName: "Sam", homeAirport: null, distanceUnit: "mi", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false });
    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("mi"));
  });

  // A reader with no session cookie (ADR-061's public playbooks): their read
  // could only 401, so it is not made, and the defaults stand.
  it("does not read preferences when there is no session cookie", async () => {
    render(
      <PreferencesProvider noSessionCookie>
        <Probe />
      </PreferencesProvider>,
    );
    expect(screen.getByTestId("unit").textContent).toBe("km");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preferencesRead).not.toHaveBeenCalled();
  });

  // No `initialRead`: the layout's read failed, or the mount point serves
  // nothing (the operator console's layout).
  it("reads them when there may be a session", async () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(preferencesRead).toHaveBeenCalledTimes(1));
  });

  // The `(app)` layout serves the first read with the page, so the provider
  // starts at it — the operator flag included, which the account menu reads —
  // and does not ask the endpoint the same question after hydration.
  it("starts at a served read and does not fetch it again", async () => {
    render(
      <PreferencesProvider
        initialRead={{
          preferences: { displayName: "Sam", homeAirport: null, distanceUnit: "mi", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false },
          defaultColor: null,
          isAdmin: true,
        }}
      >
        <Probe />
      </PreferencesProvider>,
    );
    expect(screen.getByTestId("unit").textContent).toBe("mi");
    expect(screen.getByTestId("admin").textContent).toBe("admin");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preferencesRead).not.toHaveBeenCalled();
  });

  // The layout's read failed, so the provider fetched for itself; then a
  // `router.refresh()` re-rendered the layout with a read that succeeded. The
  // fetch already in flight must still land, or the page is left on defaults.
  it("keeps its own fetch when a served read arrives after mount", async () => {
    fetchedName = "Fetched";
    const { rerender } = render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    rerender(
      <PreferencesProvider
        initialRead={{
          preferences: { displayName: "Sam", homeAirport: null, distanceUnit: "mi", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false },
          defaultColor: null,
          isAdmin: false,
        }}
      >
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(preferencesRead).toHaveBeenCalledTimes(1));
    // The fetched name, not the defaults' "—" and not the late read's "Sam".
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Fetched"));
  });
});

// M50 decision 7's dismissals. Each Dismiss is a save of the whole list, so
// what matters is what each PATCH carries.
describe("usePublishOfferDismissals", () => {
  let dismiss: ((tripId: string) => Promise<unknown>) | undefined;
  function DismissProbe() {
    const dismissals = usePublishOfferDismissals();
    dismiss = dismissals?.dismiss;
    return (
      <div>
        <span data-testid="loaded">{useAccountPreferences().loaded ? "loaded" : "loading"}</span>
        <span data-testid="dismissed">{dismissals === null ? "unknown" : dismissals.dismissed.join(",")}</span>
      </div>
    );
  }
  const served = (dismissedPublishOffers: string[]) => ({
    preferences: { displayName: null, homeAirport: null, distanceUnit: "km" as const, timeFormat: "12h" as const, avatar: null, color: null, publicDisplayName: false, dismissedPublishOffers },
    defaultColor: null,
    isAdmin: false,
  });

  // Two cards on Home, dismissed faster than the first save answers.
  it("carries an earlier dismissal whose save has not answered into the next", async () => {
    render(
      <PreferencesProvider initialRead={served(["x"])}>
        <DismissProbe />
      </PreferencesProvider>,
    );
    void dismiss!("a");
    void dismiss!("b");
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.patch).toEqual({ dismissedPublishOffers: ["x", "a", "b"] });
  });

  // A failed Dismiss leaves its offer up with the error. Carried into the next
  // trip's save, it would be stored anyway and the offer would vanish unasked.
  it("does not store a dismissal whose save failed with a later one", async () => {
    render(
      <PreferencesProvider initialRead={served([])}>
        <DismissProbe />
      </PreferencesProvider>,
    );
    const first = dismiss!("a");
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.fail();
    await first;
    void dismiss!("b");
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.patch).toEqual({ dismissedPublishOffers: ["b"] });
  });

  // Not knowing the stored list is not the same as an empty one: offering
  // again, and a Dismiss that would replace the list with one id, both follow
  // from reading it as empty.
  it("answers unknown, with no way to dismiss, after a failed read", async () => {
    readFails = true;
    render(
      <PreferencesProvider>
        <DismissProbe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("loaded"));
    expect(screen.getByTestId("dismissed").textContent).toBe("unknown");
    expect(dismiss).toBeUndefined();
  });

  // The contract caps the list, and ids of trips since deleted are never
  // pruned. A full list makes room rather than having every Dismiss refused.
  it("drops the oldest dismissal when the list is full", async () => {
    const full = Array.from({ length: MAX_DISMISSED_PUBLISH_OFFERS }, (_, i) => `t${i}`);
    render(
      <PreferencesProvider initialRead={served(full)}>
        <DismissProbe />
      </PreferencesProvider>,
    );
    void dismiss!("new");
    await waitFor(() => expect(pending).toHaveLength(1));
    const sent = pending[0]!.patch.dismissedPublishOffers!;
    expect(sent).toHaveLength(MAX_DISMISSED_PUBLISH_OFFERS);
    expect(sent[0]).toBe("t1");
    expect(sent.at(-1)).toBe("new");
  });
});
