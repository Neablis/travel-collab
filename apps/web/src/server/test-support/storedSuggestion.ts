import { randomUUID } from "node:crypto";
import type { BatchableCommand } from "@tc/contracts";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";

// **A suggestion written straight to its tables, not through `createSuggestion`.**
//
// Three kinds of row cannot be made through the module, and tests of reading
// stored rows need each of them:
//   - one whose commands no longer parse, as a past release could have written
//     before a command left `BatchableCommand` (review of #308);
//   - one from long ago, for expiry, since `createSuggestion` stamps "now";
//   - many at once, for the caps, without a dry run per unit.
// Every change is pending and depends on nothing.

export type StoredSuggestion = {
  tripId: string;
  authorId: string;
  /** How many changes; one per unit. */
  changes?: number;
  createdAt?: Date;
  /** The commands of every change. A placeholder rename by default. */
  commands?: unknown[];
  /** `assistant` for a row an assistant turn stored (ADR-067). */
  via?: "assistant";
};

/** Insert one suggestion and its changes; answers the change ids, in position order. */
export async function insertStoredSuggestion({
  tripId,
  authorId,
  changes = 1,
  createdAt = new Date(),
  commands = [{ type: "SetTripName", tripId, name: "Stored" }],
  via,
}: StoredSuggestion): Promise<string[]> {
  const suggestionId = randomUUID();
  const ids = Array.from({ length: changes }, () => randomUUID());
  await db.insert(tripSuggestions).values({ id: suggestionId, tripId, authorId, note: null, baseSeq: 1, createdAt, via: via ?? null });
  await db.insert(tripSuggestionChanges).values(
    ids.map((id, position) => ({
      id,
      suggestionId,
      tripId,
      position,
      commands: commands as BatchableCommand[],
      description: "A stored change",
      dependsOn: [],
      status: "pending",
      createdAt,
    })),
  );
  return ids;
}

/** Commands a past release could have stored and today's `BatchableCommand` refuses. */
export const unparseableCommands = (tripId: string): unknown[] => [{ type: "RetiredCommand", tripId }];
