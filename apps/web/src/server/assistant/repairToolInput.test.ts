import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASSISTANT_TOOLS } from "./registry";
import { repairToolInput, unwrapJsonStrings } from "./repairToolInput";

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
  // **This test asserted nothing until 2026-09-12.** It passed `read_day` a
  // `note` field, and `ReadDayInput` has no such field — so zod stripped the
  // unknown key, `{ days: [1] }` validated, and `repairToolInput` returned null
  // from its first line without ever reaching the unwrap it claimed to be
  // testing. The expectation was true for a reason that had nothing to do with
  // the behaviour. Rewritten against a field that really is a string, on a tool
  // that really does need repairing, so the assertion can fail.
  it("leaves a string field alone when it would parse as JSON, and still repairs its neighbour", () => {
    // `AddActivity.notes` takes a string and `tags` takes an array. The model
    // wrote a note that happens to start with "[", and JSON-encoded the tags
    // beside it. Reading the first character alone cannot tell these apart —
    // it re-typed BOTH, the note became an array `notes` rejects, and the whole
    // repair was thrown away with it.
    const repaired = repairToolInput("AddActivity", {
      title: "Lunch",
      dayRef: "1",
      // Valid JSON on purpose. An earlier draft of this test used
      // "[1, 2] are the best options", which `JSON.parse` rejects outright —
      // so it passed without the field ever being consulted, and a mutation
      // survived. The note has to be something the old code really would have
      // re-typed.
      notes: "[1, 2]",
      tags: '["meal"]',
    }) as { notes: unknown; tags: unknown };

    expect(repaired).not.toBeNull();
    // The value, untouched — a note is a note.
    expect(repaired.notes).toBe("[1, 2]");
    // The encoding, unwrapped — which only happens because `notes` no longer
    // poisons the validation.
    expect(repaired.tags).toEqual(["meal"]);
    expect(accepts("AddActivity", repaired)).toBe(true);
  });

  it("leaves a JSON-looking string alone when the field has no valid parse either", () => {
    // Nothing here is repairable into a valid input — `title` takes a string
    // and `[oops]` is not even JSON — so the turn still fails, which is the
    // correct outcome.
    expect(repairToolInput("AddActivity", { title: "[oops]" })).toBeNull();
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

// **The case the registry cannot reach.** `unwrapJsonStrings` skips a field
// that accepts the string AS WRITTEN, because such a string is a value rather
// than an encoding. No field of any tool today accepts both a JSON string and
// what it parses to — measured by asking every field of every tool — so through
// `repairToolInput` this rule is invisible: the later "does the field accept
// the parsed form?" check happens to cover for it. One `z.unknown()` field
// would end that, and the failure would be a value silently re-typed, which is
// the exact thing this module refuses to do. So it is proven directly.
describe("a field that accepts the string as written keeps it", () => {
  it("does not re-type a value into the array it would parse as", () => {
    const schema = z.object({ loose: z.unknown() });
    // The hazard, spelled out: this field takes the string AND the array.
    expect(schema.shape.loose.safeParse("[1, 2]").success).toBe(true);
    expect(schema.shape.loose.safeParse([1, 2]).success).toBe(true);

    expect(unwrapJsonStrings({ loose: "[1, 2]" }, schema)).toEqual({ loose: "[1, 2]" });
  });

  it("still unwraps a field that rejects the string and accepts the array", () => {
    const schema = z.object({ strict: z.array(z.number()) });
    expect(unwrapJsonStrings({ strict: "[1, 2]" }, schema)).toEqual({ strict: [1, 2] });
  });

  // The other guard, isolated. `notes`/`tags` on AddActivity cannot separate
  // the two — a string field skips on "accepts it as written" before the parsed
  // form is ever considered, so each guard masks the other and a mutation to
  // either survives. Here the field rejects BOTH forms, which is the only shape
  // that reaches the second check.
  it("leaves the string in place when the field rejects what it parses to as well", () => {
    const schema = z.object({ count: z.number() });
    expect(unwrapJsonStrings({ count: "[1, 2]" }, schema)).toEqual({ count: "[1, 2]" });
  });
});
