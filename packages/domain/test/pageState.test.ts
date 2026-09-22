import { describe, expect, it } from "vitest";
import type { EventEnvelope, PageDoc } from "@tc/contracts";
import {
  decidePageCommand,
  diffPageStates,
  evolvePages,
  foldPages,
  pageStatesEqual,
  type PagesState,
} from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const P1 = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const P2 = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a81";
const ALICE = "alice";

const doc = (text: string): PageDoc =>
  ({ v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as PageDoc;

const ctx = (kind?: "overview") => ({ tripId: TRIP, ...(kind === undefined ? {} : { kind }) });

function envelope(seq: number, type: string, payload: unknown): EventEnvelope {
  return {
    streamId: TRIP,
    seq,
    type,
    version: 1,
    payload,
    actorId: ALICE,
    occurredAt: "2026-09-22T00:00:00.000Z",
    batchId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    origin: { kind: "user" },
  };
}

const created = (seq: number, pageId: string, title: string, text: string, kind?: "overview") =>
  envelope(seq, "PageCreated", { tripId: TRIP, pageId, title, context: ctx(kind), content: doc(text), actorId: ALICE });

describe("evolvePages", () => {
  it("creates, edits and deletes", () => {
    let state: PagesState = {};
    state = evolvePages(state, {
      type: "PageCreated",
      version: 1,
      payload: { tripId: TRIP, pageId: P1, title: "Overview", context: ctx(), content: doc("a"), actorId: ALICE },
    });
    expect(state[P1]?.title).toBe("Overview");

    state = evolvePages(state, {
      type: "PageEdited",
      version: 1,
      payload: { tripId: TRIP, pageId: P1, content: doc("b") },
    });
    expect(state[P1]?.title).toBe("Overview");
    expect(state[P1]?.content).toEqual(doc("b"));

    state = evolvePages(state, { type: "PageDeleted", version: 1, payload: { tripId: TRIP, pageId: P1 } });
    expect(state[P1]).toBeUndefined();
  });

  // The backfill is why this absorbs rather than throwing, unlike the trip
  // aggregate's `requireDay`. A trip whose genesis events are still being
  // migrated must still fold.
  it("absorbs an edit to a page it never saw created", () => {
    expect(() =>
      evolvePages({}, { type: "PageEdited", version: 1, payload: { tripId: TRIP, pageId: P1, title: "x" } }),
    ).not.toThrow();
    expect(evolvePages({}, { type: "PageEdited", version: 1, payload: { tripId: TRIP, pageId: P1, title: "x" } })).toEqual({});
  });
});

describe("foldPages", () => {
  // The whole reason page events can share the trip's stream: each fold reads
  // only its own aggregate's events and steps over the other's.
  it("steps over the trip's own events", () => {
    const envelopes = [
      envelope(1, "TripCreated", { tripId: TRIP, name: "Japan", createdBy: ALICE, forkedFrom: null }),
      created(2, P1, "Overview", "a"),
      envelope(3, "DayAdded", { tripId: TRIP, dayId: P2 }),
    ];
    expect(Object.keys(foldPages(envelopes))).toEqual([P1]);
  });

  it("stops at toSeq, which is what undo folds to", () => {
    const envelopes = [
      created(1, P1, "Overview", "first"),
      envelope(2, "PageEdited", { tripId: TRIP, pageId: P1, content: doc("second") }),
    ];
    expect(foldPages(envelopes, 1)[P1]?.content).toEqual(doc("first"));
    expect(foldPages(envelopes)[P1]?.content).toEqual(doc("second"));
  });
});

describe("pageStatesEqual", () => {
  // The bug this exists to prevent: `JSON.stringify` calls two documents that
  // differ only in key order different, so an undo would emit a `PageEdited`
  // that changes nothing and the next comparison would ask for it again.
  it("ignores key order inside the document", () => {
    const a = { title: "T", context: ctx(), content: { v: 1, type: "doc", content: [] } as unknown as PageDoc, actorId: ALICE };
    const b = { title: "T", context: ctx(), content: { content: [], type: "doc", v: 1 } as unknown as PageDoc, actorId: ALICE };
    expect(pageStatesEqual(a, b)).toBe(true);
  });

  it("sees a real content change", () => {
    const a = { title: "T", context: ctx(), content: doc("one"), actorId: ALICE };
    const b = { title: "T", context: ctx(), content: doc("two"), actorId: ALICE };
    expect(pageStatesEqual(a, b)).toBe(false);
  });
});

describe("diffPageStates — the events that make undo cover notebooks", () => {
  const page = (title: string, text: string) => ({ title, context: ctx(), content: doc(text), actorId: ALICE });

  it("re-creates a page the target has and the present does not", () => {
    const events = diffPageStates({}, { [P1]: page("Overview", "a") }, TRIP);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("PageCreated");
  });

  it("deletes a page the present has and the target does not", () => {
    const events = diffPageStates({ [P1]: page("Overview", "a") }, {}, TRIP);
    expect(events).toEqual([{ type: "PageDeleted", version: 1, payload: { tripId: TRIP, pageId: P1 } }]);
  });

  it("carries only the fields that actually differ", () => {
    const events = diffPageStates({ [P1]: page("Overview", "a") }, { [P1]: page("Overview", "b") }, TRIP);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "PageEdited", payload: { pageId: P1 } });
    // Title is unchanged, so it must not be sent — otherwise undo rewrites a
    // field nobody touched.
    expect(events[0]!.payload).not.toHaveProperty("title");
    expect(events[0]!.payload).toHaveProperty("content");
  });

  it("produces nothing when the two states already agree", () => {
    const same = { [P1]: page("Overview", "a") };
    expect(diffPageStates(same, { ...same }, TRIP)).toEqual([]);
  });
});

describe("decidePageCommand", () => {
  const overview: PagesState = {
    [P1]: { title: "Overview", context: ctx("overview"), content: doc("a"), actorId: "system" },
  };

  // The autosave fires on the pause AFTER a change that already saved. Writing
  // that would put a no-op row in the history panel for every trailing pause.
  it("writes no event when the content did not actually change", () => {
    const decision = decidePageCommand(overview, { type: "EditPage", tripId: TRIP, pageId: P1, content: doc("a") }, ALICE);
    expect(decision).toEqual({ ok: true, events: [] });
  });

  it("writes an event when it did", () => {
    const decision = decidePageCommand(overview, { type: "EditPage", tripId: TRIP, pageId: P1, content: doc("b") }, ALICE);
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.events).toHaveLength(1);
  });

  it("refuses to delete the Overview, in the same words the table did", () => {
    const decision = decidePageCommand(overview, { type: "DeletePage", tripId: TRIP, pageId: P1 }, ALICE);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.rejection.code).toBe("page-undeletable");
  });

  it("makes the caller the owner of a page they create", () => {
    const decision = decidePageCommand({}, {
      type: "CreatePage", tripId: TRIP, pageId: P2, title: "Packing", context: ctx(), content: doc("x"),
    }, ALICE);
    expect(decision.ok && decision.events[0]).toMatchObject({ payload: { actorId: ALICE } });
  });
});
