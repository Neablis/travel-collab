import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { acceptInvite, createInvite, revokeInvite } from "@/server/access/invites";
import { mintReferralCode } from "@/server/entitlements/referrals";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { inviteCardKey, referralCardKey } from "@/server/cache/keys";
import type { RedisClient } from "@/server/cache/redis";

// The link-preview cards' Redis cache (ADR-059), against the real lookups and
// the real revoke/accept paths. The process cache is swapped for a counting
// fake, so what is asserted is exactly the commands the free tier would pay.

// Hoisted, because `vi.mock` is: the static imports above load
// `access/invites`, which loads the cache module, before this file's body runs.
const { store, calls, fake } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const calls = { get: 0, set: 0, del: 0 };
  const fake = {
    get: async <T,>(key: string): Promise<T | null> => {
      calls.get += 1;
      return (store.get(key) as T | undefined) ?? null;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      calls.set += 1;
      store.set(key, value);
    },
    del: async (key: string): Promise<void> => {
      calls.del += 1;
      store.delete(key);
    },
  };
  return { store, calls, fake };
});

vi.mock("@/server/cache/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cache/redis")>();
  return { ...actual, getCache: () => fake };
});

const { inviteCardFor } = await import("./invite");
const { referrerFirstNameFor } = await import("./referral");
const { createRedisCache } = await import("@/server/cache/redis");

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-cache-owner-${run}`;
const GUEST = `dev-og-cache-guest-${run}`;

async function pendingInvite(): Promise<{ tripId: string; inviteId: string; token: string }> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto in spring" }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  for (const command of commandsFor("threeDayTrip", tripId, { startDate: "2027-06-01" })) {
    if (!(await executeTripCommand(command, OWNER)).ok) throw new Error(`failed to seed ${command.type}`);
  }
  const { inviteId, token } = await createInvite(tripId, OWNER, { email: null, role: "editor" });
  return { tripId, inviteId, token };
}

beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await db.update(users).set({ name: "Dana Reyes" }).where(eq(users.id, OWNER));
  await upsertUser({ id: GUEST, name: "Mei Tanaka", email: null, image: null });
});

beforeEach(() => {
  store.clear();
  calls.get = 0;
  calls.set = 0;
  calls.del = 0;
});

describe("the invite card cache", () => {
  it("answers a hit from the cache without asking the database", async () => {
    // A token the database has never seen: only the cache can make it personal.
    const token = `cached-only-${run}`;
    const card = { kind: "personal", inviterFirstName: "Cached", tripName: "From Redis" };
    store.set(inviteCardKey(token), card);

    expect(await inviteCardFor(token)).toEqual(card);
    expect(calls).toEqual({ get: 1, set: 0, del: 0 });
  });

  it("writes a personal card once, then serves it", async () => {
    const { token } = await pendingInvite();

    const first = await inviteCardFor(token);
    const second = await inviteCardFor(token);

    expect(first).toMatchObject({ kind: "personal", inviterFirstName: "Dana" });
    expect(second).toEqual(first);
    expect(calls).toEqual({ get: 2, set: 1, del: 0 });
  });

  it("writes nothing for a generic answer", async () => {
    const { tripId, inviteId, token } = await pendingInvite();
    await revokeInvite(tripId, inviteId);
    calls.del = 0;

    expect(await inviteCardFor(token)).toEqual({ kind: "generic" });
    expect(await inviteCardFor(`junk-${run}`)).toEqual({ kind: "generic" });
    expect(calls.set).toBe(0);
    expect(store.size).toBe(0);
  });

  it("forgets a card when its invite is revoked", async () => {
    const { tripId, inviteId, token } = await pendingInvite();
    await inviteCardFor(token);
    expect(store.has(inviteCardKey(token))).toBe(true);
    // The token is a credential; what lands in the shared store is its digest.
    expect([...store.keys()].some((key) => key.includes(token))).toBe(false);

    expect((await revokeInvite(tripId, inviteId)).ok).toBe(true);

    expect(store.has(inviteCardKey(token))).toBe(false);
    expect(await inviteCardFor(token)).toEqual({ kind: "generic" });
  });

  it("forgets a card when its invite is accepted", async () => {
    const { token } = await pendingInvite();
    await inviteCardFor(token);

    expect((await acceptInvite(token, GUEST)).ok).toBe(true);

    expect(store.has(inviteCardKey(token))).toBe(false);
    expect(await inviteCardFor(token)).toEqual({ kind: "generic" });
  });

  it("still returns the card when Redis throws on every call", async () => {
    const { token } = await pendingInvite();
    const broken: RedisClient = {
      get: async () => {
        throw new Error("ECONNRESET");
      },
      set: async () => {
        throw new Error("ECONNRESET");
      },
      del: async () => {
        throw new Error("ECONNRESET");
      },
    };

    expect(await inviteCardFor(token, createRedisCache(broken))).toMatchObject({
      kind: "personal",
      inviterFirstName: "Dana",
    });
  });
});

describe("the referral card cache", () => {
  it("writes a named referrer, then serves it; writes nothing for an unknown code", async () => {
    const minted = await mintReferralCode(OWNER);
    if (!minted.ok) throw new Error(minted.reason);

    expect(await referrerFirstNameFor(minted.code)).toBe("Dana");
    expect(await referrerFirstNameFor(minted.code)).toBe("Dana");
    expect(await referrerFirstNameFor(`NOPE${run}`)).toBeNull();

    expect(calls).toEqual({ get: 3, set: 1, del: 0 });
    expect(store.get(referralCardKey(minted.code))).toEqual({ firstName: "Dana" });
  });
});
