// The two properties `TurnLedger` exists to hold, and neither is assertable by
// reading the type once and trusting it:
//
//   1. **there is no currency anywhere in it** — the KI-1 / KI-14 /
//      `budgetPerPerson` defect class on its third recorded recurrence, where a
//      $0.0011 request stored as `Money` rounds to zero and every request reads
//      as free;
//   2. **cost and capacity cannot be summed** — model tokens are a marginal
//      charge, a LocationIQ lookup is a daily-capped allowance, and the number
//      that adds them is meaningless.
//
// Both are pinned three ways on purpose: a compile-time key set (adding a field
// is a typecheck failure), a source check (a currency type cannot be imported
// into the module), and a property over generated ledgers (the one arithmetic
// there is cannot see `capacity`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "@/test-support/witness";
import {
  billableRoundTrips,
  newTurnMeter,
  NO_METER,
  type CapacityLine,
  type LedgerToolCall,
  type ModelSpend,
  type TurnCost,
  type TurnLedger,
} from "./ledger";

// ---------------------------------------------------------------------------
// 1. No currency, anywhere
// ---------------------------------------------------------------------------

/**
 * Exact key sets, checked by `tsc` rather than at runtime.
 *
 * A runtime assertion over a constructed value cannot see a field nobody
 * populated, which is exactly the shape a `costUsd?: Money` would arrive in.
 * This goes red in `pnpm --filter web typecheck` the moment a field is added or
 * removed, and the diff of whoever adds it is where that belongs.
 *
 * `export`ed only because a type alias nothing references is an unused-variable
 * warning, and a warning nobody can silence is a warning everybody learns to
 * ignore. Nothing imports them.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type _LedgerKeys = Assert<Exact<keyof TurnLedger, "cost" | "capacity" | "toolCalls">>;
export type _CostKeys = Assert<
  Exact<
    keyof TurnCost,
    "userId" | "endpoint" | "outcome" | "taskClass" | "turn" | "classifier" | "steps" | "planVersionRef"
  >
>;
export type _SpendKeys = Assert<Exact<keyof ModelSpend, "model" | "tokensIn" | "tokensOut">>;
export type _CapacityKeys = Assert<Exact<keyof CapacityLine, "vendor" | "calls">>;
export type _ToolCallKeys = Assert<Exact<keyof LedgerToolCall, "name" | "ms" | "ok">>;

const LEDGER_SOURCE = readFileSync(fileURLToPath(new URL("./ledger.ts", import.meta.url)), "utf8");

/** The module's code, with every comment removed — this file's prose says "cost". */
const LEDGER_CODE = LEDGER_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the ledger carries no currency", () => {
  // The failure this rules out is not a type error anyone would notice. ADR-008
  // defines `Money` in integer MINOR units, a live request costs $0.0011, and
  // the rounding is silent — every row stores zero and the series looks free.
  it("names no currency type and no money-shaped field", () => {
    expect(LEDGER_CODE).not.toMatch(/\b(Money|amountMinor|currency|cents|usd|dollars?|price)\b/i);
  });

  // **The kernel never multiplies tokens by a price** (spec §5b). Pricing is a
  // join performed downstream against a dated, append-only rate record, so a
  // rate change publishes a new entry and never rewrites history. There is
  // therefore no rate constant here to multiply by — and no multiplication at
  // all, which is the cheapest possible way to keep that true.
  it("performs no multiplication at all", () => {
    expect(LEDGER_CODE).not.toContain("*");
  });
});

// ---------------------------------------------------------------------------
// 2. Cost and capacity are never summed
// ---------------------------------------------------------------------------

const arbSpend: fc.Arbitrary<ModelSpend> = fc.record({
  model: fc.constantFrom("deepseek/deepseek-v4-flash-0731", "zai/glm-4.7-flash", "simulated/no-op"),
  tokensIn: fc.option(fc.integer({ min: 0, max: 40_000 }), { nil: null }),
  tokensOut: fc.option(fc.integer({ min: 0, max: 4_000 }), { nil: null }),
});

const arbCost: fc.Arbitrary<TurnCost> = fc.record({
  userId: fc.constantFrom("alice", "bob"),
  endpoint: fc.constantFrom("ask" as const, "ask.apply" as const),
  outcome: fc.constantFrom("completed" as const, "error" as const, "abort" as const),
  taskClass: fc.constantFrom("question" as const, "edit" as const, "plan" as const, "compose" as const),
  turn: arbSpend,
  classifier: fc.option(arbSpend, { nil: null }),
  steps: fc.integer({ min: 0, max: 32 }),
  planVersionRef: fc.option(fc.constantFrom("plus@v1", "premium@v3"), { nil: null }),
});

// Deliberately reaches non-empty, multi-call capacity: a generator that only
// ever produced `[]` would make the property below true for the wrong reason,
// and every run would report green having tested nothing. The witness counts
// the cases that actually differ.
const arbCapacity: fc.Arbitrary<CapacityLine[]> = fc.array(
  fc.record({ vendor: fc.constant("locationiq" as const), calls: fc.integer({ min: 1, max: 5_000 }) }),
  { maxLength: 3 },
);

const arbToolCalls: fc.Arbitrary<LedgerToolCall[]> = fc.array(
  fc.record({
    name: fc.constantFrom("read_trip", "read_day", "search_playbooks"),
    ms: fc.integer({ min: 0, max: 10_000 }),
    ok: fc.boolean(),
  }),
  { maxLength: 4 },
);

function totalCalls(capacity: readonly CapacityLine[]): number {
  return capacity.reduce((sum, line) => sum + line.calls, 0);
}

describe("cost and capacity are two ledgers, not two fields of one", () => {
  // M20's third decision, as a property: *"attribute marginal cost only"*. Model
  // tokens are the per-account marginal cost; the geocoder is a daily-capped
  // free tier, so a lookup consumes an allowance rather than incurring a
  // charge. The one arithmetic in the module is `billableRoundTrips`, and this
  // says it is a function of `cost` ALONE — two ledgers with identical costs and
  // wildly different capacity settle identically, however many lookups happened.
  it("settles the same round-trips for any capacity at all", () => {
    const w = witness("billable independence");
    // The guard that could go vacuous: if the generator stopped producing
    // DIFFERING capacities, the property would be comparing a ledger with
    // itself and would pass having asserted nothing.
    const differed = witness("capacity actually differed");
    const classified = witness("classifier round-trip present");

    fc.assert(
      fc.property(arbCost, arbCapacity, arbCapacity, arbToolCalls, arbToolCalls, (cost, capA, capB, toolsA, toolsB) => {
        const a: TurnLedger = { cost, capacity: capA, toolCalls: toolsA };
        const b: TurnLedger = { cost, capacity: capB, toolCalls: toolsB };

        expect(billableRoundTrips(a)).toBe(billableRoundTrips(b));
        // And what it IS: the agent's steps plus the classifier's one round-trip
        // when one was made. No vendor term is reachable from here.
        expect(billableRoundTrips(a)).toBe(cost.steps + (cost.classifier === null ? 0 : 1));
        w.tick();

        if (totalCalls(capA) !== totalCalls(capB)) differed.tick();
        if (cost.classifier !== null) classified.tick();
      }),
      { numRuns: 300 },
    );

    // Floors measured over three runs rather than guessed: independence ticks
    // exactly `numRuns` because it has no guard, so it can use that number
    // exactly; differing capacity observed 275-283 and a present classifier
    // 248-256, so both sit at ~half their observed minimum.
    w.atLeast(300);
    differed.atLeast(135);
    classified.atLeast(120);
  });

  // A classification that made no round-trip has no line, which is what makes
  // the settlement structural instead of a `+ 1` somebody has to remember. The
  // affirmation rule and a page turn are both this case.
  it("bills nothing for a classification that never called a model", () => {
    const cost: TurnCost = {
      userId: "alice",
      endpoint: "ask",
      outcome: "completed",
      taskClass: "plan",
      turn: { model: "m", tokensIn: 10, tokensOut: 2 },
      classifier: null,
      steps: 3,
      planVersionRef: null,
    };
    expect(billableRoundTrips({ cost, capacity: [], toolCalls: [] })).toBe(3);
    expect(
      billableRoundTrips({
        cost: { ...cost, classifier: { model: "c", tokensIn: 150, tokensOut: 10 } },
        capacity: [],
        toolCalls: [],
      }),
    ).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The meter
// ---------------------------------------------------------------------------

describe("the turn meter", () => {
  it("records each tool call once, in order, with its outcome", () => {
    const meter = newTurnMeter();
    meter.toolCall("read_trip", 12, true);
    meter.toolCall("read_day", 40, false);
    expect(meter.toolCalls()).toEqual([
      { name: "read_trip", ms: 12, ok: true },
      { name: "read_day", ms: 40, ok: false },
    ]);
  });

  // Collapsed per vendor, so a reader of `capacity` never has to group before
  // settling it against `geocodeQuota()` — which is the one thing KI-93 will
  // ask this field for.
  it("collapses vendor lookups to one line per vendor", () => {
    const meter = newTurnMeter();
    meter.vendorCall("locationiq");
    meter.vendorCall("locationiq", 4);
    expect(meter.capacity()).toEqual([{ vendor: "locationiq", calls: 5 }]);
  });

  it("measures nothing, and refuses nothing, when no meter was minted", () => {
    NO_METER.toolCall("read_trip", 12, true);
    NO_METER.vendorCall("locationiq", 3);
    expect(NO_METER.toolCalls()).toEqual([]);
    expect(NO_METER.capacity()).toEqual([]);
  });

  // KI-2026-09-11-d: toolCalls() used to hand back the live array, where its
  // sibling ProposalBuffer.collected() (deps.ts) copies and documents copying
  // as the guarantee it preserves — a caller that mutates what it reads must
  // not be able to rewrite what the turn collected.
  it("hands back a copy, so a caller mutating what it reads cannot rewrite what the turn collected", () => {
    const meter = newTurnMeter();
    meter.toolCall("read_trip", 12, true);

    const snapshot = meter.toolCalls() as LedgerToolCall[];
    snapshot.push({ name: "evil", ms: 0, ok: true });

    expect(meter.toolCalls()).toEqual([{ name: "read_trip", ms: 12, ok: true }]);
  });

  // CodeRabbit on PR #165: the first version of the fix above copied the array
  // and not its elements, so `[...tools]` still handed out the live records.
  // `LedgerToolCall` is a plain mutable interface, so flipping `ok` on a read
  // record rewrote what the turn had collected — and the test above could not
  // see it, because appending to a copied array proves nothing about its
  // elements. This is the assertion that does.
  it("hands back copies of the records too, not just of the array holding them", () => {
    const meter = newTurnMeter();
    meter.toolCall("read_trip", 12, true);

    const record = meter.toolCalls()[0] as LedgerToolCall;
    record.ok = false;
    record.name = "rewritten";
    record.ms = 9999;

    expect(meter.toolCalls()).toEqual([{ name: "read_trip", ms: 12, ok: true }]);
  });
});
