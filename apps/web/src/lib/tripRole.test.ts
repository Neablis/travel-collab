import { describe, expect, it } from "vitest";
import type { TripMember } from "@tc/contracts";
import { viewerOwnsTrip } from "./tripRole";

const owner: TripMember = { userId: "alice", role: "owner" };
const editor: TripMember = { userId: "bob", role: "editor" };
const viewer: TripMember = { userId: "carol", role: "viewer" };

describe("viewerOwnsTrip", () => {
  it("is true only for the member whose own role is owner", () => {
    expect(viewerOwnsTrip([owner, editor, viewer], "alice")).toBe(true);
    expect(viewerOwnsTrip([owner, editor, viewer], "bob")).toBe(false);
    expect(viewerOwnsTrip([owner, editor, viewer], "carol")).toBe(false);
  });

  it("is false for somebody who is not on the trip at all", () => {
    expect(viewerOwnsTrip([owner], "dave")).toBe(false);
  });

  // The session probe is async, so every caller sees `undefined` first. The
  // milder verb is the right answer there: a wrong *Leave* on your own trip is
  // a refused request, where a wrong *Delete* would read as the app not
  // knowing whose trip it is.
  it("is false while the reader is still unknown", () => {
    expect(viewerOwnsTrip([owner], undefined)).toBe(false);
    expect(viewerOwnsTrip([owner], null)).toBe(false);
    expect(viewerOwnsTrip([owner], "")).toBe(false);
  });
});
