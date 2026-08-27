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
      email: "neablis121+alice@gmail.com",
    });
    expect(devLoginIdentity("bob")!.email).toBe("neablis121+bob@gmail.com");
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
    expect(devLoginIdentity("alice-2")!.email).toBe("neablis121+alice-2@gmail.com");
    expect(devLoginIdentity("alice_2")!.email).toBe("neablis121+alice_2@gmail.com");
    expect(devLoginIdentity("a".repeat(32))).not.toBeNull();
  });
});
