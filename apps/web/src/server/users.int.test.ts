import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { users } from "./db/schema";
import { events } from "./db/schema";
import { recordSignIn, upsertUser } from "./users";
import { getTripDetail } from "./projections";

// No beforeEach truncation: every test mints its own id, same isolation
// strategy as the sibling suites (see eventStore.int.test.ts and
// docs/testing-baseline.md).
const signInId = () => `dev-${randomUUID()}`;

async function readUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

describe("users repository", () => {
  it("creates a durable row for a first-time sign-in", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana", image: "https://img.test/a.png" }, "2026-08-27T10:00:00.000Z");

    expect(await readUser(id)).toEqual({
      id,
      email: "ana@example.com",
      name: "Ana",
      image: "https://img.test/a.png",
      createdAt: "2026-08-27 10:00:00+00",
      updatedAt: "2026-08-27 10:00:00+00",
    });
  });

  it("refreshes the profile on a later sign-in without minting a second row or moving createdAt", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana", image: null }, "2026-08-27T10:00:00.000Z");
    await upsertUser({ id, email: "ana@example.com", name: "Ana Lee", image: "https://img.test/new.png" }, "2026-09-01T09:30:00.000Z");

    const row = await readUser(id);
    expect(row).toMatchObject({
      name: "Ana Lee",
      image: "https://img.test/new.png",
      createdAt: "2026-08-27 10:00:00+00",
      updatedAt: "2026-09-01 09:30:00+00",
    });
    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
  });

  it("clears a profile field the provider no longer sends (last sign-in wins)", async () => {
    const id = signInId();
    await upsertUser({ id, email: "b@example.com", name: "B", image: "https://img.test/b.png" });
    await upsertUser({ id, email: "b@example.com", name: "B", image: null });

    expect((await readUser(id))?.image).toBeNull();
  });
});

describe("recordSignIn (the Auth.js signIn callback)", () => {
  it("admits a sign-in and leaves the user durable behind it", async () => {
    const id = signInId();
    await expect(recordSignIn({ user: { id, name: "  Alice  ", email: "ALICE@Example.com" } })).resolves.toBe(true);

    expect(await readUser(id)).toMatchObject({ id, name: "Alice", email: "alice@example.com" });
  });

  it("is idempotent across repeated sign-ins, which is the normal case", async () => {
    const id = signInId();
    await recordSignIn({ user: { id, name: "Alice" } });
    await recordSignIn({ user: { id, name: "Alice" } });

    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
  });

  it("refuses a payload with no usable id rather than creating an anonymous row", async () => {
    await expect(recordSignIn({ user: { id: "  ", name: "Nobody" } })).resolves.toBe(false);
    await expect(recordSignIn({ user: null })).resolves.toBe(false);
  });
});

// The wiring claim the schema comment on `events.actor_id` makes, end to end:
// there is no foreign key, so what makes an actor id refer to a user row is
// that sign-in is the only place a session id comes from and it writes the row
// first. This drives that order and checks both ends of it.
describe("actorId refers to a user row (ADR-025)", () => {
  it("every actor id a signed-in session can produce already has a users row behind it", async () => {
    const id = signInId();
    await recordSignIn({ user: { id, name: "Ana", email: "ana@example.com" } });

    const tripId = randomUUID();
    const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, id);
    expect(result.ok).toBe(true);

    const [event] = await db.select().from(events).where(eq(events.streamId, tripId));
    expect(event?.actorId).toBe(id);
    expect(await readUser(event!.actorId)).not.toBeNull();

    // …and the same string is what the trip's member list carries, so a member
    // is resolvable to a person without widening TripMember (link 2's job).
    const detail = await getTripDetail(tripId);
    expect(detail?.members.map((m) => m.userId)).toEqual([id]);
    expect(await readUser(detail!.members[0]!.userId)).not.toBeNull();
  });

  it("does not pretend the reserved 'system' actor is a person", async () => {
    // pages.ts writes actor_id 'system' for lazily seeded default pages. It is
    // deliberately not a users row — this is the reason there is no FK, and it
    // is asserted here so a future FK cannot be added without seeing it fail.
    expect(await readUser("system")).toBeNull();
  });
});
