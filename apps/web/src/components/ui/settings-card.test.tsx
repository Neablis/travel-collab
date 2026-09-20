import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsCard, SettingsRow, SETTINGS_MEASURE } from "./settings-card";

describe("SettingsCard", () => {
  it("is a named group a screen reader can find", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Your name">value</SettingsRow>
      </SettingsCard>,
    );
    expect(screen.getByRole("region", { name: "You" })).toBeTruthy();
  });

  // §34.5's look, asserted here because `components/ui/**` is the one place the
  // lint wall permits a class assertion — a primitive mapping a look onto
  // tokens has nothing else to assert, and the colour wall owns the rest.
  it("is a filled card with a moss header strip", () => {
    render(
      <SettingsCard heading="Display">
        <SettingsRow label="Distance">value</SettingsRow>
      </SettingsCard>,
    );
    const card = screen.getByRole("region", { name: "Display" });
    // "Every box on the page is `--color-surface` — no exceptions." The five
    // unfilled boxes §34.5 corrects read as holes in the column beside the
    // filled ones, so losing this is a real regression rather than a nit.
    expect(card.className).toContain("bg-surface");
    expect(card.className).toContain("border-hairline");
    const strip = screen.getByText("Display");
    expect(strip.className).toContain("bg-moss");
    expect(strip.className).toContain("uppercase");
  });
});

describe("SettingsRow", () => {
  // §34.5: a 170px label column, and a control sized to its content rather than
  // to the page. `w-42.5` is 42.5 x 4px = 170px — the artboard's own
  // `grid-cols-[170px_minmax(0,1fr)]` is an arbitrary Tailwind value the colour
  // wall rejects, so the scale expresses it instead.
  it("puts the label in a fixed 170px column", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Home airport">control</SettingsRow>
      </SettingsCard>,
    );
    expect(screen.getByTestId("settings-row-label").className).toContain("w-42.5");
  });

  it("labels its control when the control can be labelled", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Your name" htmlFor="n">
          <input id="n" aria-label="" />
        </SettingsRow>
      </SettingsCard>,
    );
    expect(screen.getByLabelText("Your name")).toBeTruthy();
  });

  // A read-only row has nothing to point a `<label for>` at — the address comes
  // from the identity provider — and an orphan `<label>` is worse than none: it
  // promises an edit that does not exist.
  it("does not pretend a read-only row is an editable field", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Signed in as">sam@example.com</SettingsRow>
      </SettingsCard>,
    );
    // The row names itself and shows its value...
    expect(screen.getByText("Signed in as")).toBeTruthy();
    expect(screen.getByText("sam@example.com")).toBeTruthy();
    // ...and nothing is labelled by it, because there is nothing to edit. An
    // orphan `<label for>` is worse than none: it promises an edit that does
    // not exist, which is what a disabled Input would also do.
    expect(screen.queryByLabelText("Signed in as")).toBeNull();
  });

  // §34.5: secondary explanation sits UNDER the label, not beside the control.
  it("puts the description under the label, inside the label column", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Home airport" description="Where a trip starts from.">
          control
        </SettingsRow>
      </SettingsCard>,
    );
    // Containment, not geometry: the claim is that the explanation lives in the
    // label column rather than beside the control, and that survives the column
    // being restyled. A "they share a top edge" assertion would not — see
    // `docs/guidelines/testing.md` §2's fourth question.
    expect(screen.getByTestId("settings-row-label").textContent).toContain(
      "Where a trip starts from.",
    );
  });

  // The separator belongs to the row, not to a positional rule on the parent,
  // so it survives a row being reordered or conditionally rendered.
  it("separates rows but does not rule off the last one", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="One">a</SettingsRow>
        <SettingsRow label="Two">b</SettingsRow>
      </SettingsCard>,
    );
    // Every row carries the same rule, `last:border-b-0` included — the
    // separator belongs to the row rather than to a positional rule on the
    // parent, so it survives a row being reordered or conditionally rendered.
    const rows = screen.getAllByTestId("settings-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain("border-b");
      expect(row.className).toContain("last:border-b-0");
    }
  });

  // **§34.5's two columns are a desktop rule**, and applying it at every width
  // clipped a real value on a real phone: at 411px the card's inner measure is
  // ~343px, the 170px label column left ~157px for the control, and
  // `dev+alice@example.com` ran under `SettingsCard`'s `overflow-hidden` — cut
  // mid-character, with no ellipsis to say anything had been lost. Seen on the
  // preview at 411x852, 2026-09-20.
  //
  // A class assertion rather than a measured width, deliberately: jsdom lays
  // nothing out, so a width here would be a number this environment invented.
  // What a unit test can hold is that the row asks to stack below `md` and to
  // be two columns at and above it — and `md` is 768px, never 640. The
  // rendered width is `e2e/m26-phone-targets.spec.ts`'s lane.
  it("stacks its two columns below md and restores them at md", () => {
    render(
      <SettingsCard heading="You">
        <SettingsRow label="Signed in as">dev+alice@example.com</SettingsRow>
      </SettingsCard>,
    );
    const row = screen.getByTestId("settings-row");
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("md:flex-row");
    // The label column is full width while stacked and 170px once beside the
    // control. Without the `md:` half the artboard's column is simply gone.
    const label = screen.getByTestId("settings-row-label");
    expect(label.className).toContain("w-full");
    expect(label.className).toContain("md:w-42.5");
  });
});

describe("SETTINGS_MEASURE", () => {
  // 580px, and it is 145 x 4px. Spelled as a constant because the panel applies
  // it and a second surface adopting the same rules should not re-derive it.
  it("is the 580px measure §34.5 names", () => {
    expect(SETTINGS_MEASURE).toBe("max-w-145");
  });
});
