import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AskStreamMetadata, AssistantProposal, SIMULATED_HEADER } from "../src";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const DAY_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVITY_ID = "33333333-3333-4333-8333-333333333333";

const ADD_DAY = { type: "AddDay", tripId: TRIP_ID, dayId: DAY_ID } as const;
const ADD_ACTIVITY = {
  type: "AddActivity",
  tripId: TRIP_ID,
  activityId: ACTIVITY_ID,
  dayId: DAY_ID,
  title: "Coffee at Fuglen",
} as const;

const PROPOSAL = {
  proposalId: "p1",
  changes: [{ type: "AddActivity", text: "Add “Coffee at Fuglen” to day 1" }],
  commands: [ADD_ACTIVITY],
  inserts: [],
  skipped: [],
};

const PAGE_DOC = { v: 1, type: "doc", content: [{ type: "paragraph", content: [] }] };

describe("the /ask stream envelope — the four shapes the final chunk may take", () => {
  const ACCEPTED: [unknown, string][] = [
    [{ proposal: PROPOSAL }, "a proposal"],
    [{ pageInserts: { content: PAGE_DOC } }, "a page turn's inserts"],
    [{ composeError: 'Macro "cost.day" params failed validation.' }, "a compose refusal"],
    [{}, "a page turn that inserted nothing"],
  ];

  it.each(ACCEPTED)("accepts %j (%s)", (metadata) => {
    expect(AskStreamMetadata.safeParse(metadata).success).toBe(true);
  });

  // The trap a permissive empty branch sets. `z.object({})` matches ANY object,
  // so with a non-strict fourth branch every malformed payload below would
  // parse — as `{}`, silently, and the union would assert nothing at all.
  it("does not let a malformed payload fall through to the empty shape", () => {
    const parsed = AskStreamMetadata.safeParse({ proposal: { proposalId: "p1" } });
    expect(parsed.success).toBe(false);
  });

  // The other side of the same asymmetry. The stream is a superset the server
  // may grow, and a key added beside a valid payload by a newer deployment must
  // not cost an older client the proposal it came with.
  it("strips a key a newer server added beside a valid proposal", () => {
    const parsed = AskStreamMetadata.safeParse({ proposal: PROPOSAL, warning: "from the future" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ proposal: { ...PROPOSAL } });
  });

  it("rejects a chunk that carries only a key it does not know", () => {
    expect(AskStreamMetadata.safeParse({ warning: "from the future" }).success).toBe(false);
  });

  // A turn with no outcome sends no `messageMetadata` key at all, which is not
  // the same value as `{}` and must not be mistaken for one by a reader that
  // parses whatever it finds.
  it("rejects an absent envelope rather than reading it as the empty shape", () => {
    expect(AskStreamMetadata.safeParse(undefined).success).toBe(false);
  });

  // Silence and a refusal are different answers: a page turn that inserted
  // nothing is `{}`, a page turn whose nodes failed validation says why. An
  // empty reason is neither, so it is not a shape this may take.
  it("rejects a compose refusal with no reason in it", () => {
    expect(AskStreamMetadata.safeParse({ composeError: "" }).success).toBe(false);
  });
});

describe("a proposal on the wire", () => {
  it("defaults a missing `inserts` and `skipped` to empty, as a pre-ADR-042 proposal has", () => {
    const parsed = AssistantProposal.safeParse({
      proposalId: "p1",
      changes: [],
      commands: [ADD_DAY],
    });
    expect(parsed.success && parsed.data.inserts).toEqual([]);
    expect(parsed.success && parsed.data.skipped).toEqual([]);
  });

  // ADR-042 Decision 1: a turn whose one write call was `insert_playbook_day`
  // resolves to zero commands by construction, so "no commands" stopped being
  // the same question as "nothing to review".
  it("accepts a proposal that carries only an insert", () => {
    expect(
      AssistantProposal.safeParse({
        proposalId: "p2",
        changes: [{ type: "AddDay", text: "Add “A day in Kyoto” from the library" }],
        commands: [],
        inserts: [{ savedDayId: DAY_ID, name: "A day in Kyoto" }],
        skipped: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a proposal with neither a command nor an insert", () => {
    const parsed = AssistantProposal.safeParse({
      proposalId: "p3",
      changes: [],
      commands: [],
      inserts: [],
      skipped: [],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.message).toBe(
      "a proposal carries at least one command or one insert",
    );
  });

  // `describeProposedChange` returns `BatchableCommand["type"]` and always has.
  // The client used to type the same field `string`, which is how a fixture
  // asserting `type: "activity.move"` — a name no command has ever had — sat in
  // the suite unnoticed until this enum was derived from the union itself.
  it("rejects a change typed with something that is not a command", () => {
    expect(
      AssistantProposal.safeParse({ ...PROPOSAL, changes: [{ type: "activity.move", text: "Move it" }] }).success,
    ).toBe(false);
  });
});

// **The claim: a malformed entry ANYWHERE makes the whole proposal fail to
// parse.** It is a for-all over field positions, so it is a property rather
// than six examples — and it is the behaviour P6 changed, not merely typed.
// Before the envelope was a schema, `changes` and `skipped` were read with a
// `flatMap`/`filter` that dropped bad entries and kept the rest, so a card
// could describe fewer changes than Approve would commit.
const CORRUPTIONS = [
  "change-without-text",
  "change-typed-as-non-command",
  "insert-without-savedDayId",
  "insert-as-a-bare-string",
  "skipped-entry-that-is-not-a-string",
  "blank-proposalId",
] as const;
type Corruption = (typeof CORRUPTIONS)[number];

type RawProposal = {
  proposalId: string;
  changes: { type: string; text: string }[];
  commands: unknown[];
  inserts: { savedDayId: string; name: string }[];
  skipped: unknown[];
};

function corrupt(proposal: RawProposal, how: Corruption): RawProposal {
  const [first, ...rest] = proposal.changes;
  switch (how) {
    case "change-without-text":
      return { ...proposal, changes: [{ type: first!.type } as { type: string; text: string }, ...rest] };
    case "change-typed-as-non-command":
      return { ...proposal, changes: [{ ...first!, type: "activity.move" }, ...rest] };
    case "insert-without-savedDayId":
      return {
        ...proposal,
        inserts: [{ name: proposal.inserts[0]!.name } as { savedDayId: string; name: string }, ...proposal.inserts.slice(1)],
      };
    case "insert-as-a-bare-string":
      return {
        ...proposal,
        inserts: [DAY_ID as unknown as { savedDayId: string; name: string }, ...proposal.inserts.slice(1)],
      };
    case "skipped-entry-that-is-not-a-string":
      return { ...proposal, skipped: [7, ...proposal.skipped.slice(1)] };
    case "blank-proposalId":
      return { ...proposal, proposalId: "" };
  }
}

// Every array is `minLength: 1`, so `corrupt` has something to corrupt in every
// position and the property body carries no guard clause — which is what lets
// the witness floor be `numRuns` exactly rather than a measured fraction of it
// (`packages/domain/test/support/witness.ts`). The empty-array cases are
// covered by the examples above, where they belong.
const rawProposalArb: fc.Arbitrary<RawProposal> = fc.record({
  proposalId: fc.string({ minLength: 1 }),
  changes: fc
    .array(
      fc.record({
        type: fc.constantFrom("AddDay", "AddActivity", "RemoveActivity", "SetTripName"),
        text: fc.string({ minLength: 1 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  commands: fc.subarray([ADD_DAY, ADD_ACTIVITY] as unknown[], { minLength: 1 }),
  inserts: fc.array(fc.record({ savedDayId: fc.constant(DAY_ID), name: fc.string() }), {
    minLength: 1,
    maxLength: 3,
  }),
  skipped: fc.array(fc.string() as fc.Arbitrary<unknown>, { minLength: 1, maxLength: 3 }),
});

const NUM_RUNS = 300;

describe("a malformed entry anywhere makes the whole proposal fail to parse", () => {
  it("holds for every field position", () => {
    let asserted = 0;
    const seen = new Map<Corruption, number>();
    fc.assert(
      fc.property(rawProposalArb, fc.constantFrom(...CORRUPTIONS), (proposal, how) => {
        // Asserted, not skipped. A generator that drifted into producing
        // proposals the schema already rejects would make the corruption
        // assertion below pass for the wrong reason — P4's vacuous property in
        // one line — so the base case is checked rather than filtered.
        expect(AskStreamMetadata.safeParse({ proposal }).success).toBe(true);
        expect(AskStreamMetadata.safeParse({ proposal: corrupt(proposal, how) }).success).toBe(false);
        seen.set(how, (seen.get(how) ?? 0) + 1);
        asserted += 1;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(asserted).toBe(NUM_RUNS);
    // The second vacuity mode the witness helper names: the input space
    // shrinking. An assertion count cannot see a `corrupt` arm that stopped
    // being reached — `CORRUPTIONS` is drawn from, not iterated — so every arm
    // is counted by name. **Measured, not guessed** (2026-09-11, six runs of
    // 300): the least-drawn arm of each run landed at 34, 39, 40, 42, 42 and
    // 45. 17 is half the observed minimum, which is the rule the witness helper
    // states — far enough below not to flap, far enough above zero to catch an
    // arm that stopped being generated.
    expect([...seen.keys()].sort()).toEqual([...CORRUPTIONS].sort());
    for (const how of CORRUPTIONS) expect(seen.get(how)!).toBeGreaterThanOrEqual(17);
  });
});

describe("the simulated verdict's name", () => {
  // Not a member of the envelope above, and deliberately: it is a response
  // HEADER, set before a byte of the stream so a turn that fails mid-answer is
  // still badged, where stream metadata rides the final chunk that failure path
  // never sends. What it needed from P6 was one owner, not a schema — it had
  // two, `handleAskRequest.ts` and `apiClient.ts`, each spelling the literal.
  it("is the name both ends already send and read", () => {
    expect(SIMULATED_HEADER).toBe("x-tc-ai-simulated");
  });
});
