import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { PollPayload, WidgetContext } from "../../registry-types";
import { pollClosed, pollSpecOf, pollsIn } from "./poll";

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
});
