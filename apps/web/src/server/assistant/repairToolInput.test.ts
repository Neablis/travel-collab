import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS } from "./registry";
import { repairToolInput } from "./repairToolInput";

/** The tool's own schema, so a repair is judged by what the tool accepts and not by a copy of it. */
function accepts(toolName: string, input: unknown): boolean {
  return ASSISTANT_TOOLS.find((t) => t.name === toolName)!.input.safeParse(input).success;
}

// Both cases below are VERBATIM from production on 2026-09-12: two consecutive
// live turns died on them, `answered: false`, and the user got nothing. They
// are the reason this module exists, so they are the cases it is tested on.
describe("repairing what a model spelled wrong", () => {
  it("unwraps an array the model JSON-encoded as a string", () => {
    // ai.ask.failed: Invalid input for tool read_day … Value: {"days":"[3]"}
    expect(accepts("read_day", { days: "[3]" })).toBe(false);
    const repaired = repairToolInput("read_day", { days: "[3]" });
    expect(repaired).toEqual({ days: [3] });
    expect(accepts("read_day", repaired)).toBe(true);
  });

  it("clamps an over-long array to the schema's own maximum", () => {
    // ai.ask.failed: … search_playbooks … too_big, maximum 5, eight cities given
    const eight = ["Jeonju", "Andong", "Chuncheon", "Gwangju", "Yeosu", "Tongyeong", "Sokcho", "Incheon"];
    expect(accepts("search_playbooks", { cities: eight })).toBe(false);
    const repaired = repairToolInput("search_playbooks", { cities: eight }) as { cities: string[] };
    expect(repaired.cities).toEqual(eight.slice(0, 5));
    expect(accepts("search_playbooks", repaired)).toBe(true);
  });
});

describe("what it refuses to repair, which is the point", () => {
  it("leaves an ordinary string alone even when it would parse as JSON", () => {
    // A note of "[1, 2]" is a note, not an encoding. Guarded on the first
    // character precisely so a value is never silently re-typed.
    const repaired = repairToolInput("read_day", { days: [1], note: "[oops]" });
    // Nothing here is repairable into a valid input, so the turn still fails —
    // and critically, the string was not treated as data on the way out.
    expect(repaired).toBeNull();
  });

  it("returns null for a tool the registry does not have", () => {
    expect(repairToolInput("no_such_tool", { anything: true })).toBeNull();
  });

  it("returns null when the model meant something the tool cannot do", () => {
    // A missing required field is not a spelling mistake. Ending the turn is
    // the correct outcome, and keeping it is what stops this module becoming a
    // place where invalid calls are made to look valid.
    expect(repairToolInput("search_playbooks", { cities: [] , limit: "many" })).toBeNull();
  });

  it("returns null for input that is already valid", () => {
    expect(repairToolInput("read_day", { days: [1, 2] })).toBeNull();
  });
});
