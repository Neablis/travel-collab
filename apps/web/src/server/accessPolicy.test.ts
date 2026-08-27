import { describe, expect, it } from "vitest";
import { TripCommand, type TripMember, type TripRole } from "@tc/contracts";
import { memberRolePolicy } from "./accessPolicy";

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
