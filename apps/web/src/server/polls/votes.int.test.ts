import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newPageDoc, type PageNode } from "@tc/contracts";
import type { PollSpec } from "@tc/pages";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { castVote, closePoll, pollOnTrip, tallyFor } from "./votes";

// The poll store (M58 decision 8): one vote per person per poll, changeable
// until the poll closes, counted by option, and a poll id only ever means a
// poll written on the trip it is used against.

const OWNER = "votes-owner";
const TODAY = "2026-11-04";

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Votes" }, OWNER);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function seedPoll(tripId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const pollId = randomUUID();
  const poll = { type: "macro", attrs: { name: "poll", params: { pollId, question: "Where to eat?", options: "Ramen, Sushi, Tempura", ...extra } } };
  const created = await executePageCommand(
    { type: "CreatePage", tripId, pageId: randomUUID(), title: "Votes page", context: { tripId }, content: newPageDoc([poll as unknown as PageNode]) },
    OWNER,
  );
  if (!created.ok) throw new Error("failed to seed page");
  return pollId;
}

async function specOf(tripId: string, pollId: string): Promise<PollSpec> {
  const spec = await pollOnTrip(tripId, pollId);
  if (spec === null) throw new Error("poll not found");
  return spec;
}

const countsOf = async (tripId: string, spec: PollSpec) => (await tallyFor(tripId, [spec], TODAY)).get(spec.pollId)!;

describe("poll votes", () => {
  it("finds a poll only on the trip it was written on", async () => {
    const [tripA, tripB] = [await seedTrip(), await seedTrip()];
    const pollId = await seedPoll(tripA);
    expect(await pollOnTrip(tripA, pollId)).toMatchObject({ pollId, question: "Where to eat?" });
    expect(await pollOnTrip(tripB, pollId)).toBeNull();
    expect(await pollOnTrip(tripA, "not-a-uuid")).toBeNull();
    expect(await pollOnTrip(tripA, randomUUID())).toBeNull();
  });

  it("counts each person once and lets them change their vote", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId));
    expect(await castVote(tripId, "ann", spec, ["Ramen"], TODAY)).toEqual({ ok: true });
    expect(await castVote(tripId, "bob", spec, ["Ramen"], TODAY)).toEqual({ ok: true });
    expect((await countsOf(tripId, spec)).counts).toEqual({ Ramen: 2, Sushi: 0, Tempura: 0 });
    expect(await castVote(tripId, "bob", spec, ["Sushi"], TODAY)).toEqual({ ok: true });
    const tally = await countsOf(tripId, spec);
    expect(tally.counts).toEqual({ Ramen: 1, Sushi: 1, Tempura: 0 });
    expect(tally.votes.map((v) => [v.userId, v.optionIds]).sort()).toEqual([["ann", ["Ramen"]], ["bob", ["Sushi"]]]);
  });

  it("refuses an option the poll does not have, and a second pick on a single-choice poll", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId));
    expect(await castVote(tripId, "ann", spec, ["Pizza"], TODAY)).toEqual({ ok: false, error: "invalid" });
    expect(await castVote(tripId, "ann", spec, ["Ramen", "Sushi"], TODAY)).toEqual({ ok: false, error: "invalid" });
    expect((await countsOf(tripId, spec)).votes).toEqual([]);
  });

  it("takes several picks when the poll lets people", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId, { multi: true }));
    expect(await castVote(tripId, "ann", spec, ["Ramen", "Sushi"], TODAY)).toEqual({ ok: true });
    expect((await countsOf(tripId, spec)).counts).toEqual({ Ramen: 1, Sushi: 1, Tempura: 0 });
  });

  it("stops taking votes once an editor closes it, and keeps the votes", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId));
    await castVote(tripId, "ann", spec, ["Ramen"], TODAY);
    expect((await countsOf(tripId, spec)).closed).toBe(false);
    await closePoll(tripId, spec, OWNER, new Date());
    // Closing twice is the same answer, not an error.
    await closePoll(tripId, spec, OWNER, new Date());
    expect(await castVote(tripId, "bob", spec, ["Sushi"], TODAY)).toEqual({ ok: false, error: "closed" });
    expect(await castVote(tripId, "ann", spec, ["Sushi"], TODAY)).toEqual({ ok: false, error: "closed" });
    const tally = await countsOf(tripId, spec);
    expect(tally.closed).toBe(true);
    expect(tally.counts).toEqual({ Ramen: 1, Sushi: 0, Tempura: 0 });
  });

  it("closes on its own the day after its closing date", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId, { closesAt: "2026-11-04" }));
    expect(await castVote(tripId, "ann", spec, ["Ramen"], "2026-11-04")).toEqual({ ok: true });
    expect(await castVote(tripId, "ann", spec, ["Sushi"], "2026-11-05")).toEqual({ ok: false, error: "closed" });
    expect((await tallyFor(tripId, [spec], "2026-11-05")).get(spec.pollId)!.closed).toBe(true);
  });

  it("does not count a vote for an option the poll no longer has", async () => {
    const tripId = await seedTrip();
    const pollId = await seedPoll(tripId);
    const spec = await specOf(tripId, pollId);
    await castVote(tripId, "ann", spec, ["Tempura"], TODAY);
    const edited: PollSpec = { ...spec, options: spec.options.filter((o) => o.id !== "Tempura") };
    const tally = await countsOf(tripId, edited);
    expect(tally.counts).toEqual({ Ramen: 0, Sushi: 0 });
    expect(tally.votes).toEqual([]);
  });
});
