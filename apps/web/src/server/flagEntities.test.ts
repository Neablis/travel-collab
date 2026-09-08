import { beforeEach, describe, expect, it, vi } from "vitest";

// `dedupe` reaches for next/headers and a request scope, which a unit test has
// no way to provide. Replacing it with identity keeps the wrapper under test
// (`identifyFlagEntities` is still the real closure over the real mapping) and
// only removes the per-request caching, which is a performance property tested
// nowhere else and asserted by the SDK's own suite.
vi.mock("flags/next", () => ({ dedupe: <T,>(fn: T) => fn }));

// The lazy `await import("@/server/auth")` inside identify resolves through
// this, which is also the point of the mock: a real `@/server/auth` would pull
// in the database client and its DATABASE_URL guard.
const auth = vi.fn();
vi.mock("@/server/auth", () => ({ auth: () => auth() }));

const { flagEntitiesFor, identifyFlagEntities } = await import("@/server/flagEntities");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("flagEntitiesFor", () => {
  it("publishes id, email and email domain for a signed-in caller", () => {
    expect(flagEntitiesFor({ user: { id: "google-1234", email: "mitchell@example.com" } })).toEqual({
      user: { id: "google-1234", email: "mitchell@example.com", emailDomain: "example.com" },
    });
  });

  // A rule is written once, against one spelling. Google hands back whatever
  // case the person typed, so an un-normalised address would make
  // `user.email eq Mitchell@Example.com` and `mitchell@example.com` two
  // different targets — and the one that fails to match silently falls through
  // to the dashboard default, i.e. no live AI and no error either.
  it("lowercases and trims the address so one rule matches one person", () => {
    expect(flagEntitiesFor({ user: { id: "u1", email: "  Mitchell@Example.COM " } })).toEqual({
      user: { id: "u1", email: "mitchell@example.com", emailDomain: "example.com" },
    });
  });

  // The domain is what follows the LAST "@" — a quoted local part may legally
  // contain one, and splitting on the first would publish an "emailDomain"
  // that is really part of someone's name.
  it("takes the domain from the last @, not the first", () => {
    expect(flagEntitiesFor({ user: { id: "u1", email: '"odd@name"@example.com' } })).toMatchObject({
      user: { emailDomain: "example.com" },
    });
  });

  it("omits emailDomain, but keeps the address, when there is no @ to split on", () => {
    expect(flagEntitiesFor({ user: { id: "u1", email: "not-an-address" } })).toEqual({
      user: { id: "u1", email: "not-an-address" },
    });
  });

  it("publishes the id alone when the session carries no email", () => {
    expect(flagEntitiesFor({ user: { id: "dev-alice", email: null } })).toEqual({
      user: { id: "dev-alice" },
    });
    expect(flagEntitiesFor({ user: { id: "dev-alice" } })).toEqual({ user: { id: "dev-alice" } });
  });

  // No `user` key at all, rather than a user with blank attributes. The
  // difference is what a targeting rule sees: `user.id eq ""` would otherwise
  // match every unidentifiable caller on the deployment with one rule.
  it("publishes no user for a caller it cannot identify", () => {
    expect(flagEntitiesFor(null)).toEqual({});
    expect(flagEntitiesFor({})).toEqual({});
    expect(flagEntitiesFor({ user: null })).toEqual({});
    expect(flagEntitiesFor({ user: { id: null } })).toEqual({});
    // `lib/authConfig.ts`'s session callback writes exactly this when a token
    // carries no userId claim — not a hypothetical.
    expect(flagEntitiesFor({ user: { id: "", email: "someone@example.com" } })).toEqual({});
    expect(flagEntitiesFor({ user: { id: "   " } })).toEqual({});
  });
});

describe("identifyFlagEntities", () => {
  it("maps the live session into entities", async () => {
    auth.mockResolvedValue({ user: { id: "google-99", email: "mitchell@example.com" } });
    await expect(identifyFlagEntities()).resolves.toEqual({
      user: { id: "google-99", email: "mitchell@example.com", emailDomain: "example.com" },
    });
    expect(auth).toHaveBeenCalledOnce();
  });

  it("publishes no user when nobody is signed in", async () => {
    auth.mockResolvedValue(null);
    await expect(identifyFlagEntities()).resolves.toEqual({});
  });

  // Load-bearing, and the reason there is no try/catch in the module: a
  // swallowed failure would publish `{}`, which is "anonymous", which falls
  // through to whatever the dashboard's default rule happens to be. The kill
  // switch's guarantee is that an unanswerable question degrades to SIMULATED,
  // and that only holds if the failure reaches `aiLive()`'s catch — so this
  // must reject rather than resolve.
  it("propagates a failed session read instead of degrading to anonymous", async () => {
    auth.mockRejectedValue(new Error("JWT decryption failed"));
    await expect(identifyFlagEntities()).rejects.toThrow("JWT decryption failed");
  });
});
