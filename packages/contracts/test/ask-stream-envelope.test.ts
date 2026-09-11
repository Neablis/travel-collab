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

  // **One outcome per chunk.** A union returns the FIRST branch that matches and
  // a permissive `z.object` strips what it does not name, so two recognised
  // keys in one chunk is not a harmless oddity: the earlier branch wins and the
  // later key vanishes. `{ proposal, composeError }` would render a card while
  // discarding the server's refusal, and `{ proposal: <invalid>, composeError }`
  // would fall through to the refusal — a valid sibling key hiding a broken one.
  // Unreachable from our own server (the tool sets are disjoint), which is the
  // point: a contract that holds only while the producer is correct is not one.
  const AMBIGUOUS: [unknown, string][] = [
    [{ proposal: PROPOSAL, composeError: "boom" }, "a proposal and a refusal"],
    [{ proposal: PROPOSAL, pageInserts: { content: PAGE_DOC } }, "a proposal and page inserts"],
    [{ pageInserts: { content: PAGE_DOC }, composeError: "boom" }, "page inserts and a refusal"],
  ];

  it.each(AMBIGUOUS)("rejects %j (%s)", (metadata) => {
    expect(AskStreamMetadata.safeParse(metadata).success).toBe(false);
  });

  // The failure mode the pair above is really about: an invalid outcome must
  // surface as invalid, not be masked by whichever sibling key happens to parse.
  it("does not let a valid sibling key hide a malformed outcome", () => {
    const parsed = AskStreamMetadata.safeParse({
      proposal: { proposalId: "p1" },
      composeError: 'Macro "cost.day" params failed validation.',
    });
    expect(parsed.success).toBe(false);
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

// **A type-level test, and it covers the half of the envelope no parse can
// reach.** The client's `safeParse` already rejects a misspelled key; what it
// cannot do is stop the server from SENDING one, and producer-side safety is
// half of why KI-22 moved this shape into contracts at all. The trap is that
// `{}` is assignable FROM any object, so one `{}` member would make the whole
// union accept every object and a typo would compile at the producer.
describe("the envelope's TYPE pins the producer to the same four shapes", () => {
  it("refuses a misspelled key where `handleAskRequest` builds the chunk", () => {
    // Shaped exactly like `messageMetadata` in `apps/web/src/server/ai`.
    const messageMetadata = (): AskStreamMetadata | undefined =>
      // @ts-expect-error `proposalTypo` is not a key this envelope may carry
      ({ proposalTypo: PROPOSAL });
    expect(AskStreamMetadata.safeParse(messageMetadata()).success).toBe(false);
  });

  it("refuses a fifth key beside a valid proposal, which the parse forgives", () => {
    // Forward compatibility is a CONSUMER rule: an older client strips a key a
    // newer server added. The producer is the newer server, and has no reason
    // to emit a key it does not also ship a schema for.
    const messageMetadata = (): AskStreamMetadata | undefined =>
      // @ts-expect-error `warning` is not a key this envelope may carry
      ({ proposal: PROPOSAL, warning: "from the future" });
    expect(AskStreamMetadata.safeParse(messageMetadata()).success).toBe(true);
  });

  it("still lets the empty shape be built, because silence is a real answer", () => {
    const messageMetadata = (): AskStreamMetadata | undefined => ({});
    expect(AskStreamMetadata.safeParse(messageMetadata()).success).toBe(true);
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

/**
 * Corrupt ONE entry of the field `how` names, at `index` within it.
 *
 * The index is the finding CodeRabbit made on this test: corrupting entry 0 and
 * nothing else, against a generator that emits up to four, asserts "the first
 * entry" while claiming "anywhere". The returned `cell` is what the witness
 * counts, so a position that stops being reached is visible rather than assumed.
 */
function corrupt(
  proposal: RawProposal,
  how: Corruption,
  index: number,
): { proposal: RawProposal; cell: string } {
  const at = (length: number) => index % length;
  const swap = <T>(entries: T[], position: number, replacement: T): T[] =>
    entries.map((entry, i) => (i === position ? replacement : entry));
  const cell = (position: number) => `${how}@${position}`;

  switch (how) {
    case "change-without-text": {
      const i = at(proposal.changes.length);
      const stripped = { type: proposal.changes[i]!.type } as { type: string; text: string };
      return { proposal: { ...proposal, changes: swap(proposal.changes, i, stripped) }, cell: cell(i) };
    }
    case "change-typed-as-non-command": {
      const i = at(proposal.changes.length);
      const mistyped = { ...proposal.changes[i]!, type: "activity.move" };
      return { proposal: { ...proposal, changes: swap(proposal.changes, i, mistyped) }, cell: cell(i) };
    }
    case "insert-without-savedDayId": {
      const i = at(proposal.inserts.length);
      const stripped = { name: proposal.inserts[i]!.name } as { savedDayId: string; name: string };
      return { proposal: { ...proposal, inserts: swap(proposal.inserts, i, stripped) }, cell: cell(i) };
    }
    case "insert-as-a-bare-string": {
      const i = at(proposal.inserts.length);
      const bare = DAY_ID as unknown as { savedDayId: string; name: string };
      return { proposal: { ...proposal, inserts: swap(proposal.inserts, i, bare) }, cell: cell(i) };
    }
    case "skipped-entry-that-is-not-a-string": {
      const i = at(proposal.skipped.length);
      return { proposal: { ...proposal, skipped: swap(proposal.skipped, i, 7) }, cell: cell(i) };
    }
    case "blank-proposalId":
      // A scalar, so it has exactly one position and the cell says so.
      return { proposal: { ...proposal, proposalId: "" }, cell: cell(0) };
  }
}

// Every array is `minLength: 1`, so `corrupt` has something to corrupt in every
// position and the property body carries no guard clause — which is what lets
// the assertion count be `numRuns` exactly rather than a measured fraction of it
// (`packages/domain/test/support/witness.ts`). The empty-array cases are
// covered by the examples above, where they belong.
const MAX_ENTRIES = { changes: 4, inserts: 3, skipped: 3 } as const;

const rawProposalArb: fc.Arbitrary<RawProposal> = fc.record({
  proposalId: fc.string({ minLength: 1 }),
  changes: fc
    .array(
      fc.record({
        type: fc.constantFrom("AddDay", "AddActivity", "RemoveActivity", "SetTripName"),
        text: fc.string({ minLength: 1 }),
      }),
      { minLength: 1, maxLength: MAX_ENTRIES.changes },
    ),
  commands: fc.subarray([ADD_DAY, ADD_ACTIVITY] as unknown[], { minLength: 1 }),
  inserts: fc.array(fc.record({ savedDayId: fc.constant(DAY_ID), name: fc.string() }), {
    minLength: 1,
    maxLength: MAX_ENTRIES.inserts,
  }),
  skipped: fc.array(fc.string() as fc.Arbitrary<unknown>, { minLength: 1, maxLength: MAX_ENTRIES.skipped }),
});

// 0..11 rather than 0..3, because `corrupt` takes it modulo the array's actual
// length: 12 is divisible by every length an array here can have, so every
// position of a given array is drawn equally often. A `max` of 3 would hand
// position 0 of a three-entry array twice the traffic of positions 1 and 2.
const indexArb = fc.nat({ max: 11 });

// How many positions each arm can reach — the array's own `maxLength`, and 1
// for the arm that corrupts a scalar.
const POSITIONS: Record<Corruption, number> = {
  "change-without-text": MAX_ENTRIES.changes,
  "change-typed-as-non-command": MAX_ENTRIES.changes,
  "insert-without-savedDayId": MAX_ENTRIES.inserts,
  "insert-as-a-bare-string": MAX_ENTRIES.inserts,
  "skipped-entry-that-is-not-a-string": MAX_ENTRIES.skipped,
  "blank-proposalId": 1,
};
const CELLS = CORRUPTIONS.flatMap((how) =>
  Array.from({ length: POSITIONS[how] }, (_, position) => `${how}@${position}`),
);

const NUM_RUNS = 6_000;

describe("a malformed entry anywhere makes the whole proposal fail to parse", () => {
  it("holds for every field position", () => {
    let asserted = 0;
    const seen = new Map<string, number>();
    fc.assert(
      fc.property(rawProposalArb, fc.constantFrom(...CORRUPTIONS), indexArb, (proposal, how, index) => {
        // Asserted, not skipped. A generator that drifted into producing
        // proposals the schema already rejects would make the corruption
        // assertion below pass for the wrong reason — P4's vacuous property in
        // one line — so the base case is checked rather than filtered.
        expect(AskStreamMetadata.safeParse({ proposal }).success).toBe(true);
        const corrupted = corrupt(proposal, how, index);
        expect(AskStreamMetadata.safeParse({ proposal: corrupted.proposal }).success).toBe(false);
        seen.set(corrupted.cell, (seen.get(corrupted.cell) ?? 0) + 1);
        asserted += 1;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(asserted).toBe(NUM_RUNS);
    // The second vacuity mode the witness helper names: the input space
    // shrinking. An assertion count cannot see an arm — or, since this test was
    // reviewed, a *position* — that stopped being reached, because both are
    // drawn from rather than iterated. So every (arm, position) cell is counted
    // by name. **Measured, not guessed** (2026-09-11, six runs of 6,000): the
    // least-drawn cell of each run landed at 47, 52, 53, 53, 57 and 74, and was
    // `changes`' last position every time — it needs a four-entry array, which
    // fast-check draws least often. 23 is half the observed minimum, the rule
    // the witness helper states: far enough below not to flap, far enough above
    // zero to catch a position that stopped being generated. `numRuns` is 6,000
    // rather than the 300 this started at because 18 cells with one that rare
    // left the floor in single digits, where it flapped — measured, at 1,200,
    // the same cell landed between 5 and 17 across six runs.
    expect([...seen.keys()].sort()).toEqual([...CELLS].sort());
    for (const cell of CELLS) expect(seen.get(cell)!).toBeGreaterThanOrEqual(23);
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
