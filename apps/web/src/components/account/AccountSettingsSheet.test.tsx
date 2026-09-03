import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { AccountSettingsSheet } from "./AccountSettingsSheet";
import { PreferencesProvider } from "./PreferencesProvider";

// The server is what normalizes `homeAirport` (the contract carries no
// transform), so the stub does too — otherwise these tests would prove the
// field displays whatever it was handed, which is not the claim.
let stored: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "km" };
let refuse: string | null = null;
const patches: UpdateUserPreferences[] = [];

// Set by `pendSave` to hold the NEXT save open, so a draft can be typed while
// an earlier save is still in flight.
let holdSave: (() => void) | null = null;

const updatePreferencesMock = vi.fn(async (patch: UpdateUserPreferences) => {
  patches.push(patch);
  if (holdSave !== null) {
    await new Promise<void>((go) => (holdSave = go));
  }
  if (refuse !== null) return { ok: false as const, error: { status: 400, message: refuse } };
  stored = {
    ...stored,
    ...("displayName" in patch ? { displayName: patch.displayName ?? null } : {}),
    ...("homeAirport" in patch
      ? { homeAirport: patch.homeAirport === null || patch.homeAirport === undefined ? null : patch.homeAirport.trim().toUpperCase() }
      : {}),
    ...("distanceUnit" in patch && patch.distanceUnit ? { distanceUnit: patch.distanceUnit } : {}),
  };
  return { ok: true as const, value: stored };
});

// Held open by `pendFetch` so the "before loaded" guard is reachable: the
// component's behaviour before the first read resolves is a real state, and
// asserting it needs the read not to have resolved.
let holdFetch: (() => void) | null = null;

vi.mock("@/lib/apiClient", () => ({
  fetchPreferences: async () => {
    if (holdFetch !== null) await new Promise<void>((go) => (holdFetch = go));
    return { ok: true as const, value: stored };
  },
  updatePreferences: (patch: UpdateUserPreferences) => updatePreferencesMock(patch),
}));

/** Make the next `updatePreferences` hang until the returned function is called. */
function pendSave() {
  holdSave = () => {};
  return () => {
    const go = holdSave;
    holdSave = null;
    go?.();
  };
}

/** Make the next `fetchPreferences` hang until the returned function is called. */
function pendFetch() {
  holdFetch = () => {};
  return () => {
    const go = holdFetch;
    holdFetch = null;
    go?.();
  };
}

function mount() {
  return render(
    <PreferencesProvider>
      <AccountSettingsSheet open onOpenChange={() => {}} email="sam@example.com" />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  holdFetch = null;
  holdSave = null;
  stored = { displayName: null, homeAirport: null, distanceUnit: "km" };
  refuse = null;
  patches.length = 0;
  updatePreferencesMock.mockClear();
});
afterEach(cleanup);

describe("AccountSettingsSheet", () => {
  it("shows the signed-in email as a row that cannot be edited", async () => {
    mount();
    expect(await screen.findByText("sam@example.com")).toBeTruthy();
    // Identity owns the address; offering an edit that does not exist is the
    // thing a disabled input would do.
    expect(screen.queryByRole("textbox", { name: /email/i })).toBeNull();
  });

  it("saves a name on blur, once", async () => {
    mount();
    const field = await screen.findByLabelText("Your name");
    await userEvent.type(field, "Mitchell");
    await userEvent.tab();

    await waitFor(() => expect(patches).toEqual([{ displayName: "Mitchell" }]));
  });

  it("sends an explicit null to clear a name, not an omitted field", async () => {
    stored = { displayName: "Mitchell", homeAirport: null, distanceUnit: "km" };
    mount();
    const field = await screen.findByLabelText("Your name");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("Mitchell"));
    await userEvent.clear(field);
    await userEvent.tab();

    // Absent would mean "leave it alone"; the two are different operations.
    await waitFor(() => expect(patches).toEqual([{ displayName: null }]));
  });

  it("sends nothing when the value has not changed", async () => {
    stored = { displayName: "Mitchell", homeAirport: null, distanceUnit: "km" };
    mount();
    const field = await screen.findByLabelText("Your name");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("Mitchell"));
    await userEvent.click(field);
    await userEvent.tab();

    expect(updatePreferencesMock).not.toHaveBeenCalled();
  });

  // The normalization is SERVER-side by design: the contract validates
  // `^[A-Z]{3}$` and rejects "sfo" rather than coercing it. The field has to
  // show what was actually stored, or the client looks like it disagreed.
  it("sends the airport code as typed and shows back what the server stored", async () => {
    mount();
    const field = await screen.findByLabelText("Home airport");
    await userEvent.type(field, "sfo");
    await userEvent.tab();

    await waitFor(() => expect(patches).toEqual([{ homeAirport: "sfo" }]));
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("SFO"));
  });

  it("shows a refusal and puts the field back to what is stored", async () => {
    stored = { displayName: null, homeAirport: "SFO", distanceUnit: "km" };
    mount();
    const field = await screen.findByLabelText("Home airport");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("SFO"));
    refuse = "Use a three-letter airport code, like SFO.";
    await userEvent.clear(field);
    await userEvent.type(field, "XX");
    await userEvent.tab();

    expect(await screen.findByText("Use a three-letter airport code, like SFO.")).toBeTruthy();
    // A rejected value left in the box reads as saved — the one thing a
    // settings form must never do.
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("SFO"));
  });

  it("switches distance units immediately, at account scope", async () => {
    mount();
    const miles = await screen.findByRole("radio", { name: "Miles" });
    await userEvent.click(miles);

    await waitFor(() => expect(patches).toEqual([{ distanceUnit: "mi" }]));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Miles" }).getAttribute("aria-checked")).toBe("true"));
  });

  // Both fixes came from review on pull request 112, and both were shipped as
  // comments describing a guard with nothing enforcing it — the defect class
  // AGENTS.md names (KI-1, KI-14) and the one I insisted on covering for the
  // equivalent fix on pull request 110. Flagged in review; covered here.
  describe("the guards the component documents", () => {
    // **The "flipping the unit wipes a half-typed name" scenario is NOT
    // reachable, and there is deliberately no test for it here.** Review on
    // pull request 112 asked for one; writing it showed the scenario does not
    // occur. The resync effect is keyed on `[preferences.displayName]`, not on
    // the whole preferences object, so a unit save — which leaves
    // `displayName` untouched — never re-runs it. Verified rather than
    // reasoned: with the `editing.current.name` guard REMOVED, a test doing
    // exactly that still passed, which makes it a test that proves nothing —
    // the species this repo keeps catching (KI-1, KI-14).
    //
    // The guard is kept because it is correct for the case that IS reachable:
    // `displayName` changing from a source other than this field's own commit.
    // It is not covered here because the suite has no second writer to
    // simulate one, and a test that fakes one would be asserting the mock.

    it("does not save a preference before the first read has resolved", async () => {
      const release = pendFetch();
      mount();

      await userEvent.click(await screen.findByRole("radio", { name: "Miles" }));
      // Saving here would write the provider's DEFAULTS over a stored value
      // this Sheet has never seen.
      expect(updatePreferencesMock).not.toHaveBeenCalled();

      release();
      // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
      await waitFor(() => expect(screen.getByRole("radio", { name: "Miles" })).toBeTruthy());
    });

    // Asked for in review on pull request 112, as the reachable half of the
    // resync guard — and reachable without faking a second writer, which is
    // what the earlier note said could not be done. It can: the person's own
    // in-flight save is the second writer.
    //
    // Commit a name, keep typing while that save is still in flight, then let
    // it land. `preferences.displayName` changes from null to the committed
    // value, which re-runs the resync — and the draft typed since must survive.
    it("keeps a newer draft when an earlier name save lands", async () => {
      const release = pendSave();
      mount();
      const name = await screen.findByLabelText(/your name/i);

      await userEvent.type(name, "Sam");
      (name as HTMLInputElement).blur();
      await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalled());

      // Still typing while the save is in flight.
      await userEvent.type(name, " Smith");

      // `act` rather than `waitFor`: the resync is an effect, and the thing
      // being asserted is that it did NOT change the field. A `waitFor` on the
      // input's existence would pass whether or not the effect ever ran, which
      // is the vacuity this repo keeps catching — an earlier draft of this test
      // did exactly that and passed with the guard removed.
      await act(async () => {
        release();
      });

      expect((screen.getByLabelText(/your name/i) as HTMLInputElement).value).toBe("Sam Smith");
    });
  });
});
