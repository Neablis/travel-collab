import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { ProfileSection } from "./ProfileSection";
import { PreferencesProvider } from "./PreferencesProvider";

// The server is what normalizes `homeAirport` (the contract carries no
// transform), so the stub does too — otherwise these tests would prove the
// field displays whatever it was handed, which is not the claim.
let stored: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
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
    ...("timeFormat" in patch && patch.timeFormat ? { timeFormat: patch.timeFormat } : {}),
    ...("avatar" in patch ? { avatar: patch.avatar ?? null } : {}),
    ...("color" in patch ? { color: patch.color ?? null } : {}),
    ...("publicDisplayName" in patch && patch.publicDisplayName !== undefined
      ? { publicDisplayName: patch.publicDisplayName }
      : {}),
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
    return { ok: true as const, value: { preferences: stored, isAdmin: false, defaultColor: "rose" as const } };
  },
  updatePreferences: (patch: UpdateUserPreferences) => updatePreferencesMock(patch),
}));

// The colour a chip is GIVEN, read off a wrapper rather than off its class:
// the test-quality wall keeps classes out of this file, and colour to class is
// `person-chip.test.tsx`'s claim. What this file owns is which colour the
// surface hands the chip.
vi.mock("@/components/ui/person-chip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/person-chip")>();
  return {
    ...actual,
    PersonChip: (props: React.ComponentProps<typeof actual.PersonChip>) => (
      <span data-testid="person-chip" data-color={props.color ?? "none"}>
        <actual.PersonChip {...props} />
      </span>
    ),
  };
});

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

// **These tests moved with the fields, not with the container.** They were
// `AccountSettingsSheet.test.tsx` until M26 link 1 turned the Sheet into the
// `/account` route; every claim below is about a field's behaviour and survived
// the move unchanged. That is the point of migrating rather than rewriting —
// the PR-112 guards at the bottom are the reason this file exists, and a fresh
// file would have been written without them.
const openTokens = vi.fn();

// The sign-in name is the provider's, and the fallback both persona
// descriptions name: "Sam Keller" on trips, "Sam K." on public pages.
const SIGN_IN = { userId: "dev-sam", name: "Sam Keller" };

function mount() {
  return render(
    <PreferencesProvider>
      <ProfileSection email="sam@example.com" signIn={SIGN_IN} onOpenTokens={openTokens} />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  holdFetch = null;
  holdSave = null;
  stored = { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
  refuse = null;
  patches.length = 0;
  updatePreferencesMock.mockClear();
  openTokens.mockClear();
});
afterEach(cleanup);

describe("ProfileSection", () => {
  it("shows the signed-in email as a row that cannot be edited", async () => {
    mount();
    expect(await screen.findByText("sam@example.com")).toBeTruthy();
    // Identity owns the address; offering an edit that does not exist is the
    // thing a disabled input would do. The row is labelled "Signed in as"
    // rather than "Email" since §34.5 — it states a fact instead of naming a
    // field — so the query covers both spellings and the claim is unchanged.
    expect(screen.queryByRole("textbox", { name: /signed in as|email/i })).toBeNull();
  });

  // **Three states, and the middle one used to be told as a lie.** `undefined`
  // is "the session probe has not answered yet"; `""` is "your provider gave no
  // address". `AccountScreen` flattened the first into the second with
  // `user?.email ?? ""`, so a signed-in reader was told their sign-in had
  // supplied no address — briefly on every load, and permanently if the probe
  // failed (CodeRabbit, PR 196). A claim about the reader's own account is the
  // last thing to guess at.
  it("does not claim the sign-in gave no address before the session has answered", async () => {
    render(
      <PreferencesProvider>
        <ProfileSection email={undefined} signIn={undefined} onOpenTokens={openTokens} />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("…")).toBeTruthy();
    expect(screen.queryByText("Not provided by your sign-in")).toBeNull();
  });

  it("does say so once the session has answered with no address", async () => {
    render(
      <PreferencesProvider>
        <ProfileSection email="" signIn={SIGN_IN} onOpenTokens={openTokens} />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("Not provided by your sign-in")).toBeTruthy();
  });

  it("saves a name on blur, once", async () => {
    mount();
    const field = await screen.findByLabelText("Display name");
    await userEvent.type(field, "Mitchell");
    await userEvent.tab();

    await waitFor(() => expect(patches).toEqual([{ displayName: "Mitchell" }]));
  });

  it("sends an explicit null to clear a name, not an omitted field", async () => {
    stored = { displayName: "Mitchell", homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
    mount();
    const field = await screen.findByLabelText("Display name");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("Mitchell"));
    await userEvent.clear(field);
    await userEvent.tab();

    // Absent would mean "leave it alone"; the two are different operations.
    await waitFor(() => expect(patches).toEqual([{ displayName: null }]));
  });

  it("sends nothing when the value has not changed", async () => {
    stored = { displayName: "Mitchell", homeAirport: null, distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
    mount();
    const field = await screen.findByLabelText("Display name");
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
    stored = { displayName: null, homeAirport: "SFO", distanceUnit: "km", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
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

  // SPEC §35.4: API tokens left the tab strip, and this line is now the only
  // way to them from the screen — on a phone as much as a desktop.
  it("ends with the way to API tokens", async () => {
    mount();
    expect(await screen.findByText("Writing your own program against your trips? That needs an API token.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "API tokens →" }));
    expect(openTokens).toHaveBeenCalledTimes(1);
  });

  // ADR-052, reviewed 2026-09-27: temperature and rain follow this one
  // setting, and Mitchell had not realised, because it said "Distance". It
  // names every quantity it moves; the stored field is still `distanceUnit`.
  it("switches units immediately, at account scope, naming what each one means", async () => {
    mount();
    const units = await screen.findByRole("radiogroup", { name: "Units" });
    expect(screen.getByText("Units")).toBeTruthy();
    expect(
      screen.getByText("Distances, temperatures and rainfall across your trips. Metric is km, °C and mm; imperial is mi, °F and in."),
    ).toBeTruthy();
    const imperial = within(units).getByRole("radio", { name: "Imperial" });
    expect(within(units).getByRole("radio", { name: "Metric" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(imperial);

    await waitFor(() => expect(patches).toEqual([{ distanceUnit: "mi" }]));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Imperial" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("switches to the 24-hour clock immediately, at account scope", async () => {
    mount();
    const twentyFour = await screen.findByRole("radio", { name: "24-hour (14:30)" });
    await userEvent.click(twentyFour);

    await waitFor(() => expect(patches).toEqual([{ timeFormat: "24h" }]));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "24-hour (14:30)" }).getAttribute("aria-checked")).toBe("true"),
    );
  });

  // M38 part 4, artboard 1. The chip itself is `aria-hidden` — the name is
  // printed beside it — so the preview is found by its testid and read for
  // what a sighted person sees: the glyph, or the initials. Its colour exists
  // only as a class, which the test-quality wall keeps out of this file;
  // `person-chip.test.tsx` owns colour to class, and the swatch's own
  // `aria-checked` is what says the choice landed.
  describe("how you appear", () => {
    it("names the sign-in name each description falls back to", async () => {
      mount();
      expect(
        await screen.findByText("What people on your trips see. Empty, it is your sign-in name, Sam Keller."),
      ).toBeTruthy();
      // `publicNameFor`'s short form, never the address.
      expect(screen.getByText("While this is off, days you publish say Sam K.")).toBeTruthy();
    });

    it("previews the sign-in name's initials until a glyph is chosen", async () => {
      mount();
      const preview = await screen.findByTestId("persona-preview");
      expect(within(preview).getByText("Sam Keller")).toBeTruthy();
      expect(within(preview).getByText("SK")).toBeTruthy();
      // Nothing chosen is the Initials radio, not a group with nothing checked.
      const avatar = screen.getByRole("radiogroup", { name: "Avatar" });
      expect(within(avatar).getByRole("radio", { name: "Initials" }).getAttribute("aria-checked")).toBe("true");
    });

    it("saves a picked glyph, and clears it when the same glyph is picked again", async () => {
      mount();
      const avatar = await screen.findByRole("radiogroup", { name: "Avatar" });
      const compass = within(avatar).getByRole("radio", { name: "Compass" });
      await waitFor(() => expect(compass).toHaveProperty("disabled", false));

      await userEvent.click(compass);
      await waitFor(() => expect(patches).toEqual([{ avatar: "compass" }]));
      await waitFor(() => expect(compass.getAttribute("aria-checked")).toBe("true"));
      // The preview draws the glyph in place of the initials.
      const preview = screen.getByTestId("persona-preview");
      expect(preview.innerHTML).toContain("lucide-compass");
      expect(within(preview).queryByText("SK")).toBeNull();

      await userEvent.click(compass);
      await waitFor(() => expect(patches).toEqual([{ avatar: "compass" }, { avatar: null }]));
      await waitFor(() =>
        expect(within(avatar).getByRole("radio", { name: "Initials" }).getAttribute("aria-checked")).toBe("true"),
      );
      expect(within(screen.getByTestId("persona-preview")).getByText("SK")).toBeTruthy();
    });

    // A trip draws someone who stored no colour in the server's derived one
    // (`defaultColor`, here rose); the preview must not draw slate instead.
    it("previews the colour trips derive until one is chosen", async () => {
      mount();
      const colour = await screen.findByRole("radiogroup", { name: "Colour" });
      const chip = within(screen.getByTestId("persona-preview")).getByTestId("person-chip");
      await waitFor(() => expect(chip.getAttribute("data-color")).toBe("rose"));

      const teal = within(colour).getByRole("radio", { name: "Teal" });
      await userEvent.click(teal);
      await waitFor(() => expect(chip.getAttribute("data-color")).toBe("teal"));
    });

    it("saves a picked colour", async () => {
      mount();
      const colour = await screen.findByRole("radiogroup", { name: "Colour" });
      const teal = within(colour).getByRole("radio", { name: "Teal" });
      await waitFor(() => expect(teal).toHaveProperty("disabled", false));
      // No stored colour checks no swatch: Account shows the stored choice
      // only, and the colour a trip derives is the server's to decide.
      expect(within(colour).queryByRole("radio", { checked: true })).toBeNull();

      await userEvent.click(teal);
      await waitFor(() => expect(patches).toEqual([{ color: "teal" }]));
      await waitFor(() => expect(teal.getAttribute("aria-checked")).toBe("true"));
    });

    it("shows a refused pick, and does not leave it looking chosen", async () => {
      mount();
      const colour = await screen.findByRole("radiogroup", { name: "Colour" });
      const plum = within(colour).getByRole("radio", { name: "Plum" });
      await waitFor(() => expect(plum).toHaveProperty("disabled", false));
      refuse = "Something went wrong saving that.";

      await userEvent.click(plum);
      expect(await screen.findByText("Something went wrong saving that.")).toBeTruthy();
      expect(plum.getAttribute("aria-checked")).toBe("false");
    });

    it("turns the display name on for public pages", async () => {
      mount();
      const box = await screen.findByRole("checkbox", { name: /show my display name on public pages/i });
      await waitFor(() => expect(box).toHaveProperty("disabled", false));
      expect(box).toHaveProperty("checked", false);

      await userEvent.click(box);
      await waitFor(() => expect(patches).toEqual([{ publicDisplayName: true }]));
      await waitFor(() => expect(box).toHaveProperty("checked", true));
    });
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

      await userEvent.click(await screen.findByRole("radio", { name: "Imperial" }));
      // Saving here would write the provider's DEFAULTS over a stored value
      // this screen has never seen.
      expect(updatePreferencesMock).not.toHaveBeenCalled();

      release();
      // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
      await waitFor(() => expect(screen.getByRole("radio", { name: "Imperial" })).toBeTruthy());
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
      const name = await screen.findByLabelText("Display name");

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

      expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Sam Smith");
    });
  });
});
