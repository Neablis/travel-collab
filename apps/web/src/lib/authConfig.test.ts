import { describe, expect, it, vi } from "vitest";
import { devLoginIdentity } from "./authConfig";

// Dev login exists to resemble a real Google sign-in closely enough that
// email-shaped features are testable end to end (ADR-025's seam, and the gap
// ADR-026 leaned on). These pin the two things that makes true: what is
// rejected, and what address a name produces.

describe("devLoginIdentity", () => {
  it("builds a plus-addressed email off one inbox, so each dev user is distinct but reachable", () => {
    expect(devLoginIdentity("alice")).toEqual({
      id: "dev-alice",
      name: "alice",
      email: "dev+alice@example.com",
    });
    expect(devLoginIdentity("bob")!.email).toBe("dev+bob@example.com");
  });

  it("keeps the id shape `actor_id` has always carried", () => {
    // Unchanged from before emails existed: this exact string is what sits in
    // events.actor_id, pages.actor_id and TripMember.userId (ADR-025).
    expect(devLoginIdentity("alice")!.id).toBe("dev-alice");
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(devLoginIdentity("  alice  ")).toEqual(devLoginIdentity("alice"));
  });

  // The charset is what makes the address well-formed rather than cosmetic —
  // a username carrying whitespace or `@` would build something that is not an
  // email, and normalizeIdentity would store rubbish against a durable row.
  it("rejects anything that would not survive being put in an address", () => {
    for (const bad of [
      "",
      "   ",
      "two words",
      "a@b",
      "alice+bob",
      "alice.smith",
      "../etc",
      "<script>",
      "a".repeat(33),
    ]) {
      expect(devLoginIdentity(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBeNull();
    }
  });

  // A misconfigured AUTH_DEV_EMAIL_BASE must fail the sign-in rather than
  // mint a malformed address. Exercised through the module's own parsing by
  // re-importing with the env var set, since the base is read at module load.
  it("refuses to build an identity from a malformed email base", async () => {
    const original = process.env.AUTH_DEV_EMAIL_BASE;
    try {
      for (const bad of ["ops@", "@example.com", "ops@internal@example.com", "noatsign", "op s@x.com"]) {
        process.env.AUTH_DEV_EMAIL_BASE = bad;
        vi.resetModules();
        const { devLoginIdentity: fresh } = await import("./authConfig");
        expect(fresh("alice"), `expected base ${JSON.stringify(bad)} to be refused`).toBeNull();
      }
    } finally {
      if (original === undefined) delete process.env.AUTH_DEV_EMAIL_BASE;
      else process.env.AUTH_DEV_EMAIL_BASE = original;
      vi.resetModules();
    }
  });

  it("honours a well-formed override", async () => {
    const original = process.env.AUTH_DEV_EMAIL_BASE;
    try {
      process.env.AUTH_DEV_EMAIL_BASE = "team@example.com";
      vi.resetModules();
      const { devLoginIdentity: fresh } = await import("./authConfig");
      expect(fresh("alice")!.email).toBe("team+alice@example.com");
    } finally {
      if (original === undefined) delete process.env.AUTH_DEV_EMAIL_BASE;
      else process.env.AUTH_DEV_EMAIL_BASE = original;
      vi.resetModules();
    }
  });

  it("rejects a non-string credential", () => {
    for (const bad of [undefined, null, 42, {}, ["alice"]]) {
      expect(devLoginIdentity(bad)).toBeNull();
    }
  });

  it("accepts the punctuation a username legitimately carries", () => {
    expect(devLoginIdentity("alice-2")!.email).toBe("dev+alice-2@example.com");
    expect(devLoginIdentity("alice_2")!.email).toBe("dev+alice_2@example.com");
    expect(devLoginIdentity("a".repeat(32))).not.toBeNull();
  });
});

// `id` is what `actor_id` and every membership row carry, so casing that
// survives into it mints two people out of one. `normalizeIdentity` lowercases
// the EMAIL, which is why this looked handled and was not (CodeRabbit, #71).
describe("dev login is case-insensitive in the identity, not just the address", () => {
  it("converges every spelling of a username on one id", () => {
    const spellings = ["alice", "Alice", "ALICE", "AlIcE", "  Alice  "];
    const ids = new Set(spellings.map((s) => devLoginIdentity(s)!.id));
    expect([...ids]).toEqual(["dev-alice"]);
  });

  it("carries that same canonical form into the name and the address", () => {
    const identity = devLoginIdentity("Alice")!;
    expect(identity).toEqual({
      id: "dev-alice",
      name: "alice",
      email: "dev+alice@example.com",
    });
  });
});

// The provider registration itself, not just the identity it mints. Until
// this existed, nothing anywhere asserted that a password-less credentials
// provider is ABSENT when it should be — the gate was one env var, one
// mis-scoped Vercel variable away from production accepting credential-less
// sign-in as any existing `dev-*` member (project review M1, PR #71 §7).
describe("the dev-login provider's registration gate", () => {
  // Keyed on `type`, not on our `id`. Auth.js's `Credentials()` factory
  // returns a defaults object (`id: "credentials"`) that stashes the config
  // we passed under `options` and merges it only during `NextAuth()`
  // initialization — so the `id: "dev-login"` we set is not visible on the
  // static config, and asserting on it would be asserting on an Auth.js
  // internal. `type` is also the stronger claim: what must be absent from a
  // production deployment is ANY password-less credentials provider, not
  // specifically the one named dev-login.
  async function credentialsProviderRegistered(env: Record<string, string | undefined>): Promise<boolean> {
    const saved = { AUTH_DEV_LOGIN: process.env.AUTH_DEV_LOGIN, VERCEL_ENV: process.env.VERCEL_ENV };
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
      const { authConfig } = await import("./authConfig");
      return authConfig.providers.some((p) => typeof p === "object" && p !== null && p.type === "credentials");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    }
  }

  it("registers nothing when the opt-in is unset", async () => {
    expect(await credentialsProviderRegistered({ AUTH_DEV_LOGIN: undefined, VERCEL_ENV: undefined })).toBe(false);
  });

  it("registers nothing for any value other than the exact opt-in string", async () => {
    for (const value of ["", "false", "1", "TRUE", "yes", " true "]) {
      expect(
        await credentialsProviderRegistered({ AUTH_DEV_LOGIN: value, VERCEL_ENV: undefined }),
        `expected AUTH_DEV_LOGIN=${JSON.stringify(value)} not to register the provider`,
      ).toBe(false);
    }
  });

  // The clause the review asked for: VERCEL_ENV is set by Vercel, never by
  // us, so this is the part an operator cannot get wrong by scoping
  // AUTH_DEV_LOGIN to "All Environments".
  it("registers nothing in production even with the opt-in on", async () => {
    expect(await credentialsProviderRegistered({ AUTH_DEV_LOGIN: "true", VERCEL_ENV: "production" })).toBe(false);
  });

  it("registers the provider in local development, where VERCEL_ENV is unset", async () => {
    expect(await credentialsProviderRegistered({ AUTH_DEV_LOGIN: "true", VERCEL_ENV: undefined })).toBe(true);
  });

  it("registers the provider in preview and in Vercel's own dev environment", async () => {
    for (const env of ["preview", "development"]) {
      expect(
        await credentialsProviderRegistered({ AUTH_DEV_LOGIN: "true", VERCEL_ENV: env }),
        `expected VERCEL_ENV=${env} to keep dev login available`,
      ).toBe(true);
    }
  });
});

// RED-FIRST, run 2026-09-02 (the rule `docs/guidelines/testing.md` states, and
// what a security guard owes a reviewer — these tests were written before that
// guideline landed and did not carry this evidence until review asked for it):
//
//   Mutation A — delete `if (token.env !== authEnvironment()) return null;`
//     3 failed | 18 passed. Exactly the three refusals:
//       expected { userId: 'dev-alice', env: 'preview' }    to be null
//       expected { userId: 'u1',        env: 'production' } to be null
//       expected { userId: 'u1' }                           to be null
//
//   Mutation B — delete `token.env = authEnvironment();` at mint time
//     2 failed | 19 passed. Exactly the two that read the stamp:
//       expected { userId: 'dev-alice' } to match object { userId: 'dev-alice', env: 'preview' }
//       expected { userId: 'dev-alice' } to match object { env: 'development' }
//
// Both restored, 21 passed. The two halves of the guard fail independently,
// so neither is carried by the other.
//
// The environment claim (project review M3). Preview and Production share one
// AUTH_SECRET — the redirect proxy needs them to — so a preview-minted JWT
// verifies on production, and Preview is where password-less dev login lives.
// These pin the claim that closes that: where a token says it came from, and
// what happens to one that says the wrong thing.
describe("the session token's environment claim", () => {
  const withEnv = async <T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> => {
    const original = process.env.VERCEL_ENV;
    try {
      if (value === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = value;
      return await run();
    } finally {
      if (original === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = original;
    }
  };

  // The callback is plain data on authConfig, so it can be called directly
  // rather than driven through a whole sign-in.
  const jwt = async (args: { token: Record<string, unknown>; user?: { id?: string } }) => {
    const { authConfig } = await import("./authConfig");
    return (authConfig.callbacks!.jwt as unknown as (a: unknown) => unknown)(args) as
      | Record<string, unknown>
      | null;
  };

  it("stamps the minting environment on the token at sign-in", async () => {
    await withEnv("preview", async () => {
      expect(await jwt({ token: {}, user: { id: "dev-alice" } })).toMatchObject({
        userId: "dev-alice",
        env: "preview",
      });
    });
  });

  it("reads back a token minted in the same environment", async () => {
    await withEnv("production", async () => {
      expect(await jwt({ token: { userId: "u1", env: "production" } })).toMatchObject({ userId: "u1" });
    });
  });

  // The one that matters: a `dev-alice` cookie lifted off a preview and
  // pasted onto caesura.today. Null is Auth.js's "clear the cookie" signal.
  it("refuses a preview-minted token presented to production", async () => {
    await withEnv("production", async () => {
      expect(await jwt({ token: { userId: "dev-alice", env: "preview" } })).toBeNull();
    });
  });

  it("refuses a production token presented to a preview, in the same way", async () => {
    await withEnv("preview", async () => {
      expect(await jwt({ token: { userId: "u1", env: "production" } })).toBeNull();
    });
  });

  // Deliberate, and the reason the fix costs one forced re-sign-in: a token
  // with no claim is exactly one whose origin cannot be established.
  it("refuses a token carrying no claim at all", async () => {
    await withEnv("production", async () => {
      expect(await jwt({ token: { userId: "u1" } })).toBeNull();
    });
  });

  it("treats off-Vercel as one stable environment, so local dev and the test lane work", async () => {
    await withEnv(undefined, async () => {
      const minted = await jwt({ token: {}, user: { id: "dev-alice" } });
      expect(minted).toMatchObject({ env: "development" });
      expect(await jwt({ token: minted! })).not.toBeNull();
    });
  });
});
