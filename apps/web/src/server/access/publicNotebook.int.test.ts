import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newPageDoc, type PageNode } from "@tc/contracts";
import { executeTripCommand } from "../commands";
import { executePageCommand } from "../pageCommands";
import { getPage } from "../pages";
import { getTripDetail } from "../projections";
import { castVote, pollOnTrip } from "../polls/votes";
import { publicViewOf } from "./publicNotebook";

// The one place a stranger's poll counts are assembled (M58 decision 8):
// `publicViewOf` reads the shown polls' tallies and hands the page counts. The
// view's own unit test passes the tallies in by hand, so a wrong key or a
// missing trip filter here would show only in the browser.

const OWNER = `pubnb-owner-${randomUUID().slice(0, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

async function seedTripWithPoll(pollId: string, hideWhenPublic = false) {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Public poll" }, OWNER)).ok).toBe(true);
  const pageId = randomUUID();
  const options = [{ id: "r", label: "Ramen" }, { id: "s", label: "Sushi" }];
  const poll = { type: "macro", attrs: { name: "poll", ...(hideWhenPublic ? { hideWhenPublic: true } : {}), params: { pollId, question: "Where to eat?", options } } };
  const paragraph = { type: "paragraph", content: [poll] };
  const created = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc([paragraph as unknown as PageNode]) },
    OWNER,
  );
  expect(created.ok).toBe(true);
  return { tripId, pageId };
}

async function publicPollBlock(tripId: string, pageId: string) {
  const [trip, page] = [await getTripDetail(tripId), await getPage(pageId)];
  const view = await publicViewOf(trip!, page!);
  const paragraph = view.content[0] as unknown as { content: readonly { attrs: { outcome: unknown } }[] };
  return paragraph.content[0]!.attrs.outcome;
}

describe("publicViewOf, a poll", () => {
  it("hands a stranger this trip's counts for the poll, and none from another trip using its id", async () => {
    const pollId = randomUUID();
    const [mine, other] = [await seedTripWithPoll(pollId), await seedTripWithPoll(pollId)];
    for (const [tripId, user, option] of [[mine.tripId, "ann", "r"], [mine.tripId, "bob", "r"], [other.tripId, "cat", "s"]] as const) {
      const spec = (await pollOnTrip(tripId, pollId))!;
      expect(await castVote(tripId, user, spec, [option], TODAY)).toEqual({ ok: true });
    }
    expect(await publicPollBlock(mine.tripId, mine.pageId)).toMatchObject({
      status: "ok",
      rendered: { block: { kind: "poll", pollId: null, counts: { r: 2, s: 0 }, closed: false } },
    });
  });

  it("reads no tally for a poll hidden from the public page", async () => {
    const pollId = randomUUID();
    const hidden = await seedTripWithPoll(pollId, true);
    await castVote(hidden.tripId, "ann", (await pollOnTrip(hidden.tripId, pollId))!, ["r"], TODAY);
    expect(await publicPollBlock(hidden.tripId, hidden.pageId)).toEqual({ status: "not-shared" });
  });
});
