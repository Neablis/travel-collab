import { describe, expect, it } from "vitest";
import { PLAYBOOKS_GENERIC, dayTabTitle } from "./playbooksPreview";

describe("dayTabTitle", () => {
  it("is the day's own name when the card is the day's", () => {
    expect(dayTabTitle("A slow day in Gion")).toBe("A slow day in Gion");
  });

  it("falls back to the generic title for the generic card or no card", () => {
    expect(dayTabTitle(PLAYBOOKS_GENERIC.title)).toBe("A playbook");
    expect(dayTabTitle(undefined)).toBe("A playbook");
    expect(dayTabTitle({ absolute: "x" })).toBe("A playbook");
  });
});
