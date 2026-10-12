import { beforeEach, describe, expect, it, vi } from "vitest";

// Which reads each entry point makes; what they answer is the route's
// integration test.
const publicAuthor = vi.fn();
vi.mock("./playbooks", () => ({ publicAuthor: (...a: unknown[]) => publicAuthor(...a) }));
// Three sights and a meal that is also one: enough to say what kind of day.
const STOPS = [...Array.from({ length: 3 }, () => ({ kind: "planned", tags: ["sight"] })), { kind: "planned", tags: ["meal", "sight"] }];
vi.mock("./savedDayPinBackfill", () => ({ schedulePinBackfill: () => false }));
// Published and unmoderated unless a test says otherwise.
let visibility = "public";
let moderation: { moderatedAt: string; moderationNote: string | null } | null = null;
vi.mock("./savedDays", () => ({
  readableSavedDay: async () => ({ savedDayId: "d-1", ownerId: "dev-alice", stops: STOPS, visibility }),
  publishedAtOf: async () => null,
  moderationOf: async () => moderation,
}));
// The cover is read beside the day (M37 part 5), after the read seam.
const COVER = { unsplashId: "p-1" };
vi.mock("./savedDayCovers", () => ({ getSavedDayCover: async () => COVER }));

import { sharedDayRead, sharedDayView } from "./sharedDayView";

beforeEach(() => {
  visibility = "public";
  moderation = null;
  publicAuthor.mockReset().mockResolvedValue({ userId: "dev-alice", displayName: "Alice C." });
});

describe("sharedDayRead", () => {
  it("never asks for the author, so the API's read cannot fail on it", async () => {
    publicAuthor.mockRejectedValue(new Error("aggregate failed"));
    const read = await sharedDayRead("d-1", null);
    expect(read).not.toHaveProperty("author");
    expect(publicAuthor).not.toHaveBeenCalled();
  });

  // M42 D9: the page and the API's re-read both come through here, so the
  // screen says the same thing on its first paint and after it reads again.
  // M42 part 5: only the tags the description names are pages this day is on.
  it("says what kind of day it is, from the stops, the tags it carries and the ones it names", async () => {
    const read = await sharedDayRead("d-1", null);
    expect([read?.description, read?.tags, read?.namedTags]).toEqual(["Sightseeing", ["sight", "meal"], ["sight"]]);
  });

  // Tag pages list published days only: a private day, read by its author,
  // is described but on no tag page, so none of its chips may link to one.
  it("names no tag on a private day", async () => {
    visibility = "private";
    const read = await sharedDayRead("d-1", "dev-alice");
    expect([read?.description, read?.namedTags]).toEqual(["Sightseeing", []]);
  });

  // An operator's hide takes a public day off the library, and so off every
  // tag page: its author still reads it, described, with no chip linking out.
  it("names no tag on a public day an operator has hidden", async () => {
    moderation = { moderatedAt: "2026-10-11T09:00:00.000Z", moderationNote: "spam" };
    const read = await sharedDayRead("d-1", "dev-alice");
    expect([read?.description, read?.namedTags]).toEqual(["Sightseeing", []]);
  });
});

describe("sharedDayView", () => {
  it("is the read plus the author's public numbers", async () => {
    const view = await sharedDayView("d-1", null);
    expect(publicAuthor).toHaveBeenCalledWith("dev-alice");
    expect(view?.author).toEqual({ userId: "dev-alice", displayName: "Alice C." });
    expect(view?.cover).toBe(COVER);
  });
});
