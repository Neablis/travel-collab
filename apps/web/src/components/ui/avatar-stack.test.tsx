import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvatarStack, type AvatarStackPerson } from "./avatar-stack";

// A face is decorative (its chip is `aria-hidden`) and has no role, so it is
// found by its testid; the tip it shows on hover is drawn from `data-avatar-tip` by
// globals.css, which jsdom does not load, so the attribute is the assertion.
const NAMES = ["Ann Lee", "Ben Ode", "Cy Park", "Dee Ross", "Eve Sato", "Fay Tran", "Gus Umar"];

const people = (count: number): AvatarStackPerson[] =>
  NAMES.slice(0, count).map((name, i) => ({ id: `u-${i}`, name, avatar: null, color: null }));

describe("AvatarStack", () => {
  it("draws the first `max` faces and counts the rest", () => {
    render(<AvatarStack people={people(7)} max={4} />);
    expect(screen.getAllByTestId("avatar-face")).toHaveLength(4);
    expect(screen.getByText("+3")).toBeTruthy();
  });

  // Witness for the count: one at the cap is drawn whole, with nothing after.
  it("draws everyone, and no count, when they fit", () => {
    render(<AvatarStack people={people(4)} max={4} />);
    expect(screen.getAllByTestId("avatar-face")).toHaveLength(4);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("names each face in its tip, with what the caller knows about them after the name", () => {
    const [ann, ben] = people(2);
    render(<AvatarStack people={[ann!, { ...ben!, online: true, detail: "online" }]} />);
    expect(screen.getAllByTestId("avatar-face").map((face) => face.dataset.avatarTip)).toEqual(["Ann Lee", "Ben Ode · online"]);
  });

  // RiverBlock's stack sits under a block that takes the pointer: no spread
  // and no tip, and its faces keep their names as titles instead.
  it("draws no tip when it is not interactive", () => {
    render(<AvatarStack people={people(2)} interactive={false} />);
    const faces = screen.getAllByTestId("avatar-face");
    expect(faces.map((face) => face.dataset.avatarTip)).toEqual([undefined, undefined]);
    expect(screen.getAllByTitle(/.+/).map((chip) => chip.getAttribute("title"))).toEqual(["Ann Lee", "Ben Ode"]);
  });
});
