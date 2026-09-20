import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, PHONE_TOUCH, buttonVariants } from "./button";
import { TOUCH } from "../home/NewTripWizard";

// SPEC §13.1 — "44px targets, always" — and KI-046, which measured 191 of 211
// controls under it on one trip screen. M26 link 14 folded the two hand-rolled
// substitutes into the design system; these hold what that fold has to keep
// true.
describe("PHONE_TOUCH", () => {
  // **The bug the fold fixed.** It was `min-h-11 sm:min-h-0`, so the floor
  // released at 640px — while every other phone rule in this app draws the line
  // at 767: `useIsPhone`'s `PHONE_MAX_WIDTH_PX`, `.assistant-rail`,
  // `.unscheduled-rack`, and `md:hidden` on the tab bar. A 28px control on a
  // 700px-wide phone in landscape sat inside KI-046's band and outside the only
  // rule meant to protect it.
  it("releases at the same breakpoint the rest of the app calls a phone", () => {
    expect(PHONE_TOUCH).toContain("md:min-h-0");
    expect(PHONE_TOUCH).not.toContain("sm:");
  });

  it("is a floor, not a height, so a wrapped label pushes the control taller", () => {
    expect(PHONE_TOUCH).toContain("min-h-11");
    expect(PHONE_TOUCH).not.toMatch(/(^|\s)h-11(\s|$)/);
  });

  // One definition, two names. `NewTripWizard` kept exporting `TOUCH` so its
  // importers did not all have to change in the same commit; if the two ever
  // stop being the same string, a surface silently gets a different floor.
  it("is the single definition NewTripWizard's TOUCH now re-exports", () => {
    expect(TOUCH).toBe(PHONE_TOUCH);
  });

  // The other size still exists and still means something different: `touch` is
  // 44px everywhere, for controls the design draws at 44px on both surfaces —
  // the sheet header, the Ask pill, the front door.
  //
  // **This test caught the sweep breaking it.** M26 link 14 put §13.1's phone
  // floor on the BASE, with `md:min-h-0` releasing it above 768px — which
  // applied to `touch` too, quietly turning "44px at every width" into
  // "44px on a phone". The size now re-asserts `md:min-h-11`, and what this
  // holds is that re-assertion rather than the absence of the release.
  it("is not the same thing as the base's phone floor: touch is 44px at every width", () => {
    const always = buttonVariants({ size: "touch" });
    expect(always).toContain("min-h-11");
    expect(always).toContain("md:min-h-11");
    expect(always).toContain("md:min-w-11");
  });

  // The base's own floor, which is what makes §13.1 true by construction rather
  // than by 48 people remembering it.
  it("is inherited by every button on a phone, and released above 768px", () => {
    const plain = buttonVariants({ size: "sm" });
    expect(plain).toContain("min-h-11");
    expect(plain).toContain("md:min-h-0");
    // Released at 768, like every other phone rule in this app — never at 640.
    expect(plain).not.toContain("sm:min-h-0");
  });

  it("applies to a real button without fighting its variant", () => {
    render(
      <Button size="sm" className={PHONE_TOUCH}>
        Choose premium
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Choose premium" });
    // `min-h-11` beats `sm`'s fixed `h-7` without the caller restating it.
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("h-7");
  });
});
