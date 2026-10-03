import { z } from "zod";
import { boundedNote } from "./review.ts";
import { BatchableCommand } from "./trip.ts";

// Suggestions: a `suggester`'s board edits, held for an editor or the owner to
// accept or dismiss one change at a time (ADR-064, spec 2026-10-03).
//
// **Not events.** A pending suggestion is not planning state until someone
// accepts it, so it lives in its own CRUD tables and never on the trip's
// stream. Accepting one replays its commands through the ordinary pipeline
// with the reviewer as actor and `Origin` `{ kind: "suggestion" }` — that
// batch, and only that batch, is what the log records.
//
// Vocabulary: a *change* is one optimistic-queue unit — one gesture, which may
// be several commands (spec W1). A *suggestion* is the group of changes sent
// together, with an optional note.

export const SuggestionChangeStatus = z.enum(["pending", "accepted", "dismissed", "withdrawn"]);
export type SuggestionChangeStatus = z.infer<typeof SuggestionChangeStatus>;

/** Spec §4. Repeated by nothing yet; the storage task owns any CHECK. */
export const SUGGESTION_NOTE_MAX = 500;
export const SUGGESTION_UNITS_MAX = 100;
export const SUGGESTION_UNIT_COMMANDS_MAX = 50;

/** One change as served to its author or a reviewer. */
export const SuggestionChange = z.object({
  id: z.string().uuid(),
  suggestionId: z.string().uuid(),
  tripId: z.string().uuid(),
  authorId: z.string().min(1),
  // The suggestion's note, repeated on each of its changes so a change can be
  // rendered without its siblings.
  note: z.string().nullable(),
  createdAt: z.string(), // ISO 8601
  commands: z.array(BatchableCommand).min(1),
  // Written by the server at creation with the history panel's own wording
  // (spec W2), so the reviewer reads the sentence the log will carry.
  description: z.string(),
  status: SuggestionChangeStatus,
  // Earlier changes of the same suggestion this one needs: those whose
  // dry run created a day or stop this one references (spec W9), and, for a
  // date-range edit, those that changed the day count (W56). It cannot be
  // accepted before they are.
  dependsOn: z.array(z.string().uuid()),
  resolvedBy: z.string().min(1).nullable(),
  resolvedAt: z.string().nullable(), // ISO 8601
});
export type SuggestionChange = z.infer<typeof SuggestionChange>;

/**
 * `GET /api/trips/:id/suggestions` — role-scoped: a suggester gets their own
 * changes, an editor or the owner gets everyone's, and pending ones only (spec
 * W53). `rev` is the same value the events poll carries as `suggestionsRev`.
 */
export const TripSuggestionsResponse = z.object({
  changes: z.array(SuggestionChange),
  rev: z.string().min(1),
});
export type TripSuggestionsResponse = z.infer<typeof TripSuggestionsResponse>;

// Spec W3. Dismissing a warning is a judgement on the trip as it stands, and
// the conflict it names may not exist by the time anyone reviews the change.
// The client never offers Dismiss in suggest mode (it sits behind `readOnly`);
// this is the server's half, since this schema is what the route parses.
const SuggestionUnit = z
  .object({
    commands: z.array(BatchableCommand).min(1).max(SUGGESTION_UNIT_COMMANDS_MAX),
  })
  .superRefine((unit, ctx) => {
    unit.commands.forEach((command, i) => {
      if (command.type !== "DismissConflict") return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commands", i],
        message: "A suggestion cannot dismiss a conflict; only an editor can.",
      });
    });
  });

/**
 * `POST /api/trips/:id/suggestions` — a suggester's whole draft, in the order
 * it was made. Each unit becomes one change. A blank note reads as none.
 */
export const CreateSuggestionInput = z.object({
  units: z.array(SuggestionUnit).min(1).max(SUGGESTION_UNITS_MAX),
  note: boundedNote(SUGGESTION_NOTE_MAX).optional(),
});
export type CreateSuggestionInput = z.infer<typeof CreateSuggestionInput>;

/**
 * `POST /api/trips/:id/suggestions/changes/:changeId` (spec W14). Accept and
 * dismiss are a reviewer's; withdraw is the author's, while it is pending.
 */
export const ResolveSuggestionChangeInput = z.object({
  action: z.enum(["accept", "dismiss", "withdraw"]),
});
export type ResolveSuggestionChangeInput = z.infer<typeof ResolveSuggestionChangeInput>;
