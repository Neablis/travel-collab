// ADR-058's pivot: which intents a turn may reach, and the latch that moves it.
import { describe, expect, it } from "vitest";
import { grantFor } from "./grants";
import { MAX_PIVOTS, newIntentLatch, reachableIntents } from "./intents";
import { switchIntentTool } from "./tools/intent";

const EDITOR_PAGE = grantFor({ surface: "page", role: "propose", plan: "propose", classifier: "propose" });
const VIEWER_PAGE = grantFor({ surface: "page", role: "read", plan: "propose", classifier: "propose" });

describe("the intents a turn may reach", () => {
  it("is compose and question for an editor on a page", () => {
    expect(reachableIntents("page", EDITOR_PAGE)).toEqual(["compose", "question"]);
  });

  // A pivot chooses among the turn's own admitted tools; it never widens the
  // grant. A viewer holds `pages` at `read`, so compose is not reachable.
  it("never includes an intent the grant does not hold", () => {
    expect(reachableIntents("page", VIEWER_PAGE)).toEqual(["question"]);
  });
});

describe("the intent latch", () => {
  it("moves to a reachable intent and records from, to, reason and step", () => {
    let steps = 0;
    const latch = newIntentLatch("compose", ["compose", "question"], () => steps);
    steps = 1;
    expect(latch.request("question", "they asked how much food costs")).toEqual({ ok: true });
    expect(latch.current()).toBe("question");
    expect(latch.pivots()).toEqual([{ from: "compose", to: "question", reason: "they asked how much food costs", step: 1 }]);
  });

  it("refuses an intent outside what the turn may reach, and stays put", () => {
    const latch = newIntentLatch("compose", reachableIntents("page", EDITOR_PAGE), () => 0);
    const result = latch.request("edit", "they want a stop moved");
    expect(result).toEqual({ ok: false, refused: expect.stringContaining("not open to this turn") });
    expect(latch.current()).toBe("compose");
    expect(latch.pivots()).toEqual([]);
  });

  it(`holds a turn to ${MAX_PIVOTS} pivots`, () => {
    const latch = newIntentLatch("compose", ["compose", "question"], () => 0);
    expect(latch.request("question", "a").ok).toBe(true);
    expect(latch.request("compose", "b").ok).toBe(true);
    expect(latch.request("question", "c")).toEqual({ ok: false, refused: expect.stringContaining("already switched") });
    expect(latch.current()).toBe("compose");
    expect(latch.pivots()).toHaveLength(MAX_PIVOTS);
  });

  it("answers the model through switch_intent in words it can act on", async () => {
    const intent = newIntentLatch("question", ["question"], () => 0);
    expect(await switchIntentTool.run({ to: "compose", reason: "build the page" }, { intent })).toEqual({
      switched: false,
      refused: expect.stringContaining("question"),
    });
  });
});
