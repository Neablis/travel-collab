import { describe, expect, it } from "vitest";
import {
  CreateSuggestionInput,
  SUGGESTION_ACCEPT_MAX,
  SUGGESTION_NOTE_MAX,
  SUGGESTION_UNIT_COMMANDS_MAX,
  SUGGESTION_UNITS_MAX,
  type BatchableCommand,
} from "@tc/contracts";
import { japanTripCommandsFor, uuidFrom } from "@tc/factories";
import { MAX_ACCEPT_BODY_BYTES, MAX_SUGGESTION_BODY_BYTES } from "./http";

const tripId = uuidFrom(1, 910);

describe("MAX_SUGGESTION_BODY_BYTES", () => {
  // Spec W54. The route's 413 is proven in its int test; this is the other
  // half — the ceiling is not so low that a legitimate draft meets it.
  it("admits a draft at the contract's count limits made of the largest stop the app ships", () => {
    const largest = japanTripCommandsFor(tripId)
      .filter((c): c is Extract<BatchableCommand, { type: "AddActivity" }> => c.type === "AddActivity")
      .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0]!;
    // A multi-byte note, so the count is in bytes and not code units.
    const draft = {
      units: Array.from({ length: SUGGESTION_UNITS_MAX }, (_, u) => ({
        commands: Array.from({ length: SUGGESTION_UNIT_COMMANDS_MAX }, (_, c) => ({
          ...largest,
          activityId: uuidFrom(u * SUGGESTION_UNIT_COMMANDS_MAX + c, 911),
          dayId: uuidFrom(u, 912),
        })),
      })),
      note: "旅".repeat(SUGGESTION_NOTE_MAX),
    };
    expect(CreateSuggestionInput.safeParse(draft).success).toBe(true);

    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_SUGGESTION_BODY_BYTES);
  });
});

describe("MAX_ACCEPT_BODY_BYTES", () => {
  it("admits an accept of the most changes the contract allows", () => {
    const body = { changeIds: Array.from({ length: SUGGESTION_ACCEPT_MAX }, (_, i) => uuidFrom(i, 913)) };
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(MAX_ACCEPT_BODY_BYTES);
  });
});
