import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const updatePreferencesMock = vi.fn(async (patch: UpdateUserPreferences) => {
  patches.push(patch);
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

vi.mock("@/lib/apiClient", () => ({
  fetchPreferences: async () => ({ ok: true as const, value: stored }),
  updatePreferences: (patch: UpdateUserPreferences) => updatePreferencesMock(patch),
}));

function mount() {
  return render(
    <PreferencesProvider>
      <AccountSettingsSheet open onOpenChange={() => {}} email="sam@example.com" />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
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
});
