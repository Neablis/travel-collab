import { describe, expect, it } from "vitest";
import { TripRole, type TripMember } from "@tc/contracts";
import { boardMode, canEditNotebook, viewerOwnsTrip } from "./tripRole";

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

// W8 (docs/specs/2026-10-03-suggester-role-design.md). Every role `TripRole`
// names is a row, so a fifth role fails here until somebody decides its answer
// — `satisfies Record<TripRole, …>` makes the compiler say so first.
describe("boardMode", () => {
  const expected = {
    viewer: "read",
    suggester: "suggest",
    editor: "write",
    owner: "write",
  } satisfies Record<TripRole, ReturnType<typeof boardMode>>;

  it.each(TripRole.options)("answers %s from the table", (role) => {
    expect(boardMode(role)).toBe(expected[role]);
  });

  // Closed, not open: no role is no permission. The callers that keep a board
  // live through a FAILED access read decide that themselves (TripProvider),
  // because it is a judgement about the read, not about a role.
  it("reads when there is no role", () => {
    expect(boardMode(null)).toBe("read");
    expect(boardMode(undefined)).toBe("read");
  });
});

describe("canEditNotebook", () => {
  // Spec §2.2: the notebook stays read-only for a suggester, exactly as for a
  // viewer. Suggesting is the board's alone.
  const expected = {
    viewer: false,
    suggester: false,
    editor: true,
    owner: true,
  } satisfies Record<TripRole, boolean>;

  it.each(TripRole.options)("answers %s from the table", (role) => {
    expect(canEditNotebook(role)).toBe(expected[role]);
  });

  it("is false when there is no role", () => {
    expect(canEditNotebook(null)).toBe(false);
    expect(canEditNotebook(undefined)).toBe(false);
  });
});
