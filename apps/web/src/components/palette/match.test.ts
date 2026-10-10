import { describe, expect, it } from "vitest";
import { rankCommands } from "./match";

const commands = [
  { label: "Plan" },
  { label: "Calendar" },
  { label: "New stop", keywords: ["add"] },
  { label: "Ask the assistant", keywords: ["ai", "chat"] },
  { label: "Trip settings" },
  { label: "Kyoto in spring" },
];
const labels = (query: string) => rankCommands(commands, query).map((c) => c.label);

describe("rankCommands", () => {
  it("lists everything, in order, for nothing typed", () => {
    expect(labels("  ")).toEqual(commands.map((c) => c.label));
  });

  it("finds a command by the start of its label", () => {
    expect(labels("cal")[0]).toBe("Calendar");
  });

  // "set" starts Trip settings' second word; its letters are only scattered
  // through "Ask the assistant", which comes after.
  it("finds one by the start of a later word", () => {
    expect(labels("set")).toEqual(["Trip settings", "Ask the assistant"]);
  });

  it("finds one by a word it answers to", () => {
    expect(labels("ai")[0]).toBe("Ask the assistant");
    expect(labels("add")[0]).toBe("New stop");
  });

  // Only letters in order: New stop, Trip settings ("settiNgS"), Kyoto iN Spring.
  // Equally loose, so they keep the list's order.
  it("finds one by its letters in order, keeping the list's order among equals", () => {
    expect(labels("ns")).toEqual(["New stop", "Trip settings", "Kyoto in spring"]);
  });

  it("ranks a label's start above the same letters inside another", () => {
    // "pla" starts Plan, and is inside no other label.
    expect(labels("pla")).toEqual(["Plan"]);
    // "cal" starts Calendar and is only scattered through nothing else.
    expect(labels("dar")).toEqual(["Calendar"]);
    // "kyo" starts a trip's name, ahead of nothing: the list holds trips too.
    expect(labels("kyo")).toEqual(["Kyoto in spring"]);
  });

  // Listed after, ranked before: a word that starts with what was typed beats
  // a word that only contains it.
  it("ranks a later word's start above the same letters inside a word", () => {
    const places = [{ label: "Destination" }, { label: "Old tin mine" }];
    expect(rankCommands(places, "tin").map((c) => c.label)).toEqual(["Old tin mine", "Destination"]);
  });

  it("matches nothing when the letters are not there", () => {
    expect(labels("zzz")).toEqual([]);
  });
});
