// **Scoped account API tokens** (M22 Phase 1), against a real database.
//
// Four things this file exists to prove, in the order they would hurt:
// hashing (a stolen table is not a stolen credential), the revocation race,
// resolve-on-read (no job, no sweep), and that a LAPSE DISABLES WITHOUT
// REVOKING — so re-entitling restores every integration with zero writes.
//
// **None of it needs Stripe or a deploy.** An entitlement here comes from an
// admin grant, which is account state; that is what M20 built the grant path
// for, and it is why a tier gate in this repo is provable in CI rather than by
// watching production once.
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiTokens } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { allGrantsFor, issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { accountCan } from "@/server/entitlements/resolver";
import {
  API_TOKEN_MAX_LIFETIME_DAYS,
  ApiTokenPepperMissingError,
  expiredTokensFor,
  listTokens,
  mintToken,
  revokeToken,
  touchLastUsed,
  verifyToken,
} from "./index";

const newUser = () => `dev-${randomUUID()}`;

/** An account holding nothing. `free` grants no `api.tokens`. */
async function freeAccount(): Promise<string> {
  const id = newUser();
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

/**
 * An account that may mint tokens — **by grant, not by purchase.**
 *
 * `issueGrant` pins `livePlanVersion("premium")`, which is `premium@v2`, the
 * version M22 published to carry `api.tokens`. No Stripe, no checkout, no
 * subscription row: an operator action against a UI M20 already shipped.
 */
async function entitledAccount(): Promise<string> {
  const id = await freeAccount();
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 test fixture.",
    expiresAt: null,
  });
  return id;
}

const input = (over: Partial<Parameters<typeof mintToken>[1]> = {}) => ({
  name: "Calendar sync",
  scopes: ["trips:read" as const],
  tripIds: null,
  expiresInDays: 90,
  ...over,
});

describe("the entitlement gates both minting and using", () => {
  // **The thing a grant is supposed to do**, proven end to end without a sale.
  it("lets a granted account mint, and refuses a free one", async () => {
    const free = await freeAccount();
    expect(await accountCan(free, "api.tokens")).toBe(false);
    expect(await mintToken(free, input())).toEqual({ ok: false, reason: "not-entitled" });

    const entitled = await entitledAccount();
    expect(await accountCan(entitled, "api.tokens")).toBe(true);
    const minted = await mintToken(entitled, input());
    expect(minted.ok).toBe(true);
  });

  // **A LAPSE DISABLES; IT DOES NOT REVOKE.** The single most important
  // property in this file: a billing lapse must never destroy a customer's
  // integration.
  it("stops accepting a token when the grant lapses, and accepts it again when it returns", async () => {
    // A grant with a week on it — a lapse modelled the way one actually
    // happens, by time passing rather than by anyone revoking anything. No job
    // runs; `accountCan` simply answers differently at a later `now`.
    const owner = await freeAccount();
    const premium = livePlanVersion("premium");
    const week = { planId: premium.planId, planVersion: premium.version, source: "admin" as const };
    await issueGrant({
      ...week,
      userId: owner,
      grantedBy: "dev-operator",
      reason: "One week.",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const minted = await mintToken(owner, input());
    expect(minted.ok).toBe(true);
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    expect((await verifyToken(secret)).ok).toBe(true);

    const before = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;

    // Eight days later the grant no longer confers, so the token no longer
    // works — and nothing had to happen for that to be true.
    const lapsed = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const refused = await verifyToken(secret, lapsed);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.refusal.reason).toBe("not-entitled");

    // **`revoked_at` stayed null and the row is byte-identical.** This is the
    // assertion that makes "disables, not revokes" a fact rather than a
    // description — and it is what makes the restore below cost nothing.
    const after = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(after.revokedAt).toBeNull();
    expect(after).toEqual(before);

    // Re-entitle — a resubscribe, or an operator re-granting — and every token
    // this account holds works again. **Zero writes to any token row.**
    await issueGrant({
      ...week,
      userId: owner,
      grantedBy: "dev-operator",
      reason: "Resubscribed.",
      expiresAt: null,
    });
    expect((await verifyToken(secret, lapsed)).ok).toBe(true);
    const restored = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(restored).toEqual(before);
  });

  // The entitlement is read per request from the database — never cached on
  // the row, never from a JWT. There is no column to go stale.
  it("keeps no plan or entitlement on the token row", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    const row = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(Object.keys(row)).not.toContain("planId");
    expect(Object.keys(row)).not.toContain("planVersion");
    expect(Object.keys(row)).not.toContain("entitlements");
  });
});

describe("who does NOT get api.tokens, and why that is a decision not a bug", () => {
  // **A founder grant pins `premium@v1`, and `premium@v1` never learned the
  // word.** Migration 0019 backfilled every account that existed before M20
  // with a permanent `premium` grant hardcoded at version 1, so that nobody
  // *"loses a capability they had the day before"*. M22 publishes `premium@v2`
  // and puts `api.tokens` on it — and a grant confers the version it was pinned
  // at, forever, which is M20 rule 4 working exactly as designed.
  //
  // So every founder keeps permanent premium-equivalent access and **does not
  // get API tokens**. This test states that rather than discovering it in
  // production, and it is deliberately written as the CURRENT behaviour, not as
  // a wish: if Mitchell decides founders should have tokens, the fix is an
  // additive `premium@v2` grant and this test changes in the same diff that
  // makes it true.
  it("refuses a founder pinned to premium@v1, whose grant predates the entitlement", async () => {
    const founder = await freeAccount();
    await issueGrant({
      userId: founder,
      planId: "premium",
      // The literal 1 is migration 0019's, not a convenience: `'premium', 1` is
      // written into the backfill's INSERT.
      planVersion: 1,
      source: "founder",
      grantedBy: null,
      reason: "Account existed before entitlements were introduced (M20 migration 0019).",
      expiresAt: null,
    });

    // Everything premium@v1 ever granted, still granted, permanently.
    expect(await accountCan(founder, "ai.ask")).toBe(true);
    expect(await accountCan(founder, "ai.command")).toBe(true);
    expect(await accountCan(founder, "trip.collaborators")).toBe(true);

    // And not the one M22 added.
    expect(await accountCan(founder, "api.tokens")).toBe(false);
    expect(await mintToken(founder, input())).toEqual({ ok: false, reason: "not-entitled" });
  });

  // The remedy, if one is wanted, needs no new machinery — which is the reason
  // this gap is cheap to close whenever it is decided. A second grant is
  // additive: the v1 grant is untouched and still pinned, and the resolver
  // unions them.
  it("is fixed by an additive v2 grant, leaving the pinned v1 grant alone", async () => {
    const founder = await freeAccount();
    await issueGrant({
      userId: founder,
      planId: "premium",
      planVersion: 1,
      source: "founder",
      grantedBy: null,
      reason: "Founder.",
      expiresAt: null,
    });
    expect(await accountCan(founder, "api.tokens")).toBe(false);

    const premium = livePlanVersion("premium");
    await issueGrant({
      userId: founder,
      planId: premium.planId,
      planVersion: premium.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "Founders get API tokens.",
      expiresAt: null,
    });
    expect(await accountCan(founder, "api.tokens")).toBe(true);
    expect((await mintToken(founder, input())).ok).toBe(true);

    // **The founder grant is untouched and still pinned to v1.** Nothing
    // rewrote history to achieve this — which is what keeps *"what did this
    // account hold on 2026-09-14"* answerable.
    const all = await allGrantsFor(founder);
    const original = all.find((g) => g.source === "founder")!;
    expect(original.planVersion).toBe(1);
  });
});

describe("the pepper", () => {
  // **A keyed digest, not a bare hash.** The point is that the database alone
  // cannot verify a token: recomputing the digest needs a key that does not live
  // in Postgres. CodeQL's `js/insufficient-password-hash` flagged the bare
  // `sha256` this replaced; the reasoning for HMAC over a slow KDF — 32 bytes of
  // CSPRNG has no space to guess through, and a KDF would charge ~100ms on every
  // API request to defend nothing — is in `hashOf`.
  it("keys the stored digest, so the same secret hashes differently under a different pepper", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    expect(minted.ok).toBe(true);
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    const stored = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;

    // The digest is NOT the unkeyed sha256 of the secret — which is exactly what
    // an attacker holding only this table would compute.
    const unkeyed = createHash("sha256").update(secret, "utf8").digest("hex");
    expect(stored.tokenHash).not.toBe(unkeyed);

    // And under a rotated pepper the same secret no longer resolves — every
    // token dies, deliberately and with no migration path, which is the right
    // blast radius for a key compromise.
    const original = process.env.API_TOKEN_PEPPER;
    process.env.API_TOKEN_PEPPER = "a-different-key-entirely";
    try {
      const refused = await verifyToken(secret);
      expect(refused.ok).toBe(false);
      expect(refused.ok === false && refused.refusal.reason).toBe("unknown");
    } finally {
      process.env.API_TOKEN_PEPPER = original;
    }
    // Restored, it works again — nothing about the row changed.
    expect((await verifyToken(secret)).ok).toBe(true);
  });

  // **Fails closed and loudly.** An empty pepper still produces a stable digest,
  // so a silent fallback would leave tokens working while the property the key
  // exists for did not hold — nothing would error, which is the worst way for a
  // credential store to be wrong.
  it("refuses to mint or verify at all when it is unset", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    const secret = minted.ok ? minted.created.secret : "";

    const original = process.env.API_TOKEN_PEPPER;
    delete process.env.API_TOKEN_PEPPER;
    try {
      await expect(mintToken(owner, input())).rejects.toThrow(ApiTokenPepperMissingError);
      await expect(verifyToken(secret)).rejects.toThrow(/API_TOKEN_PEPPER is not set/);
    } finally {
      process.env.API_TOKEN_PEPPER = original;
    }
  });
});

describe("the secret", () => {
  // **A stolen table is not a stolen credential.**
  it("is returned exactly once and never stored", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    expect(minted.ok).toBe(true);
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";

    expect(secret.startsWith("tc_")).toBe(true);

    const row = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    // Not in any column, in any encoding anyone would reach for.
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.tokenHash).not.toBe(secret);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The prefix is a display handle, not a shard of the secret worth having.
    expect(secret.startsWith(row.prefix)).toBe(true);
    expect(row.prefix.length).toBeLessThan(secret.length / 2);

    // And the read path can never hand it back.
    const [listed] = await listTokens(owner);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("is different every time, and only its own token verifies", async () => {
    const owner = await entitledAccount();
    const a = await mintToken(owner, input({ name: "A" }));
    const b = await mintToken(owner, input({ name: "B" }));
    const secretA = a.ok ? a.created.secret : "";
    const secretB = b.ok ? b.created.secret : "";
    expect(secretA).not.toBe(secretB);

    const verifiedA = await verifyToken(secretA);
    expect(verifiedA.ok && verifiedA.token.tokenId).toBe(a.ok ? a.created.token.tokenId : "");
  });

  it("refuses a secret that was never minted, without touching the prefix check", async () => {
    for (const nonsense of ["", "bearer", "tc_", "tc_notarealsecret", "sk_live_something"]) {
      const result = await verifyToken(nonsense);
      expect(result.ok, nonsense).toBe(false);
      expect(result.ok === false && result.refusal.reason, nonsense).toBe("unknown");
    }
  });
});

describe("expiry is resolved on read and never swept", () => {
  it("refuses an expired token, keeps the row, and says expired rather than revoked", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input({ expiresInDays: 1 }));
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";

    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const refused = await verifyToken(secret, later);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.refusal.reason).toBe("expired");

    // **Refused, not deleted.** The row is how its owner learns what lapsed.
    const rows = await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeNull();
    // And it is still listable, which is what makes that legible.
    expect((await listTokens(owner)).map((t) => t.tokenId)).toContain(tokenId);
    expect((await expiredTokensFor(owner, later)).map((t) => t.tokenId)).toContain(tokenId);
  });

  // An expired token answers differently from a revoked one, so an integrator
  // learns "mint a new one" rather than "you were cut off".
  it("reports a revoked token as revoked even after it also expires", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input({ expiresInDays: 1 }));
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    await revokeToken(owner, tokenId);

    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const refused = await verifyToken(secret, later);
    expect(refused.ok === false && refused.refusal.reason).toBe("revoked");
  });

  it("refuses a lifetime past the ceiling rather than clamping it", async () => {
    const owner = await entitledAccount();
    const over = await mintToken(owner, input({ expiresInDays: API_TOKEN_MAX_LIFETIME_DAYS + 1 }));
    expect(over).toEqual({
      ok: false,
      reason: "invalid-lifetime",
      maxDays: API_TOKEN_MAX_LIFETIME_DAYS,
    });
    // Nothing was written — a refusal is not a silently shortened token.
    expect(await listTokens(owner)).toHaveLength(0);
  });
});

describe("revocation", () => {
  // The hard-won shape from `revokeInvite` (PR #71 §1): a guarded UPDATE,
  // never a read followed by a write.
  it("is idempotent, and a second revoke does not move the timestamp", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    const tokenId = minted.ok ? minted.created.token.tokenId : "";

    const first = await revokeToken(owner, tokenId);
    expect(first.ok).toBe(true);
    const revokedAt = first.ok ? first.token.revokedAt : null;
    expect(revokedAt).not.toBeNull();

    // Already-revoked is `ok`, not 404 — matching `revokeShare`, so a
    // double-click cannot produce a scary error.
    const second = await revokeToken(owner, tokenId, new Date(Date.now() + 60_000));
    expect(second.ok).toBe(true);
    // **The guard did its job**: the second call matched nothing and fell
    // through to a read, so the original timestamp stands. An unguarded UPDATE
    // would have overwritten it and lost when the cut-off actually happened.
    expect(second.ok && second.token.revokedAt).toBe(revokedAt);
  });

  it("only lets the owner revoke, and answers 404 rather than 500 for a non-uuid", async () => {
    const owner = await entitledAccount();
    const stranger = await entitledAccount();
    const minted = await mintToken(owner, input());
    const tokenId = minted.ok ? minted.created.token.tokenId : "";

    // A stranger who somehow knows the id gets "no such token", and the token
    // keeps working.
    expect(await revokeToken(stranger, tokenId)).toEqual({ ok: false, reason: "not-found" });
    const secret = minted.ok ? minted.created.secret : "";
    expect((await verifyToken(secret)).ok).toBe(true);

    // `id` is a uuid column, so a non-uuid would make the UPDATE fail with
    // Postgres `22P02` and the route 500 (KI-2026-09-05-x).
    expect(await revokeToken(owner, "not-a-uuid")).toEqual({ ok: false, reason: "not-found" });
    expect(await revokeToken(owner, randomUUID())).toEqual({ ok: false, reason: "not-found" });
  });

  it("stops the token working immediately", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    const secret = minted.ok ? minted.created.secret : "";
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    expect((await verifyToken(secret)).ok).toBe(true);
    await revokeToken(owner, tokenId);
    const refused = await verifyToken(secret);
    expect(refused.ok === false && refused.refusal.reason).toBe("revoked");
  });
});

describe("what a verified token carries", () => {
  it("hands the wrapper the scopes and trip confinement, parsed", async () => {
    const owner = await entitledAccount();
    const tripId = randomUUID();
    const minted = await mintToken(
      owner,
      input({ scopes: ["trips:read", "notebook:write"], tripIds: [tripId] }),
    );
    const verified = await verifyToken(minted.ok ? minted.created.secret : "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.token.ownerId).toBe(owner);
    expect([...verified.token.scopes].sort()).toEqual(["notebook:write", "trips:read"]);
    expect(verified.token.tripIds).not.toBeNull();
    expect([...verified.token.tripIds!]).toEqual([tripId]);
  });

  // `null` is account-wide and follows membership live — every trip the owner
  // can reach, including ones created after the token was minted.
  it("distinguishes account-wide from confined", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input({ tripIds: null }));
    const verified = await verifyToken(minted.ok ? minted.created.secret : "");
    expect(verified.ok && verified.token.tripIds).toBeNull();
  });

  // **A `text[]` column is not a guarantee.** A scope retired from the enum
  // must not flow into an authorisation decision as a string nothing
  // recognises — and one bad entry must not make a token unlistable, because
  // an unlistable token is an unrevokable one.
  it("drops a scope the enum no longer knows, rather than trusting or throwing", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input({ scopes: ["trips:read"] }));
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    await db
      .update(apiTokens)
      .set({ scopes: ["trips:read", "trips:obliterate"] as never })
      .where(eq(apiTokens.id, tokenId));

    const verified = await verifyToken(minted.ok ? minted.created.secret : "");
    expect(verified.ok && [...verified.token.scopes]).toEqual(["trips:read"]);
    const [listed] = await listTokens(owner);
    expect(listed!.scopes).toEqual(["trips:read"]);
  });
});

describe("last_used_at", () => {
  // A write on a read path, bounded to once per five minutes (Decision 7).
  it("records a first use, then coarsens", async () => {
    const owner = await entitledAccount();
    const minted = await mintToken(owner, input());
    const tokenId = minted.ok ? minted.created.token.tokenId : "";
    expect(minted.ok && minted.created.token.lastUsedAt).toBeNull();

    const first = new Date();
    await touchLastUsed(tokenId, first);
    const afterFirst = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(afterFirst.lastUsedAt).not.toBeNull();

    // A second use a minute later is not worth a write.
    await touchLastUsed(tokenId, new Date(first.getTime() + 60_000));
    const afterSecond = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(afterSecond.lastUsedAt).toEqual(afterFirst.lastUsedAt);

    // Six minutes later, it is.
    await touchLastUsed(tokenId, new Date(first.getTime() + 6 * 60_000));
    const afterThird = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0]!;
    expect(afterThird.lastUsedAt).not.toEqual(afterFirst.lastUsedAt);
  });
});

describe("listing", () => {
  it("shows this account's tokens newest first, and nobody else's", async () => {
    const owner = await entitledAccount();
    const stranger = await entitledAccount();
    await mintToken(owner, input({ name: "First" }));
    await mintToken(owner, input({ name: "Second" }));
    await mintToken(stranger, input({ name: "Theirs" }));

    const mine = await listTokens(owner);
    expect(mine.map((t) => t.name)).toEqual(["Second", "First"]);
    expect(mine.every((t) => !t.name.includes("Theirs"))).toBe(true);
  });
});
