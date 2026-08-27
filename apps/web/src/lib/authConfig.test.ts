import { describe, expect, it } from "vitest";
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
