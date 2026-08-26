import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidFrom } from "./ids";
import { tripDetailFactory } from "./trip";

const UUID = z.string().uuid();

const groupLengths = (id: string) => id.split("-").map((g) => g.length);

// The pre-KI-38 implementation, verbatim, so the "masking is the identity
// inside the budget" claim is checked against the real thing rather than
// asserted in prose. Only used where its own output was already well-formed.
function legacyUuidFrom(sequence: number, salt = 0): string {
  const hex = (n: number, len: number) => (n >>> 0).toString(16).padStart(len, "0");
  const a = hex(sequence * 2654435761 + salt, 8);
  const b = hex(sequence + salt * 97, 4);
  const c = `4${hex(sequence, 4).slice(1)}`;
  const d = `a${hex(salt, 4).slice(1)}`;
  const e = hex(sequence * 40503 + salt * 2246822519, 8) + hex(salt + sequence, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}

describe("uuidFrom", () => {
  // KI-38's two named witnesses. Both used to come back with an over-wide
  // group -- right dash positions, wrong group lengths -- and no error.
  it.each([
    { label: "salt overflows group b (tripDetailFactory's activity salts)", sequence: 1, salt: 1000 },
    { label: "salt overflows group b (tripDetailFactory's backlog salts)", sequence: 1, salt: 5000 },
    { label: "sequence itself reaches 0x10000", sequence: 65536, salt: 0 },
  ])("KI-38: $label -> a well-formed v4 UUID", ({ sequence, salt }) => {
    const id = uuidFrom(sequence, salt);
    expect(groupLengths(id)).toEqual([8, 4, 4, 4, 12]);
    expect(UUID.safeParse(id).success).toBe(true);
  });

  it("stays a well-formed v4 UUID across and well past every group's budget", () => {
    const sequences = [0, 1, 2, 675, 676, 65535, 65536, 65537, 1_000_000, 4_294_967_296];
    const salts = [0, 1, 99, 100, 675, 676, 1000, 5000, 65535, 65536, 70_000, 1_000_000];
    for (const sequence of sequences) {
      for (const salt of salts) {
        const id = uuidFrom(sequence, salt);
        expect(groupLengths(id), `uuidFrom(${sequence}, ${salt}) = ${id}`).toEqual([8, 4, 4, 4, 12]);
        expect(UUID.safeParse(id).success, `uuidFrom(${sequence}, ${salt}) = ${id}`).toBe(true);
        expect(id[14], `version nibble of ${id}`).toBe("4");
        expect(id[19], `variant nibble of ${id}`).toBe("a");
      }
    }
  });

  it("leaves every id that was already well-formed byte-identical", () => {
    // AGENTS.md: a property whose precondition filters every case still
    // reports OK, so count the assertions and assert a floor. This is the
    // only test in this file with a `continue`, so it is the only one that
    // can silently empty out. Floor MEASURED, not guessed: all 60,501
    // (sequence 0..200) x (salt 0..300) pairs are in budget today
    // (max `salt * 97` here is 29,100, well under 0x10000), so the floor
    // sits near half the observed count per AGENTS.md's own guidance. The
    // old floor of 1,000 was 1.7% of observed - low enough that the
    // precondition could start rejecting 95% of pairs and still pass.
    let witness = 0;
    for (let sequence = 0; sequence <= 200; sequence++) {
      for (let salt = 0; salt <= 300; salt++) {
        const legacy = legacyUuidFrom(sequence, salt);
        // Only the in-budget region: outside it the legacy output is the bug.
        if (!UUID.safeParse(legacy).success) continue;
        witness++;
        expect(uuidFrom(sequence, salt), `uuidFrom(${sequence}, ${salt})`).toBe(legacy);
      }
    }
    expect(witness).toBeGreaterThan(30_000);
  });

  it("is deterministic and collision-free over a realistic factory grid", () => {
    const seen = new Map<string, string>();
    for (let sequence = 1; sequence <= 60; sequence++) {
      for (const salt of [0, ...range(100, 130), ...range(1000, 1100), ...range(5000, 5040)]) {
        const id = uuidFrom(sequence, salt);
        expect(uuidFrom(sequence, salt)).toBe(id);
        const key = `${sequence}/${salt}`;
        expect(seen.get(id) ?? key, `collision on ${id}`).toBe(key);
        seen.set(id, key);
      }
    }
  });

  it("throws instead of silently mapping nonsense onto a real-looking id", () => {
    expect(() => uuidFrom(-1)).toThrow(RangeError);
    expect(() => uuidFrom(Number.NaN)).toThrow(RangeError);
    expect(() => uuidFrom(1.5)).toThrow(RangeError);
    expect(() => uuidFrom(1, -1)).toThrow(RangeError);
    expect(() => uuidFrom(1, Number.NaN)).toThrow(RangeError);
    expect(() => uuidFrom(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

// KI-38's entry called this a latent trap "not a live bug in any current
// test". It was not latent: trip.ts salts activities from 1000 and the
// backlog from 5000, and `salt * 97` clears 0x10000 at sequence 1, so every
// activity and backlog id this factory produced was a non-UUID. Contracts
// declare all four of these `z.string().uuid()` (packages/contracts detail.ts).
describe("tripDetailFactory ids satisfy the contracts' uuid shape", () => {
  it("mints valid UUIDs for tripId, dayIds, activityIds and backlog", () => {
    for (let i = 0; i < 5; i++) {
      const trip = tripDetailFactory.build(
        {},
        { transient: { dayCount: 3, activitiesPerDay: 12, unscheduledCount: 6 } },
      );
      const ids = [
        trip.tripId,
        ...trip.days.map((day) => day.dayId),
        ...trip.days.flatMap((day) => day.activityIds),
        ...trip.backlog,
      ];
      expect(ids.filter((id) => !UUID.safeParse(id).success)).toEqual([]);
      expect(Object.keys(trip.activities).filter((id) => !UUID.safeParse(id).success)).toEqual([]);
      // The salt scheme is also supposed to keep every id in a trip distinct;
      // masking a group is where that could quietly stop being true.
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
