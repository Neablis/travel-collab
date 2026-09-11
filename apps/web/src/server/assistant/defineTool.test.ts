// The two guarantees `defineTool` exists to make, one runtime and one
// compile-time, plus the collector they made a dependency.
//
// Both are the kind that a refactor can delete without a single test going red,
// which is why they are pinned here rather than left to the tools that use
// them: an `output` schema nothing parses through is decoration, and a
// `needs` tuple nothing narrows is a comment.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { witness } from "@/test-support/witness";
import { defineTool } from "./defineTool";
import { newPageBuffer, newProposalBuffer } from "./deps";
import type { RawToolIntent } from "@/server/ai/batchResolver";

const NOTHING = [] as const;

describe("output is required, and enforced", () => {
  // KI-9 at the tool boundary: a tool cannot return a shape nothing parsed.
  // The failure this closes is a `run` that drifts from its declared readout —
  // today that reaches the model as a confidently-shaped wrong answer and is
  // noticed, if at all, in production.
  it("refuses a result its own output schema rejects", async () => {
    const drifted = defineTool({
      name: "drifted",
      description: "Returns something other than what it declared.",
      domain: "system",
      effect: "read",
      spend: "none",
      input: z.object({}),
      output: z.object({ stops: z.number() }),
      needs: NOTHING,
      minimumRole: "viewer",
      run: () => ({ stops: "seven" }) as unknown as { stops: number },
    });

    await expect(drifted.invoke({}, {})).rejects.toThrow(/expected number/i);
  });

  // The other half of the same guarantee, and the reason it is a PARSE rather
  // than a check: a field a tool never declared cannot reach the model, so the
  // readout in the definition is the whole of what a turn can see.
  it("hands on only what the output schema declared", async () => {
    const chatty = defineTool({
      name: "chatty",
      description: "Returns more than it declared.",
      domain: "system",
      effect: "read",
      spend: "none",
      input: z.object({}),
      output: z.object({ stops: z.number() }),
      needs: NOTHING,
      minimumRole: "viewer",
      run: () => ({ stops: 7, internalId: "secret" }) as { stops: number },
    });

    expect(await chatty.invoke({}, {})).toEqual({ stops: 7 });
  });
});

describe("needs is what run may reach", () => {
  it("hands run exactly the declared slice of AssistantDeps", async () => {
    const buffer = newProposalBuffer();
    const collector = defineTool({
      name: "collector",
      description: "Collects.",
      domain: "itinerary",
      effect: "propose",
      spend: "none",
      input: z.object({ title: z.string() }),
      output: z.object({ queued: z.literal(true) }),
      needs: ["proposalBuffer"] as const,
      minimumRole: "editor",
      run: ({ title }, deps) => {
        deps.proposalBuffer.collect({ type: "AddActivity", args: { title } });
        return { queued: true as const };
      },
    });

    await collector.invoke({ title: "Coffee" }, { proposalBuffer: buffer });
    expect(buffer.collected()).toEqual([{ type: "AddActivity", args: { title: "Coffee" } }]);
  });

  // **The compile-time half, asserted at compile time.** `run`'s second
  // parameter is `Pick<AssistantDeps, Needs[number]>`, so a tool that did not
  // declare a dep cannot reach it — and the only way to hold that guarantee
  // honest is a case that must FAIL to compile. Delete the `as const`, widen
  // the `Pick`, or drop the second type parameter and this file stops
  // compiling with "Unused '@ts-expect-error' directive", which is a typecheck
  // failure and not a silent pass.
  it("makes an undeclared dep a type error, not a convention", () => {
    const overreaching = defineTool({
      name: "overreaching",
      description: "Declares the trip and reaches for the scope.",
      domain: "itinerary",
      effect: "read",
      spend: "none",
      input: z.object({}),
      output: z.object({ days: z.number() }),
      needs: ["trip"] as const,
      minimumRole: "viewer",
      run: (_input, deps) =>
        // @ts-expect-error `scope` was not declared in `needs`, so this tool cannot see it.
        ({ days: deps.scope.kind === "day" ? 1 : deps.trip.days.length }),
    });

    // The assertion above is the compiler's. This one keeps the case from
    // rotting into a definition nothing ever builds.
    expect(overreaching.needs).toEqual(["trip"]);
  });
});

describe("a collector is a dependency, not a closure", () => {
  it("gives each turn its own buffers", () => {
    const first = newProposalBuffer();
    const second = newProposalBuffer();
    first.collect({ type: "AddDay", args: {} });
    first.addInsert({ savedDayId: "a", name: "A day", stopCount: 2 });
    expect(second.collected()).toEqual([]);
    expect(second.inserts()).toEqual([]);

    const firstPage = newPageBuffer();
    firstPage.insert([{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }]);
    expect(newPageBuffer().inserted().nodes).toEqual([]);
  });

  // `resolveBatch` resolves intents IN EMISSION ORDER — an `AddDay` before the
  // `AddActivity` that names it is the whole reason it is batch-aware — so
  // order is the buffer's one load-bearing property, and the reader must not be
  // able to disturb it. Both halves were free while this was a closure the
  // builder owned; neither is free now that it is a value handed around, so
  // they are generated rather than sampled.
  it("preserves emission order and hands back a copy, for any sequence", () => {
    const w = witness("proposal buffer order");
    const intent: fc.Arbitrary<RawToolIntent> = fc.record({
      type: fc.constantFrom("AddDay", "AddActivity", "RemoveActivity", "MoveActivity"),
      args: fc.dictionary(fc.string({ minLength: 1 }), fc.oneof(fc.string(), fc.integer())),
    }) as fc.Arbitrary<RawToolIntent>;

    fc.assert(
      fc.property(fc.array(intent, { maxLength: 12 }), (intents) => {
        const buffer = newProposalBuffer();
        for (const one of intents) buffer.collect(one);
        expect(buffer.collected()).toEqual(intents);
        // Mutating what a reader was handed must not reach the turn's record of
        // what the model asked for.
        buffer.collected().push({ type: "RemoveDay", args: {} });
        expect(buffer.collected()).toEqual(intents);
        w.tick();
      }),
      { numRuns: 200 },
    );
    // No guard clause in the property, so it ticks exactly `numRuns` times.
    w.atLeast(200);
  });
});
