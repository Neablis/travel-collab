import { describe, expect, it } from "vitest";
import { listPlacement } from "./FieldPicker";

// Where the field list opens (PR #222's CI: on a phone the last picker in the
// bind step opened a list 44% of which ran off the bottom of the screen).
describe("listPlacement", () => {
  it("opens below at full height when a whole list fits there", () => {
    expect(listPlacement({ top: 100, bottom: 140 }, 800)).toEqual({ side: "below", maxHeight: 256 });
  });

  it("opens above, capped to the room there, when the box is near the bottom", () => {
    // 60px under the box, 600px over it.
    expect(listPlacement({ top: 608, bottom: 652 }, 720)).toEqual({ side: "above", maxHeight: 256 });
    expect(listPlacement({ top: 208, bottom: 252 }, 312)).toEqual({ side: "above", maxHeight: 200 });
  });

  it("stays below, shortened, when below is the roomier side", () => {
    expect(listPlacement({ top: 100, bottom: 140 }, 340)).toEqual({ side: "below", maxHeight: 192 });
  });
});
