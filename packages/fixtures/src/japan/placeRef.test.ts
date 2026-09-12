// **What a grounding ref means for the demo trip: nothing, and that has to stay
// checkable.**
//
// `placeRef` (M9, KI-81) is a citation the assistant's server half resolves into
// a real `location` before the command reaches the domain — index N of the
// candidates that turn's place search returned. There is no turn, no search and
// no candidate list behind a hand-written fixture row, so the Japan trip carries
// no refs and must not grow any (the procedure in
// `docs/guidelines/fixtures-and-seed-data.md` is for fields that get STORED).
//
// What the fixture does owe the field is the thing invariant 5 is about: this
// package's commands are built as typed literals and folded straight through the
// domain — nothing here ever put them through the contract's own parser, so a
// `packages/contracts` change that tightened an activity command would break
// `db:seed` at runtime with every test in this package still green. These parse,
// which is what makes the new field's optionality a checked claim rather than an
// intention.
import { describe, expect, it } from "vitest";
import { TripCommand } from "@tc/contracts";
import { deterministicMintId, japanTripCommands } from "./commands.ts";
import { REFERENCE_START_DATE } from "./trip.ts";

const TRIP_ID = "00000000-0000-4000-8000-00000000f000";

const seedCommands = () =>
  japanTripCommands(TRIP_ID, { startDate: REFERENCE_START_DATE, mintId: deterministicMintId() });

describe("placeRef against the canonical Japan fixture", () => {
  // The fixture is 72 stops, 4 backlog items and two setup commands; the floor
  // is well under that so it does not flap on a legitimate content edit, and
  // well over zero so a producer that stopped producing cannot pass here.
  it("leaves every seeded command a valid TripCommand — the field is optional, and the seed relies on it", () => {
    let parsed = 0;
    for (const command of seedCommands()) {
      expect(TripCommand.safeParse(command), `${command.type} is not a valid TripCommand`).toMatchObject({
        success: true,
      });
      parsed += 1;
    }
    expect(parsed, "no command was inspected").toBeGreaterThan(70);
  });

  // And a seeded command that DID carry one is still a legal command, so the
  // resolved-then-committed path the assistant will take (PR 4) cannot be
  // rejected by a shape the seed proves every day.
  it("accepts a ref on the same commands, for when the assistant is the one adding a stop", () => {
    let cited = 0;
    for (const command of seedCommands()) {
      if (command.type !== "AddActivity") continue;
      // Varied, not one value repeated — the fixtures guide's rule for any new
      // field, and here it also exercises 0, which `nonnegative()` admits and a
      // `positive()` would not.
      const grounded = TripCommand.safeParse({ ...command, placeRef: cited % 7 });
      expect(grounded, "a grounded AddActivity was rejected").toMatchObject({ success: true });
      if (grounded.success && grounded.data.type === "AddActivity") {
        expect(grounded.data.placeRef).toBe(cited % 7);
      }
      cited += 1;
    }
    expect(cited, "no AddActivity was inspected").toBeGreaterThan(70);
  });

  it("appears on no command the fixture itself emits", () => {
    for (const command of seedCommands()) {
      expect(command, `${command.type} carries a placeRef`).not.toHaveProperty("placeRef");
    }
  });
});
