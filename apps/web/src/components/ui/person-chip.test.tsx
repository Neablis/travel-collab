import { render, screen } from "@testing-library/react";
import { tripMemberProfileFactory } from "@tc/factories";
import type { TripMemberProfile } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { PersonChip, type PersonChipProps } from "./person-chip";

// The chip is `aria-hidden` and has no role, so it is found by the `title`
// it passes through — which is also how the passthrough itself is proven.
// Its colour and ring exist only as classes, with no label standing in for
// them, which is why `components/ui/**` may assert classes
// (apps/web/eslint.config.mjs, the test-quality wall's part 3).
const TITLE = "Shown in clay on this trip";

function chipFor(member: TripMemberProfile, props: Partial<PersonChipProps> = {}): HTMLElement {
  render(
    <PersonChip
      name={member.displayName ?? member.userId}
      avatar={member.avatar}
      color={member.color}
      title={TITLE}
      {...props}
    />,
  );
  return screen.getByTitle(props.title ?? TITLE);
}

describe("PersonChip", () => {
  it("draws the chosen glyph instead of initials", () => {
    // `palm` is the one key whose lucide name differs (TreePalm), so it proves
    // the map is read rather than the key echoed into a class name.
    const chip = chipFor(tripMemberProfileFactory.build({ displayName: "Kenji Watanabe", avatar: "palm" }));
    expect(chip.innerHTML).toContain("lucide-tree-palm");
    expect(chip.textContent).toBe("");
  });

  it("draws initials from the name when no glyph is chosen", () => {
    const chip = chipFor(tripMemberProfileFactory.build({ displayName: "Kenji Watanabe", avatar: null }));
    expect(chip.innerHTML).not.toContain("<svg");
    expect(chip.textContent).toBe("KW");
  });

  it("drops to one initial at xs", () => {
    const chip = chipFor(tripMemberProfileFactory.build({ displayName: "Kenji Watanabe" }), { size: "xs" });
    expect(chip.textContent).toBe("K");
  });

  it("paints the person's colour with the on-colour ink", () => {
    const chip = chipFor(tripMemberProfileFactory.build({ color: "teal" }));
    expect(chip.className).toContain("bg-person-teal");
    expect(chip.className).toContain("text-person-on");
  });

  it("falls back to the slate person colour when none is chosen", () => {
    const chip = chipFor(tripMemberProfileFactory.build({ color: null }));
    expect(chip.className).toContain("bg-person-slate");
  });

  it("adds the surface ring only when asked", () => {
    const member = tripMemberProfileFactory.build();
    expect(chipFor(member, { title: "plain" }).className).not.toContain("ring-surface");
    expect(chipFor(member, { ring: true }).className).toContain("ring-2 ring-surface");
  });

  it("stays out of the accessibility tree", () => {
    const chip = chipFor(tripMemberProfileFactory.build());
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});
