import { describe, expect, it } from "vitest";
import { displayNameFor, firstNameOf, publicNameFor } from "./displayName";

// The M17 seam, and — since 2026-09-01 — the guarantee that no raw identifier
// reaches a reader. Mitchell, on the shared-day screen: "Dont show the UUID in
// the Header bar where publish button is".
describe("displayNameFor", () => {
  // M17. The chosen name is FIRST, ahead of the provider's — `users.name` is
  // overwritten from Google on every sign-in, so if it won, a name typed into
  // account settings would be invisible from the next sign-in onward.
  it("prefers a chosen display name over everything else", () => {
    expect(
      displayNameFor({
        userId: "dev-alice",
        displayName: "Al",
        name: "Alice Chen",
        email: "a@example.com",
      }),
    ).toBe("Al");
  });

  it("falls through a cleared display name to the provider's name", () => {
    // `null` is the DTO's "unset" and must behave exactly like the absent
    // field, or clearing your name would render as an empty account.
    expect(
      displayNameFor({ userId: "dev-alice", displayName: null, name: "Alice Chen" }),
    ).toBe("Alice Chen");
    expect(displayNameFor({ userId: "dev-alice", displayName: null })).toBe("Alice");
  });

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

// One "first word of a name" for the invite landing, its look-first view and
// Cass's greeting — four copies of the same split until M27's review.
describe("firstNameOf", () => {
  it("is the first word of whatever it is given", () => {
    expect(firstNameOf("  Dana   Reyes ")).toBe("Dana");
    // The landing's crew line has no handle to refuse, so a handle is a name
    // to it — the behaviour those callers had before the helper.
    expect(firstNameOf("Traveler 4f2a91")).toBe("Traveler");
    expect(firstNameOf("   ")).toBe("");
  });

  // Given the handle, a greeting refuses what is not a name somebody has:
  // "Hi Traveler," and "Hi sam@example.com," are not greetings.
  it("takes a first name from a real name only, when told the handle", () => {
    expect(firstNameOf("Sam Rivera", "Traveler 4f2a91")).toBe("Sam");
    expect(firstNameOf("Traveler 4f2a91", "Traveler 4f2a91")).toBeNull();
    expect(firstNameOf("sam@example.com", "Traveler 4f2a91")).toBeNull();
    expect(firstNameOf("   ", "Traveler 4f2a91")).toBeNull();
  });
});

// The public library's name (Mitchell, 2026-10-02; ADR-061 decision 4): first
// name and last initial, from what the person chose or signed in with — never
// the address. A stranger reading a Playbook learns "Dana R." and no more.
describe("publicNameFor", () => {
  const ID = "9f1c2b7e-4a55-4a1e-9b31-8c0d7e6f5a44";
  const HANDLE = displayNameFor({ userId: ID });

  it("is the first name and the last word's initial", () => {
    expect(publicNameFor({ userId: ID, name: "Dana Reyes" })).toBe("Dana R.");
    expect(publicNameFor({ userId: ID, name: "Dana Maria Reyes" })).toBe("Dana R.");
    expect(publicNameFor({ userId: ID, name: "  Dana   Reyes  " })).toBe("Dana R.");
    // Already an initial: one full stop, not two and not none.
    expect(publicNameFor({ userId: ID, name: "Dana R" })).toBe("Dana R.");
  });

  it("capitalises the first name and the initial", () => {
    expect(publicNameFor({ userId: ID, name: "dana reyes" })).toBe("Dana R.");
    // Dev login stores the username lowercased; the handle it replaces said "Alice".
    expect(publicNameFor({ userId: "dev-alice", name: "alice" })).toBe("Alice");
  });

  it("keeps a one-word name whole", () => {
    expect(publicNameFor({ userId: ID, name: "Sunny" })).toBe("Sunny");
  });

  // `word[0]` is a UTF-16 unit, half of anything outside the BMP — a lone
  // surrogate renders as a replacement box on every card that prints it.
  it("takes the initial as a whole character, not half of one", () => {
    expect(publicNameFor({ userId: ID, name: "Yuki 𠮷田" })).toBe("Yuki 𠮷.");
    expect(publicNameFor({ userId: ID, name: "Олена Шевченко" })).toBe("Олена Ш.");
  });

  it("skips punctuation to reach the initial", () => {
    expect(publicNameFor({ userId: ID, name: "Dana (Reyes)" })).toBe("Dana R.");
  });

  it("prefers the chosen display name over the sign-in name", () => {
    expect(publicNameFor({ userId: ID, displayName: "Dee Ray", name: "Dana Reyes" })).toBe("Dee R.");
  });

  it("falls through an unusable chosen name to the sign-in name", () => {
    expect(publicNameFor({ userId: ID, displayName: "   ", name: "Dana Reyes" })).toBe("Dana R.");
    expect(publicNameFor({ userId: ID, displayName: "dana@example.com", name: "Dana Reyes" })).toBe("Dana R.");
  });

  // An address is never a name here, wherever it sits in the string — the
  // first word of "dana@example.com" is the whole address.
  it("never prints anything that looks like an address", () => {
    for (const name of ["dana@example.com", "Dana dana@example.com", "dana@example.com Reyes"]) {
      expect(publicNameFor({ userId: ID, name })).toBe(HANDLE);
    }
  });

  it("is the handle for an account with no usable name", () => {
    expect(publicNameFor({ userId: ID })).toBe(HANDLE);
    expect(publicNameFor({ userId: ID, displayName: null, name: null })).toBe(HANDLE);
    expect(publicNameFor({ userId: ID, name: "  " })).toBe(HANDLE);
  });
});
