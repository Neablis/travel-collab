import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantProposal, BatchableCommand } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { listSnapshots } from "@/server/snapshots/snapshots";
import { listSuggestionChanges } from "@/server/suggestions/list";

// The access seam's module also holds the session-reading wrapper; nothing
// here reads a session, and this keeps next-auth out of the run.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// `createSuggestion` made to throw on demand: a dropped connection mid-insert
// is the case the snapshot cleanup exists for, and no input can cause one.
let throwOnCreate = false;
let refuseOnCreate = false;
vi.mock("@/server/suggestions/create", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/suggestions/create")>();
  return {
    ...actual,
    createSuggestion: vi.fn(async (...args: Parameters<typeof actual.createSuggestion>) => {
      if (throwOnCreate) throw new Error("connection terminated unexpectedly");
      if (refuseOnCreate) {
        return { ok: false as const, error: { code: "too-many-pending" as const, message: "This trip already has 200 pending changes." } };
      }
      return actual.createSuggestion(...args);
    }),
  };
});

// `deleteSnapshot` made to throw on demand, for the cleanup after a refusal.
let throwOnDelete = false;
vi.mock("@/server/snapshots/snapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/snapshots/snapshots")>();
  return {
    ...actual,
    deleteSnapshot: vi.fn(async (...args: Parameters<typeof actual.deleteSnapshot>) => {
      if (throwOnDelete) throw new Error("connection terminated unexpectedly");
      return actual.deleteSnapshot(...args);
    }),
  };
});

const { suggestProposal } = await import("./suggestProposal");

let OWNER = "";
let tripId = "";

beforeEach(async () => {
  throwOnCreate = false;
  refuseOnCreate = false;
  throwOnDelete = false;
  OWNER = `suggest-proposal-owner-${randomUUID().slice(0, 8)}`;
  tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
});

const addDay = (): BatchableCommand => ({ type: "AddDay", tripId, dayId: randomUUID() });

function proposal(commands: BatchableCommand[], skipped: string[] = []): AssistantProposal {
  return {
    proposalId: "p1",
    changes: commands.map((c) => ({ type: c.type, text: `A ${c.type}` })),
    commands,
    inserts: [],
    skipped,
  };
}

async function stored(): Promise<{ changes: number; snapshots: number }> {
  const changes = await listSuggestionChanges(tripId, OWNER);
  const snapshots = await listSnapshots(tripId, OWNER);
  return {
    changes: changes.ok ? changes.value.changes.length : -1,
    snapshots: snapshots.ok ? snapshots.value.length : -1,
  };
}

const ask = (p: AssistantProposal) => suggestProposal(p, { tripId, userId: OWNER, question: "add two days" });

describe("suggestProposal", () => {
  it("carries what the resolver skipped onto the stored outcome", async () => {
    const skipped = ["“Dinner” is not on this trip, so it was left out."];
    const { metadata, outcome } = await ask(proposal([addDay(), addDay()], skipped));
    expect(metadata).toMatchObject({ suggested: { changeCount: 2, skipped } });
    expect(outcome).toEqual({ kind: "suggested", changeCount: 2, snapshot: "saved" });
  });

  it("takes back the snapshot it saved when storing the suggestion throws, and answers the card", async () => {
    throwOnCreate = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { metadata, outcome } = await ask(proposal([addDay(), addDay()]));
    errors.mockRestore();
    expect(outcome).toEqual({ kind: "notSuggested", code: "error" });
    expect(metadata).toMatchObject({ proposal: { notSuggested: expect.stringContaining("could not be put on the board") } });
    expect(await stored()).toEqual({ changes: 0, snapshots: 0 });
  });

  // CodeRabbit on #378: a cleanup that throws must not turn a refusal into
  // the generic error, and must not be tried twice.
  it("keeps a refusal's own reason when taking back its snapshot throws", async () => {
    refuseOnCreate = true;
    throwOnDelete = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { metadata, outcome } = await ask(proposal([addDay(), addDay()]));
    errors.mockRestore();
    expect(outcome).toEqual({ kind: "notSuggested", code: "too-many-pending" });
    expect(metadata).toMatchObject({ proposal: { notSuggested: expect.stringContaining("200 pending changes") } });
  });

  // `DismissConflict` is a planning tool's command (spec W3 keeps it out of
  // suggestions), so a turn can carry one. "More than one suggestion can hold"
  // would be the wrong reason for a two-change turn.
  it("says a suggestion cannot dismiss a conflict, rather than that there were too many changes", async () => {
    const dismiss: BatchableCommand = { type: "DismissConflict", tripId, conflictId: "overlap:a:b" };
    const { metadata, outcome } = await ask(proposal([addDay(), dismiss]));
    expect(outcome).toEqual({ kind: "notSuggested", code: "unsupported-command" });
    const notSuggested = (metadata as { proposal: { notSuggested: string } }).proposal.notSuggested;
    expect(notSuggested).toContain("A suggestion cannot dismiss a conflict");
    expect(notSuggested).not.toContain("more than");
    expect(await stored()).toEqual({ changes: 0, snapshots: 0 });
  });

  it("says when there are more changes than one suggestion holds", async () => {
    const { metadata, outcome } = await ask(proposal(Array.from({ length: 51 }, addDay)));
    expect(outcome).toEqual({ kind: "notSuggested", code: "too-many-changes" });
    expect((metadata as { proposal: { notSuggested: string } }).proposal.notSuggested).toContain(
      "These are 51 changes, and one suggestion holds at most 50.",
    );
    expect(await stored()).toEqual({ changes: 0, snapshots: 0 });
  });
});
