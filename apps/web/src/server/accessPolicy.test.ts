import { describe, expect, it } from "vitest";
import { TripCommand, type TripMember, type TripRole } from "@tc/contracts";
import { hasAtLeast, memberRole, memberRolePolicy } from "./accessPolicy";

const ALL_COMMAND_TYPES = TripCommand.options.map((o) => o.shape.type.value);
const NON_CREATE = ALL_COMMAND_TYPES.filter((t) => t !== "CreateTrip");

const as = (role: TripRole): TripMember[] => [{ userId: "u1", role }];
const can = (role: TripRole, type: (typeof ALL_COMMAND_TYPES)[number]) =>
  memberRolePolicy.canExecute("u1", type, as(role));

describe("memberRolePolicy", () => {
  it("lets any authenticated actor create a trip, member of nothing", () => {
    expect(memberRolePolicy.canExecute("u1", "CreateTrip", null)).toBe(true);
    expect(memberRolePolicy.canExecute("u1", "CreateTrip", [])).toBe(true);
  });

  it("refuses every command to a non-member, whatever the members' roles", () => {
    for (const type of NON_CREATE) {
      expect(memberRolePolicy.canExecute("stranger", type, as("owner"))).toBe(false);
      expect(memberRolePolicy.canExecute("stranger", type, null)).toBe(false);
    }
  });

  it("lets an owner execute every command", () => {
    for (const type of NON_CREATE) expect(can("owner", type)).toBe(true);
  });

  // Read-only falls out of the table having no "viewer" minimum rather than
  // out of a special case — this is what would go quietly wrong if a future
  // command were added with the wrong minimum.
  it("refuses every command to a viewer", () => {
    for (const type of NON_CREATE) expect(can("viewer", type)).toBe(false);
  });

  it("lets an editor plan the trip but not delete or restore it", () => {
    expect(can("editor", "AddDay")).toBe(true);
    expect(can("editor", "AddActivity")).toBe(true);
    expect(can("editor", "SetTripName")).toBe(true);
    expect(can("editor", "SetTripBudget")).toBe(true);
    expect(can("editor", "UndoLastChange")).toBe(true);
    expect(can("editor", "RevertToState")).toBe(true);
    expect(can("editor", "DeleteTrip")).toBe(false);
    expect(can("editor", "RestoreTrip")).toBe(false);
  });

  it("covers every TripCommand — a new command cannot default to permitted", () => {
    // The Record<Exclude<TripCommand["type"], "CreateTrip">, TripRole> type
    // makes this a compile-time guarantee; asserted at runtime too so the
    // omission of a command from the union (not just from the table) is also
    // caught. Every command must be refused to SOMEONE and allowed to the owner.
    for (const type of NON_CREATE) {
      expect(can("owner", type)).toBe(true);
      expect(can("viewer", type)).toBe(false);
    }
    expect(NON_CREATE.length).toBeGreaterThan(10);
  });

  it("resolves the acting member, not the first one", () => {
    const members: TripMember[] = [
      { userId: "owner-1", role: "owner" },
      { userId: "viewer-1", role: "viewer" },
    ];
    expect(memberRolePolicy.canExecute("viewer-1", "AddDay", members)).toBe(false);
    expect(memberRolePolicy.canExecute("owner-1", "AddDay", members)).toBe(true);
  });
});

// The read/CRUD half of the seam (M11 link 3). `canExecute` answers for
// planning commands; everything else — reading a trip, writing a Notebook
// page, driving the assistant, managing invites — asks `hasAtLeast`.
describe("hasAtLeast", () => {
  it("is false for a non-member at every minimum", () => {
    for (const minimum of ["viewer", "editor", "owner"] as const) {
      expect(hasAtLeast("stranger", as("owner"), minimum)).toBe(false);
      expect(hasAtLeast("stranger", null, minimum)).toBe(false);
      expect(hasAtLeast("stranger", [], minimum)).toBe(false);
    }
  });

  it("ranks viewer < editor < owner", () => {
    expect(hasAtLeast("u1", as("viewer"), "viewer")).toBe(true);
    expect(hasAtLeast("u1", as("viewer"), "editor")).toBe(false);
    expect(hasAtLeast("u1", as("viewer"), "owner")).toBe(false);

    expect(hasAtLeast("u1", as("editor"), "viewer")).toBe(true);
    expect(hasAtLeast("u1", as("editor"), "editor")).toBe(true);
    expect(hasAtLeast("u1", as("editor"), "owner")).toBe(false);

    for (const minimum of ["viewer", "editor", "owner"] as const) {
      expect(hasAtLeast("u1", as("owner"), minimum)).toBe(true);
    }
  });

  // The specific hole M11 link 3 was told to close before issuing any viewer
  // invite: pages-guard's `guard()` checked membership with NO role and fronts
  // both the page-write routes and the AI handler.
  it("refuses a viewer the editor rank the page writes and the assistant need", () => {
    expect(hasAtLeast("u1", as("viewer"), "editor")).toBe(false);
  });

  // canExecute is now literally `hasAtLeast(actor, members, MINIMUM_ROLE[t])`,
  // so this pins the two to the same ranking from the outside: the stream-level
  // commands need `owner`, everything else needs `editor`, and nothing needs
  // only `viewer`.
  it("agrees with canExecute on every command, for every role", () => {
    const OWNER_ONLY = new Set(["DeleteTrip", "RestoreTrip"]);
    for (const role of ["viewer", "editor", "owner"] as const) {
      for (const type of NON_CREATE) {
        expect(memberRolePolicy.canExecute("u1", type, as(role))).toBe(
          hasAtLeast("u1", as(role), OWNER_ONLY.has(type) ? "owner" : "editor"),
        );
      }
    }
  });
});

describe("memberRole", () => {
  it("returns the role, or null for a non-member", () => {
    expect(memberRole("u1", as("editor"))).toBe("editor");
    expect(memberRole("stranger", as("editor"))).toBeNull();
    expect(memberRole("u1", null)).toBeNull();
  });
});
