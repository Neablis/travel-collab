import { beforeEach, describe, expect, it, vi } from "vitest";

// Which reads each entry point makes; what they answer is the route's
// integration test.
const publicAuthor = vi.fn();
vi.mock("./playbooks", () => ({ publicAuthor: (...a: unknown[]) => publicAuthor(...a) }));
vi.mock("./savedDayPinBackfill", () => ({ schedulePinBackfill: () => false }));
vi.mock("./savedDays", () => ({
  readableSavedDay: async () => ({ savedDayId: "d-1", ownerId: "dev-alice" }),
  publishedAtOf: async () => null,
  moderationOf: async () => null,
}));
// The cover is read beside the day (M37 part 5), after the read seam.
const COVER = { unsplashId: "p-1" };
vi.mock("./savedDayCovers", () => ({ getSavedDayCover: async () => COVER }));

import { sharedDayRead, sharedDayView } from "./sharedDayView";

beforeEach(() => {
  publicAuthor.mockReset().mockResolvedValue({ userId: "dev-alice", displayName: "Alice C." });
});

describe("sharedDayRead", () => {
  it("never asks for the author, so the API's read cannot fail on it", async () => {
    publicAuthor.mockRejectedValue(new Error("aggregate failed"));
    const read = await sharedDayRead("d-1", null);
    expect(read).not.toHaveProperty("author");
    expect(publicAuthor).not.toHaveBeenCalled();
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
