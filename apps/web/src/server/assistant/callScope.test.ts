// The ledger's `reachedProposal` rests on the proposal buffer knowing which
// tool call collected each intent. The SDK runs a step's tool calls
// concurrently, so the claim worth testing is that two calls interleaving
// across an await still tag their own intents — the case a before/after count
// of the buffer would get wrong.
import { describe, expect, it } from "vitest";
import { currentCallId, runInCall } from "./callScope";
import { newProposalBuffer } from "./deps";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("call scope", () => {
  it("is null outside any call", () => {
    expect(currentCallId()).toBeNull();
  });

  it("tags what each of two interleaved calls collects with that call's id", async () => {
    const buffer = newProposalBuffer();
    const collect = (title: string) => buffer.collect({ type: "AddActivity", args: { title } });

    await Promise.all([
      runInCall("a", async () => {
        collect("a1");
        await tick();
        collect("a2");
      }),
      runInCall("b", async () => {
        collect("b1");
        await tick();
        collect("b2");
      }),
    ]);

    const byTitle = buffer
      .collected()
      .map((intent, index) => [String(intent.args.title), buffer.collectedBy()[index]] as const);
    expect(Object.fromEntries(byTitle)).toEqual({ a1: "a", a2: "a", b1: "b", b2: "b" });
    // The interleaving actually happened, or the test proves nothing.
    expect(byTitle.map(([title]) => title)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("tags nothing when there is no call", () => {
    const buffer = newProposalBuffer();
    buffer.collect({ type: "AddActivity", args: { title: "x" } });
    expect(buffer.collectedBy()).toEqual([null]);
  });
});
