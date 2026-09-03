import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import { provenanceLabel } from "./pageScope";

describe("provenanceLabel", () => {
  const ALICE = "dev-alice";
  const BOB = "dev-bob";

  it("names a seeded notebook as one that came with the trip", () => {
    expect(provenanceLabel({ actorId: SYSTEM_ACTOR_ID }, ALICE)).toBe("Comes with your trip");
  });

  it("says Yours only for a notebook the READER wrote", () => {
    expect(provenanceLabel({ actorId: ALICE }, ALICE)).toBe("Yours");
  });

  // The case the first version got wrong, and the reason `viewerId` exists.
  // Choosing on `actorId !== SYSTEM_ACTOR_ID` alone proves only that a person
  // wrote it, so every collaborator's notebook on a shared trip read "Yours".
  it("does not claim a collaborator's notebook as the reader's", () => {
    expect(provenanceLabel({ actorId: BOB }, ALICE)).toBe("From another traveler");
  });

  // Nobody is named, deliberately: telling the reader WHICH traveler needs a
  // `users` join `pages` has never had. Telling them it is not theirs does not.
  it("stays author-neutral when the reader is unknown, rather than guessing", () => {
    expect(provenanceLabel({ actorId: ALICE }, null)).toBe("From another traveler");
    expect(provenanceLabel({ actorId: BOB }, null)).toBe("From another traveler");
    // The seeded case needs no reader to be certain — the sentinel is a value
    // this app writes and no person can hold.
    expect(provenanceLabel({ actorId: SYSTEM_ACTOR_ID }, null)).toBe("Comes with your trip");
  });

  it("does not treat a person whose id merely resembles the sentinel as the seeder", () => {
    // The sentinel is an exact value, not a prefix. A substring test would hand
    // "Comes with your trip" to anyone signing in as `system-2`.
    expect(provenanceLabel({ actorId: "system-2" }, ALICE)).toBe("From another traveler");
    expect(provenanceLabel({ actorId: "System" }, ALICE)).toBe("From another traveler");
  });
});
