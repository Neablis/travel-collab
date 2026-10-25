// The proposal buffer is a turn's record of what the model asked for, and the
// proposal the person approves is built from it. Nothing that reads it, and
// nothing that handed an intent to it, may rewrite that record afterwards
// (KI-2026-09-12-f): `RawToolIntent.args` is an open, mutable object, so a
// copy of the array alone still shares every record and everything in it.
import { describe, expect, it } from "vitest";
import type { RawToolIntent } from "./batchResolver";
import { newProposalBuffer } from "./deps";

const addLunch = (): RawToolIntent => ({ type: "AddActivity", args: { title: "Lunch", tags: ["food"] } });

describe("newProposalBuffer", () => {
  it("hands back records a reader cannot use to rewrite what the turn collected", () => {
    const buffer = newProposalBuffer();
    buffer.collect(addLunch());

    const read = buffer.collected();
    read[0]!.type = "RemoveActivity";
    read[0]!.args.title = "Dinner";
    (read[0]!.args.tags as string[]).push("evil");
    read.push(addLunch());

    expect(buffer.collected()).toEqual([addLunch()]);
  });

  it("keeps what was collected when the caller changes the intent it handed in", () => {
    const buffer = newProposalBuffer();
    const intent = addLunch();
    buffer.collect(intent);

    intent.args.title = "Dinner";

    expect(buffer.collected()).toEqual([addLunch()]);
  });

  it("hands back inserts a reader cannot use to rewrite what the turn collected", () => {
    const buffer = newProposalBuffer();
    buffer.addInsert({ savedDayId: "day-1", name: "Gion at dusk", stopCount: 3 });

    const read = buffer.inserts();
    read[0]!.name = "Somewhere else";
    read[0]!.stopCount = 99;

    expect(buffer.inserts()).toEqual([{ savedDayId: "day-1", name: "Gion at dusk", stopCount: 3 }]);
  });
});
