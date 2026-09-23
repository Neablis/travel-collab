// **Recorded model transcripts replay in CI without a live call** — M9's
// exit-gate box, and the lane that closes KI-11.
//
// Read `transcript.ts` first: it says what a transcript is, why it is not a
// mock, and — for the ones in `transcripts/` today — exactly what `synthetic`
// means and what it does not buy.
//
// **What this lane is evidence ABOUT.** The model is a recording; everything
// else is the shipped path — the admission pipeline, the real tool schemas,
// `repairToolInput`, `resolveBatch`, `buildProposal`, `groundCitedPlaces`, the
// fences. So a green run says: *given what a provider actually put on the wire,
// the code around it does the right thing.* It says nothing about what a
// provider will put on the wire next, which is the gate's OTHER box and needs a
// live key this repo has none of.
//
// **Every assertion is about shape, never about prose.** A model's words are
// not reproducible and asserting them would make the lane fail on a re-record
// for no reason. Steps, tool names in order, dropped calls, proposal size — all
// of those are facts about our own code's response to a fixed input.
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { rateLimitCounters, tripMemberships } from "@/server/db/schema";
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from "@/server/assistant/prompt";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import { replayTranscript, type AskTranscript } from "./transcript";

const ACTOR_ID = "replay-actor";

// `guard()` reaches next-auth, which a unit lane cannot load — the same mock
// the /ask route's own integration suite uses, for the same reason.
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: ACTOR_ID } }) }));

const { handleAskRequest } = await import("@/server/ai/handleAskRequest");

const TRANSCRIPT_DIR = join(import.meta.dirname, "transcripts");

/**
 * Every transcript in the directory — **discovered, never listed**.
 *
 * A hand-written list is a second place to add a transcript, and the one that
 * gets forgotten: a recording committed but not registered is a file that looks
 * like coverage and is not. `readdirSync` makes "which transcripts are there"
 * a measurement.
 */
function everyTranscript(): AskTranscript[] {
  return readdirSync(TRANSCRIPT_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(TRANSCRIPT_DIR, file), "utf8")) as AskTranscript);
}

/** A trip with three dated days and one located, costed stop on day 1. */
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const create = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2027" }, ACTOR_ID);
  if (!create.ok) throw new Error("failed to seed trip");
  const dated = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-03",
      newDayIds: [randomUUID(), randomUUID(), randomUUID()],
    },
    ACTOR_ID,
  );
  if (!dated.ok) throw new Error("failed to date trip");
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId: dated.detail.days[0]!.dayId,
      title: "Fushimi Inari",
      timeWindow: { start: "09:00", end: "11:00" },
    },
    ACTOR_ID,
  );
  return tripId;
}

/**
 * The place search, stubbed at the PORT rather than at the vendor.
 *
 * A transcript records what the MODEL did; what the gazetteer answered is not
 * part of it, and a replay that reached LocationIQ would need a key and would
 * stop being deterministic. Two fixed candidates are enough for a citation to
 * resolve, which is the thing under test.
 */
vi.mock("@/server/ai/assistantPorts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/assistantPorts")>();
  return {
    ...actual,
    placeSearchPort: {
      search: async ({ queries }: { queries: readonly string[] }) =>
        queries.map((query) => ({
          query,
          places: [{ name: `${query} — a real place`, lat: 43.0866, lng: -79.0628, city: "Niagara Falls" }],
        })),
    },
  };
});

function requestFor(tripId: string, transcript: AskTranscript) {
  return new Request(`http://test/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: transcript.question }] }],
      scope: transcript.scope,
    }),
  });
}

/** The SSE body as the chunks a browser client parses out of it. */
function chunksOf(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

interface ReplayResult {
  record: AskAnalyticsRecord;
  body: string;
  chunks: Record<string, unknown>[];
}

async function replay(transcript: AskTranscript): Promise<ReplayResult> {
  const tripId = await seedTrip();
  const records: AskAnalyticsRecord[] = [];
  const res = await handleAskRequest(
    requestFor(tripId, transcript),
    tripId,
    replayTranscript(transcript),
    (record) => records.push(record),
  );
  const body = await res.text();
  return { record: records[0]!, body, chunks: chunksOf(body) };
}

interface ProposalShape {
  changes: { text: string }[];
  commands: Record<string, unknown>[];
  skipped: string[];
}

function proposalOf(chunks: Record<string, unknown>[]): ProposalShape | undefined {
  return chunks
    .map((chunk) => (chunk as { messageMetadata?: { proposal?: ProposalShape } }).messageMetadata)
    .find((meta) => meta?.proposal)?.proposal;
}

/** Every command in the proposal, or none. */
function commandsOf(chunks: Record<string, unknown>[]): Record<string, unknown>[] {
  return proposalOf(chunks)?.commands ?? [];
}

function locationOf(command: Record<string, unknown>): Record<string, unknown> | null {
  const location = command.location;
  return typeof location === "object" && location !== null ? (location as Record<string, unknown>) : null;
}

beforeAll(async () => {
  await db.delete(tripMemberships);
});

// **The step quota is keyed by ACTOR, and every replay here is the same one.**
// `MAX_ASK_STEPS + 1` steps are reserved per turn against a daily ceiling, so
// without this the file runs out of budget partway through and the rest of the
// transcripts get a 429 instead of a turn — which reads as the harness being
// broken rather than as the quota doing its job. The /ask route's own suite
// truncates this table for the same reason.
beforeEach(async () => {
  await db.delete(rateLimitCounters);
});

describe("the eval set", () => {
  // The set is small and fixed on purpose. Its value is that every member is a
  // recorded incident rather than a case somebody imagined — so a transcript
  // with no `about` is one nobody can decide the fate of later.
  it("is discovered from the directory, and every member says what it is for", () => {
    const transcripts = everyTranscript();
    expect(transcripts.length).toBeGreaterThanOrEqual(5);
    // **Witness floors, because the per-transcript assertions are CONDITIONAL**
    // (CodeRabbit, PR #184). `locationNames`, `droppedCalls` and `outcome` each
    // return early when a transcript omits them — so an eval set with no
    // grounded member would run the grounding check zero times and stay green.
    // `transcript.ts` calls `locationNames` "the one assertion that can tell
    // grounding from a prompt", and a claim like that has to be MEASURED. The
    // floor lives here because this is the test that already measures the
    // directory.
    expect(transcripts.filter((t) => t.expect.locationNames !== undefined).length).toBeGreaterThan(0);
    expect(transcripts.filter((t) => (t.expect.droppedCalls ?? 0) > 0).length).toBeGreaterThan(0);
    expect(transcripts.filter((t) => (t.expect.proposalChanges ?? 0) > 0).length).toBeGreaterThan(0);
    // ...and at least one that does NOT end cleanly, or the outcome assertion
    // is a constant.
    expect(transcripts.filter((t) => (t.expect.outcome ?? "completed") !== "completed").length).toBeGreaterThan(0);
    for (const transcript of transcripts) {
      expect(transcript.about, transcript.name).toBeTruthy();
      expect(transcript.source.kind, transcript.name).toMatch(/^(recorded|synthetic)$/);
      if (transcript.source.kind === "synthetic") {
        // A synthetic transcript's whole justification is the incident it
        // reproduces. Without that it is a mock with extra ceremony, which is
        // the thing KI-11 says does not close the gap.
        expect(transcript.source.from, transcript.name).toBeTruthy();
      }
    }
  });
});

describe.each(everyTranscript())("replaying $name", (transcript) => {
  // **Replayed ONCE per transcript, not once per assertion.** A turn is a
  // database write, a quota reservation and a settlement; running it four times
  // to ask four questions about it would make the file's cost quadruple for no
  // extra evidence — every assertion below is about the same turn.
  let result: ReplayResult;
  beforeAll(async () => {
    await db.delete(rateLimitCounters);
    result = await replay(transcript);
  });

  it("takes the round-trips the recording took, and calls the tools it called", () => {
    expect(result.record.steps).toBe(transcript.expect.steps);
    expect(result.record.toolCalls.map((call) => call.name)).toEqual(transcript.expect.toolCalls);
  });

  it("resolves the turn into the proposal the recording justifies", () => {
    const proposal = proposalOf(result.chunks);
    expect(proposal?.changes.length ?? 0).toBe(transcript.expect.proposalChanges ?? 0);
    if (transcript.expect.droppedCalls !== undefined) {
      expect(result.record.droppedCalls).toHaveLength(transcript.expect.droppedCalls);
    }
    if (transcript.expect.answered !== undefined) {
      expect(result.record.answered).toBe(transcript.expect.answered);
    }
  });

  // **The fence, over every transcript rather than over one.** A tool result
  // carries other people's text wrapped in `⟦ ⟧`, and the standing rule tells
  // the model never to repeat the marks. Nothing stops a bug putting them in
  // the OUTPUT, and #162's browser walk is the only thing that has ever checked
  // — once, by hand, on six surfaces.
  //
  // **Asserted on what a person READS, not on the whole SSE body**, and the
  // difference is a real one this lane found: the stream carries the raw tool
  // results too, fences and all, because that is the model's data channel and
  // the client never renders it (`Transcript.tsx` renders a tool's NAME).
  // Asserting on the body would have made the fence rule fail on its own
  // correct behaviour.
  it("leaks no fence marker into anything a person reads", () => {
    const spoken = result.chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => String(chunk.delta))
      .join("");
    const proposal = proposalOf(result.chunks);
    const shown = [spoken, ...(proposal?.changes.map((change) => change.text) ?? [])].join("\n");
    expect(shown).not.toContain(UNTRUSTED_OPEN);
    expect(shown).not.toContain(UNTRUSTED_CLOSE);
  });

  // **The gate box, asserted over every transcript rather than over the one
  // written for it.** The 2026-08-02 dogfood run wrote `amountMinor: 0` on all
  // nine activities it planned, which the board renders as FREE where the truth
  // was "nobody knows yet". `withoutFabricatedCost` runs in `buildProposal` and
  // again at the apply door; this is the first thing that watches a MODEL do it
  // on the shipped path.
  it("writes no fabricated cost, whatever the model asked for", () => {
    for (const command of commandsOf(result.chunks)) {
      const cost = command.cost as { amountMinor?: number } | null | undefined;
      expect(cost?.amountMinor, JSON.stringify(command)).not.toBe(0);
    }
  });

  // **A citation is transport and must never leave the server.** It is resolved
  // into a real location before the proposal is serialised, so a `placeRef` on
  // the wire means the resolution stopped happening — and the stop would commit
  // with whatever the model typed.
  it("resolves every citation away before the proposal leaves", () => {
    for (const command of commandsOf(result.chunks)) {
      expect(Object.keys(command), JSON.stringify(command)).not.toContain("placeRef");
    }
  });

  // `Location.precision` says what a coordinate DESCRIBES, and the contract's
  // own refinement makes it unparseable without one. Server-written by
  // construction since M9 — a model's claim is stripped before the server's is
  // written — so a `precision` with no coordinates would mean both halves of
  // that broke at once.
  it("never writes a precision without the coordinates it describes", () => {
    for (const command of commandsOf(result.chunks)) {
      const location = locationOf(command);
      if (location?.precision === undefined) continue;
      expect(location.lat, JSON.stringify(location)).toEqual(expect.any(Number));
      expect(location.lng, JSON.stringify(location)).toEqual(expect.any(Number));
    }
  });

  it("commits the places the search returned, not the ones the model typed", () => {
    if (transcript.expect.locationNames === undefined) return;
    const names = commandsOf(result.chunks)
      .map((command) => locationOf(command)?.name)
      .filter((name): name is string => typeof name === "string");
    expect(names).toEqual(transcript.expect.locationNames);
  });

  // **How the turn ENDED is part of the recording**, not an assumption about
  // it. A transcript of a provider emitting unparseable tool arguments records
  // a turn that dies — that is what happened, and a harness that expected every
  // replay to end cleanly would be asserting the absence of the failures it
  // exists to hold.
  it("ends the way the recording ended", () => {
    expect(result.record.outcome).toBe(transcript.expect.outcome ?? "completed");
    if ((transcript.expect.outcome ?? "completed") === "completed") {
      expect(result.record.cause).toBeNull();
    }
  });
});
