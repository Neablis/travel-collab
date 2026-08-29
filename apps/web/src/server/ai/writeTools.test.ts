import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { BatchableCommand, type TripDetail } from "@tc/contracts";
import { costedTripDetailFixture } from "@tc/factories";
import { witness } from "@/test-support/witness";
import {
  buildProposal,
  buildWriteTools,
  commitProposal,
  describeProposedChange,
  parseApprovedCommands,
  WRITE_TOOL_NAMES,
  type RawToolIntent,
} from "./writeTools";

// `commitProposal` submits through `flushPlanningBatch`, which reaches
// Postgres. Its behaviour against a real database is the apply route's
// integration suite; what is unit-testable here is the ORDER of the two steps
// it owns — enrichment before the batch — and that is what these mocks pin.
vi.mock("./planningTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planningTools")>();
  return { ...actual, flushPlanningBatch: vi.fn() };
});
const { flushPlanningBatch } = await import("./planningTools");

const DAY_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const COLOSSEUM_ID = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";

const detail: TripDetail = costedTripDetailFixture();
const TRIP_ID = detail.tripId;
const ACTOR = "writer";

/** Deterministic mint, so a proposal's commands are assertable byte for byte. */
function mints(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function propose(intents: RawToolIntent[]) {
  return buildProposal(intents, detail, { tripId: TRIP_ID, actorId: ACTOR, mintId: mints(), proposalId: "p1" });
}

describe("WRITE_TOOL_NAMES", () => {
  // The point of measuring rather than listing: a thirteenth BatchableCommand
  // becomes a thirteenth write tool AND flips `minimumRoleFor` to editor for
  // free. A hand-written array would silently offer it to a viewer.
  it("is exactly the derived planning tool set", () => {
    expect([...WRITE_TOOL_NAMES].sort()).toEqual(Object.keys(buildWriteTools().tools).sort());
    expect([...WRITE_TOOL_NAMES].sort()).toEqual(
      BatchableCommand.options.map((o) => o.shape.type.value as string).sort(),
    );
  });

  it("declares no tripId on any write tool, exactly as the read tools do not", () => {
    // ADR-022 §3 / plan Constraint 3, asserted structurally so a new command
    // whose schema carries an id-shaped key cannot slip past.
    const { tools } = buildWriteTools();
    for (const [name, tool] of Object.entries(tools)) {
      const schema = tool.inputSchema as unknown as { shape?: Record<string, unknown> };
      const keys = Object.keys(schema.shape ?? {});
      expect(keys, `${name} must not take a tripId`).not.toContain("tripId");
      expect(keys.filter((k) => /^(tripId|dayId|activityId|conflictId)$/.test(k))).toEqual([]);
    }
  });
});

describe("the write tools collect and commit nothing", () => {
  it("returns a queued receipt and records the intent, without touching the batch", async () => {
    const { tools, getCollected } = buildWriteTools();
    const addActivity = tools.AddActivity!;
    const output = await (
      addActivity.execute as (input: unknown, options: unknown) => Promise<unknown>
    )({ title: "Coffee", dayRef: "day 1" }, {});
    expect(output).toEqual({ queued: true, type: "AddActivity" });
    expect(getCollected()).toEqual([{ type: "AddActivity", args: { title: "Coffee", dayRef: "day 1" } }]);
    expect(flushPlanningBatch).not.toHaveBeenCalled();
  });

  it("gives each turn its own collection — one turn cannot inherit another's intents", () => {
    const first = buildWriteTools();
    const second = buildWriteTools();
    void (first.tools.AddDay!.execute as (i: unknown, o: unknown) => unknown)({}, {});
    expect(second.getCollected()).toEqual([]);
  });
});

describe("buildProposal", () => {
  it("resolves human refs into commands and describes each one", () => {
    const proposal = propose([
      { type: "AddActivity", args: { title: "Gelato", dayRef: "day 1" } },
      { type: "MoveActivity", args: { activityRef: "Colosseum tour", dayRef: null, position: 0 } },
    ]);
    expect(proposal).not.toBeNull();
    expect(proposal!.changes).toEqual([
      { type: "AddActivity", text: "Add “Gelato” to day 1" },
      { type: "MoveActivity", text: "Move “Colosseum tour” to the backlog" },
    ]);
    expect(proposal!.commands).toEqual([
      {
        type: "AddActivity",
        tripId: TRIP_ID,
        activityId: "00000000-0000-4000-8000-000000000001",
        dayId: DAY_ID,
        title: "Gelato",
      },
      { type: "MoveActivity", tripId: TRIP_ID, activityId: COLOSSEUM_ID, toDayId: null, position: 0 },
    ]);
    expect(proposal!.skipped).toEqual([]);
  });

  it("is null when the turn asked for nothing", () => {
    expect(buildProposal([], detail, { tripId: TRIP_ID, actorId: ACTOR })).toBeNull();
  });

  it("is null when nothing the turn asked for could be matched to this trip", () => {
    const proposal = propose([{ type: "RemoveActivity", args: { activityRef: "A stop that isn't here" } }]);
    // No card, so the answer's prose stands alone — rendering an empty
    // "Proposed change" box with an Approve button that would commit nothing
    // is the worse failure.
    expect(proposal).toBeNull();
  });

  it("reports drops beside the changes that survived", () => {
    const proposal = propose([
      { type: "AddActivity", args: { title: "Gelato", dayRef: "day 1" } },
      { type: "RemoveActivity", args: { activityRef: "Nope" } },
    ]);
    expect(proposal!.changes).toHaveLength(1);
    expect(proposal!.skipped).toHaveLength(1);
    expect(proposal!.skipped[0]).toContain("No activity named");
  });

  // The 2026-08-02 dogfood run wrote `amountMinor: 0` on all nine activities it
  // planned. The board renders 0 as FREE; the truth was "nobody knows yet".
  it("carries NO cost for a stop the model gave no price — never amountMinor: 0", () => {
    const proposal = propose([{ type: "AddActivity", args: { title: "Gelato", dayRef: "day 1" } }]);
    const command = proposal!.commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(command.cost).toBeUndefined();
    expect(JSON.stringify(command)).not.toContain("amountMinor");
  });

  it("keeps a cost the model DID supply — the rule is 'never invent', not 'never carry'", () => {
    const proposal = propose([
      { type: "AddActivity", args: { title: "Gelato", dayRef: "day 1", cost: { amountMinor: 450, currency: "EUR" } } },
    ]);
    const command = proposal!.commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(command.cost).toEqual({ amountMinor: 450, currency: "EUR" });
  });

  it("for ANY set of costless stops, no command in the proposal carries a cost", () => {
    const w = witness("proposal costs");
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 40 }).filter((t) => t.trim() !== ""), {
          minLength: 1,
          maxLength: 6,
        }),
        (titles) => {
          const proposal = propose(
            titles.map((title) => ({ type: "AddActivity" as const, args: { title, dayRef: "day 1" } })),
          );
          // Every AddActivity here names day 1, which exists, so resolution
          // never drops one — the property is about cost, not about matching.
          expect(proposal).not.toBeNull();
          for (const command of proposal!.commands) {
            expect("cost" in command && command.cost !== undefined).toBe(false);
            w.tick();
          }
        },
      ),
      { numRuns: 200 },
    );
    // Measured, not guessed: five consecutive local runs of this exact
    // property ticked 617, 645, 644, 653 and 676. Half the observed minimum
    // (617) is ~308, so 300 — well clear of fast-check's size variance, and
    // far above the ~0 a vacuous run would produce.
    w.atLeast(300);
  });
});

describe("describeProposedChange", () => {
  // Conditional mood, never past. `summarizeBatch`'s "Done — added a day" is
  // the receipt for a batch that HAS applied; shown above an Approve button it
  // claims the thing the button has not done.
  it.each([
    [{ type: "AddDay", tripId: TRIP_ID, dayId: "aaaaaaaa-1111-4222-8333-444455556666" }, "Add a day"],
    [{ type: "RemoveDay", tripId: TRIP_ID, dayId: DAY_ID }, "Remove day 1"],
    [{ type: "RemoveActivity", tripId: TRIP_ID, activityId: COLOSSEUM_ID }, "Remove “Colosseum tour”"],
    [{ type: "SetTripName", tripId: TRIP_ID, name: "Rome" }, "Rename the trip to “Rome”"],
    [{ type: "SetTripBudget", tripId: TRIP_ID, budget: null }, "Clear the budget"],
    [{ type: "SetTripCurrency", tripId: TRIP_ID, currency: "EUR" }, "Set the currency to EUR"],
  ] as [BatchableCommand, string][])("says %o as %s", (command, text) => {
    expect(describeProposedChange(command, detail).text).toBe(text);
    expect(describeProposedChange(command, detail).text).not.toContain("Done");
  });

  it("has a phrase for every BatchableCommand type", () => {
    // The switch is exhaustive at compile time; this pins that no branch
    // returns an empty string, which the compiler cannot see.
    for (const option of BatchableCommand.options) {
      const type = option.shape.type.value as BatchableCommand["type"];
      const command = { type, tripId: TRIP_ID } as unknown as BatchableCommand;
      expect(describeProposedChange(command, detail).text.length).toBeGreaterThan(0);
    }
  });
});

describe("parseApprovedCommands", () => {
  it("re-stamps the tripId from the path, so a body cannot target another trip", () => {
    const parsed = parseApprovedCommands(
      [{ type: "AddDay", tripId: "99999999-9999-4999-8999-999999999999", dayId: DAY_ID }],
      TRIP_ID,
    );
    expect(parsed).toEqual({ ok: true, commands: [{ type: "AddDay", tripId: TRIP_ID, dayId: DAY_ID }] });
  });

  it("refuses an empty approval", () => {
    expect(parseApprovedCommands([], TRIP_ID)).toEqual({
      ok: false,
      error: "an approval must carry at least one change",
    });
  });

  it("refuses anything that is not a BatchableCommand", () => {
    expect(parseApprovedCommands([{ type: "DropDatabase" }], TRIP_ID).ok).toBe(false);
    expect(parseApprovedCommands(["nope"], TRIP_ID).ok).toBe(false);
    expect(parseApprovedCommands("nope", TRIP_ID).ok).toBe(false);
  });

  it("refuses a CreateTrip, which is not batchable", () => {
    expect(parseApprovedCommands([{ type: "CreateTrip", name: "Sneaky" }], TRIP_ID).ok).toBe(false);
  });
});

describe("commitProposal", () => {
  const okBatch = { ok: true as const, tripId: TRIP_ID, detail, history: { tripId: TRIP_ID, entries: [], canUndo: false, canRedo: false } };

  it("geocodes before it commits, and commits ONE batch", async () => {
    vi.mocked(flushPlanningBatch).mockResolvedValue(okBatch);
    const order: string[] = [];
    const geocoder = {
      forward: vi.fn(async () => {
        order.push("geocode");
        return [{ name: "Trevi Fountain, Rome, Italy", lat: 41.9009, lng: 12.4833, city: "Rome", countryCode: "IT" }];
      }),
    };
    vi.mocked(flushPlanningBatch).mockImplementation(async () => {
      order.push("batch");
      return okBatch;
    });

    const commands: BatchableCommand[] = [
      {
        type: "AddActivity",
        tripId: TRIP_ID,
        activityId: "00000000-0000-4000-8000-000000000001",
        dayId: DAY_ID,
        title: "Coins",
        location: { name: "Trevi Fountain", city: "Rome", lat: 41.9, lng: 12.48, countryCode: "IT" },
      },
      { type: "AddDay", tripId: TRIP_ID, dayId: "aaaaaaaa-1111-4222-8333-444455556666" },
    ];
    const result = await commitProposal(TRIP_ID, commands, ACTOR, detail, geocoder as never);

    expect(result.ok).toBe(true);
    expect(geocoder.forward).toHaveBeenCalledTimes(1);
    // KI-15's protection is not a second door: approval runs the SAME
    // enrichment the command path runs, before the batch, and there is exactly
    // one batch for the whole proposal (ADR-013 — one history entry, one undo).
    expect(order).toEqual(["geocode", "batch"]);
    expect(vi.mocked(flushPlanningBatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flushPlanningBatch).mock.calls[0]![1]).toHaveLength(2);
  });

  it("never reaches a geocoder when no command carries a location", async () => {
    vi.mocked(flushPlanningBatch).mockResolvedValue(okBatch);
    const geocoder = { forward: vi.fn() };
    const result = await commitProposal(
      TRIP_ID,
      [{ type: "AddDay", tripId: TRIP_ID, dayId: "aaaaaaaa-1111-4222-8333-444455556666" }],
      ACTOR,
      detail,
      geocoder as never,
    );
    expect(result.ok).toBe(true);
    expect(geocoder.forward).not.toHaveBeenCalled();
  });

  it("answers with summarizeBatch's receipt — derived from the committed commands", async () => {
    vi.mocked(flushPlanningBatch).mockResolvedValue(okBatch);
    const result = await commitProposal(
      TRIP_ID,
      [{ type: "RemoveActivity", tripId: TRIP_ID, activityId: COLOSSEUM_ID }],
      ACTOR,
      detail,
    );
    expect(result.ok && result.value.message).toBe("Done — removed “Colosseum tour”.");
  });

  it("passes a refused batch straight through, with its domain code", async () => {
    vi.mocked(flushPlanningBatch).mockResolvedValue({
      ok: false,
      error: { code: "concurrency-conflict", message: "someone else changed this trip" },
    });
    const result = await commitProposal(
      TRIP_ID,
      [{ type: "AddDay", tripId: TRIP_ID, dayId: "aaaaaaaa-1111-4222-8333-444455556666" }],
      ACTOR,
      detail,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "concurrency-conflict", message: "someone else changed this trip" },
    });
  });
});
