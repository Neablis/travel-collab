import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { PollPayload, WidgetContext } from "../../registry-types";
import { insertWidget } from "../../insert";
import { pollClosed, pollSpecOf, pollsIn, withPollIds } from "./poll";

// "Poll" (M58 decision 8). What a reader cannot check from the screen is what
// a stranger is handed (counts, never a poll id or a voter), how the option
// text becomes ids a vote can keep, and when a poll counts as closed.

const POLL_ID = "11111111-1111-4111-8111-111111111111";
const trip: TripDetail = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } });
const ctx = (extra: Partial<WidgetContext> = {}): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null, ...extra,
});
const params = { pollId: POLL_ID, question: "Where to eat?", options: "Ramen, Sushi , Tempura" };

function pollOf(context: WidgetContext, raw: Record<string, unknown> = params): PollPayload {
  const outcome = renderMacro(context, "poll", raw);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "poll") {
    throw new Error(`expected a poll block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("poll", () => {
  it("reads the options as a comma-separated list, each trimmed, one id per label", () => {
    expect(pollOf(ctx()).options).toEqual([
      { id: "Ramen", label: "Ramen" }, { id: "Sushi", label: "Sushi" }, { id: "Tempura", label: "Tempura" },
    ]);
  });

  // Decision 8, "Editing after votes are in": renaming an option keeps its votes,
  // so an option's id is its own and the label is only what is shown.
  it("keeps an option's id when its label is renamed", () => {
    const options = [{ id: "opt-a", label: "Ramen" }, { id: "opt-b", label: "Sushi" }];
    const before = pollSpecOf({ ...params, options });
    const after = pollSpecOf({ ...params, options: [{ id: "opt-a", label: "Ramen bar" }, options[1]] });
    expect(before?.options.map((o) => o.id)).toEqual(["opt-a", "opt-b"]);
    expect(after?.options).toEqual([{ id: "opt-a", label: "Ramen bar" }, { id: "opt-b", label: "Sushi" }]);
  });

  it("skips an option row whose label is still blank", () => {
    const options = [{ id: "a", label: "Ramen" }, { id: "b", label: "  " }, { id: "c", label: "Sushi" }];
    expect(pollSpecOf({ ...params, options })?.options.map((o) => o.id)).toEqual(["a", "c"]);
  });

  // A poll's identity is minted once, when it is inserted. Parsing a stored
  // node with none used to invent a new id on every read.
  it("is no poll until it has an id: a missing one is not minted on read", () => {
    const { pollId: _omitted, ...withoutId } = params;
    expect(pollSpecOf(withoutId)).toBeNull();
    expect(pollsIn({ type: "macro", attrs: { name: "poll", params: withoutId } })).toEqual([]);
    expect(renderMacro(ctx(), "poll", withoutId).status).toBe("empty");
  });

  it("mints the id when the widget is inserted, a new one each time", () => {
    const idOf = () => {
      const inserted = insertWidget("poll", { question: "Where?" });
      if (!inserted.ok) throw new Error("insert refused");
      return inserted.node.attrs.params.pollId;
    };
    const [first, second] = [idOf(), idOf()];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("drops a repeated or empty option", () => {
    expect(pollSpecOf({ ...params, options: "A,, A ,B" })?.options.map((o) => o.id)).toEqual(["A", "B"]);
  });

  it("is empty until it has a question and two options", () => {
    expect(renderMacro(ctx(), "poll", { ...params, question: "  " }).status).toBe("empty");
    expect(renderMacro(ctx(), "poll", { ...params, options: "Only one" }).status).toBe("empty");
  });

  it("hands a member the poll's id and no counts: the block reads those live", () => {
    expect(pollOf(ctx())).toMatchObject({ pollId: POLL_ID, question: "Where to eat?", multi: false, counts: null, closed: null });
  });

  it("hands a stranger the counts and closed state, and neither the poll id nor anyone's vote", () => {
    const tallies = { [POLL_ID]: { counts: { Ramen: 2, Sushi: 1 }, closed: true } };
    const seen = pollOf(ctx({ reader: "public", pollTallies: tallies }));
    expect(seen).toMatchObject({ pollId: null, counts: { Ramen: 2, Sushi: 1, Tempura: 0 }, closed: true });
    expect(JSON.stringify(seen)).not.toContain(POLL_ID);
  });

  it("shows a stranger zeros where no tally was handed in", () => {
    expect(pollOf(ctx({ reader: "public" })).counts).toEqual({ Ramen: 0, Sushi: 0, Tempura: 0 });
  });

  it("is not shared with a stranger when hidden", () => {
    expect(renderMacro(ctx({ reader: "public" }), "poll", params, undefined, true)).toEqual({ status: "not-shared" });
  });

  it("closes the day after its closing date, or when an editor closed it", () => {
    expect(pollClosed("2026-11-10", false, "2026-11-10")).toBe(false);
    expect(pollClosed("2026-11-10", false, "2026-11-11")).toBe(true);
    expect(pollClosed(null, false, "2099-01-01")).toBe(false);
    expect(pollClosed(null, true, "2026-11-01")).toBe(true);
  });

  it("finds every poll in a stored document, nested ones too, with its settings", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "poll", params: { ...params, multi: true, closesAt: "2026-11-10" } } }] },
        { type: "macro", attrs: { name: "attribute", params: {} } },
      ],
    };
    expect(pollsIn(doc)).toEqual([
      { pollId: POLL_ID, question: "Where to eat?", options: expect.any(Array), multi: true, closesAt: "2026-11-10", hideWhenPublic: false },
    ]);
  });

  // M58 round 5: lost votes beat wrong votes. A poll that lost its id takes the
  // stored one only on an unambiguous question match, never by position.
  describe("withPollIds on a write that dropped the ids", () => {
    const node = (question: string, pollId?: string) => ({
      type: "macro",
      attrs: { name: "poll", params: { question, options: "a, b", ...(pollId ? { pollId } : {}) } },
    });
    const page = (...polls: unknown[]) => ({ type: "doc", content: polls });
    const idsOf = (doc: unknown) => (doc as { content: { attrs: { params: { pollId: string } } }[] }).content.map((n) => n.attrs.params.pollId);
    const ID_A = "00000000-0000-4000-8000-00000000000a";
    const ID_B = "00000000-0000-4000-8000-00000000000b";
    const ID_X = "00000000-0000-4000-8000-0000000000f0";
    let n = 0;
    const mint = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "1")}`;

    it("keeps each stored id by question when a new poll is added in front", () => {
      const out = idsOf(withPollIds(page(node("C"), node("A"), node("B")), mint, page(node("A", ID_A), node("B", ID_B))));
      expect(out[1]).toBe(ID_A);
      expect(out[2]).toBe(ID_B);
      expect([ID_A, ID_B]).not.toContain(out[0]);
    });

    it("gives a new poll a new id when the poll before it was deleted, never the deleted one's", () => {
      const out = idsOf(withPollIds(page(node("C")), mint, page(node("A", ID_A))));
      expect(out[0]).not.toBe(ID_A);
    });

    it("moves no id between different questions when the stored page differs from the one the writer read", () => {
      const out = idsOf(withPollIds(page(node("A2"), node("B2")), mint, page(node("X", ID_X), node("A", ID_A), node("B", ID_B))));
      expect([ID_X, ID_A, ID_B]).not.toContain(out[0]);
      expect([ID_X, ID_A, ID_B]).not.toContain(out[1]);
    });

    it("mints for two polls with the same question, so a reorder swaps nothing", () => {
      const out = idsOf(withPollIds(page(node("Same"), node("Same")), mint, page(node("Same", ID_A), node("Same", ID_B))));
      expect([ID_A, ID_B]).not.toContain(out[0]);
      expect([ID_A, ID_B]).not.toContain(out[1]);
      expect(out[0]).not.toBe(out[1]);
    });
  });
});
