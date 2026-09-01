import { describe, expect, it } from "vitest";
import { displayNameFor } from "./displayName";

// The M17 seam, and — since 2026-09-01 — the guarantee that no raw identifier
// reaches a reader. Mitchell, on the shared-day screen: "Dont show the UUID in
// the Header bar where publish button is".
describe("displayNameFor", () => {
  it("prefers a real name, then an email", () => {
    expect(displayNameFor({ userId: "dev-alice", name: "Alice Chen", email: "a@example.com" })).toBe(
      "Alice Chen",
    );
    expect(displayNameFor({ userId: "dev-alice", name: null, email: "a@example.com" })).toBe(
      "a@example.com",
    );
  });

  it("reads the username out of a dev-login id", () => {
    // `devLoginIdentity` lowercases and bounds the username, so the readable
    // name really is in the id and nothing is invented by taking it.
    expect(displayNameFor({ userId: "dev-alice" })).toBe("Alice");
    expect(displayNameFor({ userId: "dev-bob" })).toBe("Bob");
  });

  it("never renders an opaque identifier verbatim", () => {
    const sub = "104773518912345678901"; // a Google `sub`
    const uuid = "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f5a44";
    for (const id of [sub, uuid]) {
      const shown = displayNameFor({ userId: id });
      expect(shown).not.toContain(id);
      expect(shown.startsWith("Traveler ")).toBe(true);
    }
  });

  it("keeps two different people apart", () => {
    // The leaderboard ranks people against each other, so a flat "Traveler"
    // would make every row the same person. The suffix is what stops that.
    const a = displayNameFor({ userId: "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f5a44" });
    const b = displayNameFor({ userId: "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f0000" });
    expect(a).not.toBe(b);
  });

  // CodeRabbit (pull request 104): the old 4-character suffix meant two ids that
  // merely shared their LAST four characters rendered as the exact same
  // label — these two differ only in the fifth-from-last character
  // (`...5a44` vs `...9a44`), a collision the old width could not see past.
  // The point of this test is specifically that width, not just "any two
  // random ids differ" (the test above already covers that).
  it("still tells apart two ids that share their final four characters", () => {
    const a = displayNameFor({ userId: "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f5a44" });
    const b = displayNameFor({ userId: "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f9a44" });
    expect(a).not.toBe(b);
  });

  it("is stable for one id", () => {
    const id = "104773518912345678901";
    expect(displayNameFor({ userId: id })).toBe(displayNameFor({ userId: id }));
  });

  it("says something rather than nothing for an id with no readable characters", () => {
    expect(displayNameFor({ userId: "---" })).toBe("A traveler");
  });
});
