import { describe, expect, it } from "vitest";
import { paletteLevel, pathText } from "./grammar";
import type { PaletteCommand } from "./paletteRegistry";

const run = () => {};
const go = (target: string, more: Partial<PaletteCommand> = {}): PaletteCommand => ({ id: `go:${target}`, action: "Go to", type: "Trip", target: { label: target }, run, ...more }) as PaletteCommand;
const labels = (commands: readonly PaletteCommand[], at: readonly string[] = []) => paletteLevel(commands, at)?.map((node) => `${node.label}${node.kind === "branch" ? " ›" : ""}`);

// ADR-069 §2: the tree is derived from the leaves, never registered.
describe("paletteLevel", () => {
  it("lists only the actions at the top, in the vocabulary's order, each only if something is under it, then the singletons", () => {
    const commands: PaletteCommand[] = [
      { id: "ask", action: "Ask the assistant", run },
      { id: "rm", action: "Remove", type: "Stop", target: { label: "Ramen" }, run },
      { id: "undo", action: "Undo", run },
      go("Tokyo"),
      { id: "add", action: "Add", type: "Stop", run },
    ];
    expect(labels(commands)).toEqual(["Go to ›", "Add ›", "Remove ›", "Undo", "Ask the assistant"]);
  });

  it("opens a branch onto the next segment its leaves share, and leads nowhere once they are gone", () => {
    const commands: PaletteCommand[] = [
      go("Tokyo"),
      { id: "view", action: "Go to", type: "View", target: { label: "Calendar" }, run },
      go("Lisbon"),
      { id: "add", action: "Add", type: "Trip", run },
    ];
    expect(labels(commands, ["Go to"])).toEqual(["Trip ›", "View ›"]);
    expect(labels(commands, ["Go to", "Trip"])).toEqual(["Tokyo", "Lisbon"]);
    expect(labels(commands, ["Add"])).toEqual(["Trip"]);
    expect(paletteLevel(commands, ["Move"])).toBeNull();
  });

  // Two stops called Ramen, each with its own days to move to.
  it("keeps two segments with one label apart by their keys", () => {
    const move = (stop: string, day: string): PaletteCommand => ({
      id: `${stop}:${day}`,
      action: "Move",
      type: "Stop",
      target: { key: stop, label: "Ramen" },
      destination: { label: day },
      run,
    });
    const commands = [move("a", "Day 2"), move("b", "Day 1"), move("a", "Day 3")];
    expect(labels(commands, ["Move", "Stop"])).toEqual(["Ramen ›", "Ramen ›"]);
    expect(labels(commands, ["Move", "Stop", "a"])).toEqual(["Day 2", "Day 3"]);
  });

  // ADR-069 §5's natural order: days in day order whatever order they were registered in.
  it("lists targets in their natural order, then as registered", () => {
    const commands = [go("Day 3", { order: 2 }), go("Day 1", { order: 0 }), go("Day 2", { order: 1 }), go("Day 2b", { order: 1 })];
    expect(labels(commands, ["Go to", "Trip"])).toEqual(["Day 1", "Day 2", "Day 2b", "Day 3"]);
  });

  it("makes a leaf that is also a prefix of another path a branch", () => {
    const commands: PaletteCommand[] = [
      { id: "short", action: "Add", type: "Stop", run },
      { id: "long", action: "Add", type: "Stop", target: { label: "Ramen" }, run },
    ];
    expect(labels(commands, ["Add"])).toEqual(["Stop ›"]);
    expect(labels(commands, ["Add", "Stop"])).toEqual(["Ramen"]);
  });

  it("writes a path with its separators, from where it is asked", () => {
    const command: PaletteCommand = { id: "m", action: "Move", type: "Stop", target: { label: "Ramen" }, destination: { label: "Day 3" }, run };
    expect(pathText(command)).toBe("Move › Stop › Ramen › Day 3");
    expect(pathText(command, 2)).toBe("Ramen › Day 3");
  });
});
