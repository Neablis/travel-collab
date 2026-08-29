import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TripMember } from "@tc/contracts";
import { db } from "../db/client";
import { tripSummaries } from "../db/schema";
import { grantedMembersByTrip, hasMembershipRow, mergeMembers } from "./members";

// `mergeMembers` is the whole reason M11 link 3 needed no planning event: it
// is where the log's owner and the Access module's accepted invites become one
// list, and it is pure, so it gets exhaustive tests rather than an integration
// round trip.

const owner: TripMember = { userId: "dev-alice", role: "owner" };

describe("mergeMembers", () => {
  it("returns the projection's members when nothing is granted", () => {
    expect(mergeMembers([owner], [])).toEqual([owner]);
  });

  it("appends granted members after the projected ones", () => {
    const granted: TripMember[] = [
      { userId: "dev-bob", role: "editor" },
      { userId: "dev-cara", role: "viewer" },
    ];
    expect(mergeMembers([owner], granted)).toEqual([owner, ...granted]);
  });

  it("keeps the owner first, which is what detail.members[0] means to the UI", () => {
    const granted: TripMember[] = [{ userId: "dev-bob", role: "editor" }];
    expect(mergeMembers([owner], granted)[0]).toEqual(owner);
  });

  // The one failure mode here that cannot be undone through the UI: a stray
  // grant row demoting the person who owns the trip.
  it("never demotes a member — the higher rank wins on a duplicate userId", () => {
    const merged = mergeMembers([owner], [{ userId: "dev-alice", role: "viewer" }]);
    expect(merged).toEqual([owner]);
  });

  it("promotes when the grant outranks the projection", () => {
    const merged = mergeMembers(
      [{ userId: "dev-bob", role: "viewer" }],
      [{ userId: "dev-bob", role: "editor" }],
    );
    expect(merged).toEqual([{ userId: "dev-bob", role: "editor" }]);
  });

  it("de-duplicates repeated grants for the same person", () => {
    const merged = mergeMembers(
      [owner],
      [
        { userId: "dev-bob", role: "viewer" },
        { userId: "dev-bob", role: "editor" },
      ],
    );
    expect(merged).toEqual([owner, { userId: "dev-bob", role: "editor" }]);
  });

  it("survives an empty projection (a stream that does not exist yet)", () => {
    expect(mergeMembers([], [{ userId: "dev-bob", role: "editor" }])).toEqual([
      { userId: "dev-bob", role: "editor" },
    ]);
  });
});

const arbMember = fc.record({
  userId: fc.constantFrom("a", "b", "c", "d"),
  role: fc.constantFrom("viewer" as const, "editor" as const, "owner" as const),
});

describe("mergeMembers — properties", () => {
  it("every userId on either side appears exactly once in the result", () => {
    let witness = 0;
    fc.assert(
      fc.property(fc.array(arbMember), fc.array(arbMember), (projected, granted) => {
        const merged = mergeMembers(projected, granted);
        const ids = merged.map((m) => m.userId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(ids)).toEqual(
          new Set([...projected, ...granted].map((m) => m.userId)),
        );
        witness += 1;
      }),
      { numRuns: 200 },
    );
    // Measured floor: the property asserts on every generated case, so the
    // observed minimum is numRuns itself; half of it is the floor (AGENTS.md
    // "measure the floor, don't guess it").
    expect(witness).toBeGreaterThanOrEqual(100);
  });

  it("nobody ends up ranked below their best claim on either side", () => {
    const rank = { viewer: 0, editor: 1, owner: 2 } as const;
    let witness = 0;
    fc.assert(
      fc.property(fc.array(arbMember), fc.array(arbMember), (projected, granted) => {
        const merged = mergeMembers(projected, granted);
        for (const claim of [...projected, ...granted]) {
          const got = merged.find((m) => m.userId === claim.userId)!;
          expect(rank[got.role]).toBeGreaterThanOrEqual(rank[claim.role]);
          witness += 1;
        }
      }),
      { numRuns: 200 },
    );
    // Measured, not guessed: 12 runs of this exact property observed
    // 1823-1968 assertions (the count varies with generated array lengths).
    // Floor at ~half the observed minimum.
    expect(witness).toBeGreaterThanOrEqual(900);
  });
});

// `hasMembershipRow` is the half of the home grid's visibility predicate that
// the Access module owns. Building the SQL opens no connection, so its shape
// is pinned here rather than in the integration suite — what the integration
// suite proves is the behaviour, which is the point; this pins the *reason*
// the behaviour holds, which is the comment on the function.
describe("hasMembershipRow", () => {
  const render = (userId: string) =>
    db.select().from(tripSummaries).where(hasMembershipRow(tripSummaries.tripId, userId)).toSQL();

  it("is a correlated EXISTS over trip_memberships, not a join", () => {
    const { sql } = render("dev-bob");
    expect(sql).toContain("exists");
    expect(sql).toContain('"trip_memberships"');
    // A join would put trip_memberships in the FROM list, which is exactly the
    // shape that drops owner-only trips.
    expect(sql).not.toContain("join");
    expect(sql.slice(sql.indexOf("from"), sql.indexOf("where"))).not.toContain("trip_memberships");
  });

  it("parameterises the user id rather than interpolating it", () => {
    const { sql, params } = render("dev'; drop table trip_memberships; --");
    expect(params).toContain("dev'; drop table trip_memberships; --");
    expect(sql).not.toContain("drop table");
  });
});

describe("grantedMembersByTrip", () => {
  // `inArray` with an empty list is not a query worth sending, and drizzle's
  // rendering of it is not something to rely on. The home grid hits this every
  // time a brand-new user loads it.
  it("returns an empty map without touching the database for no trips", async () => {
    const forbidden = {
      select: () => {
        throw new Error("grantedMembersByTrip queried for an empty id list");
      },
    } as never;
    expect(await grantedMembersByTrip(forbidden, [])).toEqual(new Map());
  });
});
