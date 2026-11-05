import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newPageDoc, type PageNode } from "@tc/contracts";
import type { PollSpec } from "@tc/pages";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { castVote, closePoll, pollOnTrip, reopenPoll, tallyFor, writeVote } from "./votes";

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

async function seedPoll(tripId: string, extra: Record<string, unknown> = {}, pollId = randomUUID()): Promise<string> {
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

  it("reopens a closed poll: the close goes, the votes stay, and voting works again", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId));
    await castVote(tripId, "ann", spec, ["Ramen"], TODAY);
    await closePoll(tripId, spec, OWNER, new Date());
    expect((await countsOf(tripId, spec)).closed).toBe(true);
    expect(await reopenPoll(tripId, spec, TODAY)).toEqual({ ok: true });
    const tally = await countsOf(tripId, spec);
    expect(tally.closed).toBe(false);
    expect(tally.counts).toEqual({ Ramen: 1, Sushi: 0, Tempura: 0 });
    expect(await castVote(tripId, "bob", spec, ["Sushi"], TODAY)).toEqual({ ok: true });
    // Reopening an open poll is the same answer, not an error.
    expect(await reopenPoll(tripId, spec, TODAY)).toEqual({ ok: true });
    expect((await countsOf(tripId, spec)).closed).toBe(false);
  });

  it("reopens only that trip's close, not the same poll id's on another trip", async () => {
    const [tripA, tripB] = [await seedTrip(), await seedTrip()];
    const pollId = randomUUID();
    await seedPoll(tripA, {}, pollId);
    await seedPoll(tripB, {}, pollId);
    const [specA, specB] = [await specOf(tripA, pollId), await specOf(tripB, pollId)];
    await closePoll(tripA, specA, OWNER, new Date());
    await closePoll(tripB, specB, OWNER, new Date());
    await reopenPoll(tripA, specA, TODAY);
    expect((await countsOf(tripA, specA)).closed).toBe(false);
    expect((await countsOf(tripB, specB)).closed).toBe(true);
  });

  it("will not reopen a poll whose closing date has passed, and leaves the close in place", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId, { closesAt: "2026-11-04" }));
    await closePoll(tripId, spec, OWNER, new Date());
    expect(await reopenPoll(tripId, spec, "2026-11-05")).toEqual({ ok: false, error: "date-passed" });
    // The day itself is still open, so there the reopen goes through.
    expect(await reopenPoll(tripId, spec, "2026-11-04")).toEqual({ ok: true });
    expect((await countsOf(tripId, spec)).closed).toBe(false);
  });

  it("closes on its own the day after its closing date", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId, { closesAt: "2026-11-04" }));
    expect(await castVote(tripId, "ann", spec, ["Ramen"], "2026-11-04")).toEqual({ ok: true });
    expect(await castVote(tripId, "ann", spec, ["Sushi"], "2026-11-05")).toEqual({ ok: false, error: "closed" });
    expect((await tallyFor(tripId, [spec], "2026-11-05")).get(spec.pollId)!.closed).toBe(true);
  });

  it("keeps a vote on an option whose label was renamed: options are stored with their own ids", async () => {
    const tripId = await seedTrip();
    const options = [{ id: "opt-a", label: "Ramen" }, { id: "opt-b", label: "Sushi" }];
    const spec = await specOf(tripId, await seedPoll(tripId, { options }));
    expect(await castVote(tripId, "ann", spec, ["opt-a"], TODAY)).toEqual({ ok: true });
    const renamed: PollSpec = { ...spec, options: [{ id: "opt-a", label: "Ramen bar" }, options[1]!] };
    expect((await countsOf(tripId, renamed)).counts).toEqual({ "opt-a": 1, "opt-b": 0 });
  });

  // The same poll id on two trips (a widget pasted across trips): each trip's
  // votes and its close are its own. Keyed by the poll alone, the second
  // trip's vote overwrote the first's row and its close was silently dropped.
  it("keeps one poll id apart on two trips: votes and closes are per trip", async () => {
    const [tripA, tripB] = [await seedTrip(), await seedTrip()];
    const pollId = randomUUID();
    await seedPoll(tripA, {}, pollId);
    await seedPoll(tripB, {}, pollId);
    const [specA, specB] = [await specOf(tripA, pollId), await specOf(tripB, pollId)];
    await castVote(tripA, "ann", specA, ["Ramen"], TODAY);
    await castVote(tripB, "ann", specB, ["Sushi"], TODAY);
    expect((await countsOf(tripA, specA)).counts).toEqual({ Ramen: 1, Sushi: 0, Tempura: 0 });
    expect((await countsOf(tripB, specB)).counts).toEqual({ Ramen: 0, Sushi: 1, Tempura: 0 });
    await closePoll(tripA, specA, OWNER, new Date());
    await closePoll(tripB, specB, OWNER, new Date());
    expect((await countsOf(tripB, specB)).closed).toBe(true);
    expect(await castVote(tripA, "bob", specA, ["Ramen"], TODAY)).toEqual({ ok: false, error: "closed" });
  });

  // `castVote` reads the closed state and then writes; a close landing between
  // the two must still refuse the vote, so the write itself is the check.
  it("writes no vote on a poll an editor has closed, whatever was read before", async () => {
    const tripId = await seedTrip();
    const spec = await specOf(tripId, await seedPoll(tripId));
    await closePoll(tripId, spec, OWNER, new Date());
    expect(await writeVote(tripId, "ann", spec, ["Ramen"])).toBe(false);
    expect((await countsOf(tripId, spec)).votes).toEqual([]);
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
