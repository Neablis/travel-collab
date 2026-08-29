// The write half of the assistant (M9), offered on /ask beside the read tools.
//
// **Nothing here is a new tool.** The write tools ARE `buildPlanningTools()` —
// the family derived from `@tc/contracts` command schemas (ADR-015 invariant 5,
// ADR-022 §4: "M9's write tools return by wrapping that pipeline from inside
// the agent, not by reimplementing it"). This module adds three things around
// them and no fourth tool:
//
//   1. `WRITE_TOOL_NAMES`, measured from the built tool set rather than typed
//      out, so `minimumRoleFor` cannot fall behind a new BatchableCommand.
//   2. `buildProposal` — `resolveBatch` run over what the turn collected, said
//      in a sentence per change. Nothing is committed by it.
//   3. `commitProposal` — the ONE atomic batch (ADR-013), through the same
//      `enrichCommandLocations` → `flushPlanningBatch` path the command
//      endpoint uses, so approval is not a second door around KI-15.
//
// The tools themselves stay COLLECT-ONLY, exactly as they already are on the
// command path: `execute` pushes a raw intent and returns `{ queued: true }`.
// That is what makes "nothing commits without approval" structural rather than
// prompted — the agent loop has no reachable code path that writes an event.
// The only caller of `commitProposal` is the apply endpoint, and it runs after
// the human said yes.
import { randomUUID } from "node:crypto";
import { BatchableCommand, type TripDetail, type TripHistory } from "@tc/contracts";
import { getGeocoder, type Geocoder } from "@/server/geocoding";
import { resolveBatch, type RawToolIntent } from "@/server/ai/batchResolver";
import { buildPlanningTools, flushPlanningBatch } from "@/server/ai/planningTools";
import { enrichCommandLocations, hasUnverifiedLocations } from "@/server/ai/geocodeEnrichment";
import { boundingBoxAround, plausibleCoords, TRIP_REGION_MARGIN_KM } from "@/server/ai/geocodeRegion";
import { summarizeBatch } from "@/server/ai/planSummary";

export type { RawToolIntent } from "@/server/ai/batchResolver";

/**
 * The write tools, by name.
 *
 * MEASURED from the derived tool set, never listed: every `BatchableCommand`
 * member becomes one tool (planningTools.ts), so a thirteenth command joins
 * this array — and therefore `minimumRoleFor`'s editor branch — without anyone
 * remembering to. Typing the names out here would be the hand-written manifest
 * ADR-015 invariant 5 forbids, one level up.
 */
export const WRITE_TOOL_NAMES: readonly string[] = Object.keys(buildPlanningTools().tools);

/**
 * The tools handed to the agent for an editor's turn.
 *
 * A pass-through, deliberately: wrapping `buildPlanningTools()` in anything
 * that alters a schema or an `execute` would be the reimplementation ADR-022 §4
 * rules out. It exists as a named door so `handleAskRequest` reads as "read
 * tools plus write tools" rather than reaching into the command endpoint's
 * module.
 */
export function buildWriteTools(): ReturnType<typeof buildPlanningTools> {
  return buildPlanningTools();
}

/** One change, as the user reads it before deciding. */
export interface ProposedChange {
  /** The command type, so a client can group or icon them without parsing prose. */
  type: BatchableCommand["type"];
  /** "Add “Coffee at Fuglen” to day 2" — conditional mood; nothing has happened. */
  text: string;
}

/**
 * A turn's proposal: what WOULD change, said before it is true.
 *
 * `commands` are the resolved, contract-parsed commands — the same objects the
 * apply endpoint re-parses and submits — so the batch that commits is the batch
 * that was reviewed, not a second resolution of the same intents against
 * different state. A command that has gone stale in the meantime aborts the
 * whole batch atomically (ADR-013) rather than applying a subset nobody saw.
 */
export interface AssistantProposal {
  proposalId: string;
  changes: ProposedChange[];
  commands: BatchableCommand[];
  /**
   * Changes the resolver dropped, as sentences. `no-op` drops are excluded —
   * the domain simply had nothing to do, which is not something to warn about
   * (the same filter `handleAiRequest` applies).
   */
  skipped: string[];
}

/**
 * The past-tense receipt (`summarizeBatch`) is the command path's contract and
 * is exactly right AFTER a batch applies. A proposal is the same information in
 * a different mood, and the mood is the whole point: "Done — added a day" shown
 * above an Approve button claims the thing the button has not done yet.
 *
 * So this is a second phrasing, not a second source of truth: both read the
 * committed/candidate `BatchableCommand` objects and nothing else, and
 * `summarizeBatch` is still what the user is told after approval
 * (`commitProposal`). The duplication is real and deliberate —
 * `planSummary.ts`'s behaviour is pinned (ADR-022 §4, plan Constraint 1), so
 * the shared `describeCommand(command, detail, mood)` that would collapse the
 * two cannot be written from here. Recorded in docs/known-issues.md.
 *
 * The switch is exhaustive over `BatchableCommand["type"]` with no `default`,
 * so a thirteenth command fails to compile until someone words it.
 */
export function describeProposedChange(command: BatchableCommand, detail: TripDetail): ProposedChange {
  const activityTitle = (activityId: string): string => detail.activities[activityId]?.title ?? "an activity";
  const dayLabel = (dayId: string): string => {
    const index = detail.days.findIndex((d) => d.dayId === dayId);
    return index === -1 ? "a new day" : `day ${index + 1}`;
  };

  const text = ((): string => {
    switch (command.type) {
      case "AddDay":
        return "Add a day";
      case "RemoveDay":
        return `Remove ${dayLabel(command.dayId)}`;
      case "SetTripStartDate":
        return command.startDate === null ? "Clear the start date" : `Set the start date to ${command.startDate}`;
      case "AddActivity":
        return `Add “${command.title}” to ${command.dayId ? dayLabel(command.dayId) : "the backlog"}`;
      case "UpdateActivity":
        return `Update “${activityTitle(command.activityId)}”`;
      case "MoveActivity":
        return `Move “${activityTitle(command.activityId)}” to ${command.toDayId === null ? "the backlog" : dayLabel(command.toDayId)}`;
      case "RemoveActivity":
        return `Remove “${activityTitle(command.activityId)}”`;
      case "DismissConflict":
        return "Dismiss a conflict";
      case "SetTripCurrency":
        return `Set the currency to ${command.currency}`;
      case "SetTripBudget":
        return command.budget === null ? "Clear the budget" : "Set the budget";
      case "SetTripName":
        return `Rename the trip to “${command.name}”`;
      case "SetTripDates":
        return command.startDate !== null && command.endDate !== null
          ? `Set the trip dates to ${command.startDate} – ${command.endDate}`
          : "Set the trip dates";
    }
  })();

  return { type: command.type, text };
}

/**
 * **A price the model does not have is not zero.**
 *
 * `Money.amountMinor` is `nonnegative()`, so `0` parses — and the board renders
 * it as *free*, which is a confident wrong number where the truth is "nobody
 * knows yet". The 2026-08-02 dogfood run wrote `amountMinor: 0` on all nine
 * activities it planned.
 *
 * The system instruction forbids it, and an instruction is not an enforcement
 * mechanism: a live model can ignore every word of it. So the zero is removed
 * here, structurally, on both doors the assistant owns — the proposal it builds
 * and the approval it accepts back. M9's exit gate is "unknown reads as
 * unknown, not as `0`/free", and this is what makes that true of a model nobody
 * has met yet.
 *
 * **Dropping the key, never writing `null`.** On `AddActivity` an absent `cost`
 * IS "no cost" (contracts/activity.ts:110). On `UpdateActivity` an absent
 * `cost` means *unchanged* and `null` means *cleared* (activity.ts:126) — so
 * dropping leaves a real price the user typed alone, where `null` would delete
 * it on the strength of a number the model invented. An explicit `null` from
 * the model survives untouched: clearing a cost is a decision, not a guess.
 *
 * Only activity costs. `SetTripBudget`'s zero is a different claim ("this trip
 * has no budget") that the user, not the model, is normally making, and the
 * gate does not name it.
 */
export function withoutFabricatedCost(command: BatchableCommand): BatchableCommand {
  if (command.type !== "AddActivity" && command.type !== "UpdateActivity") return command;
  const { cost } = command;
  if (cost === undefined || cost === null || cost.amountMinor !== 0) return command;
  // A shallow copy with the key REMOVED, not set to undefined: `"cost" in
  // command` is the difference between "unchanged" and "explicitly nothing" on
  // UpdateActivity, and JSON.stringify would drop an undefined either way —
  // so the distinction has to be real on the object, not just on the wire.
  const rest: Record<string, unknown> = { ...command };
  delete rest.cost;
  return rest as unknown as BatchableCommand;
}

/**
 * Resolve what the turn collected into a reviewable proposal. Writes nothing.
 *
 * `resolveBatch` is used exactly as the command endpoint uses it — same
 * arguments, same dry-run against the guard's snapshot, same per-command drops
 * — because it is the piece that was attacked deliberately with a property test
 * and held. Reimplementing ref resolution for the approval path would be a
 * second, untested resolver disagreeing with the first.
 *
 * Returns `null` when the turn asked for nothing that survived resolution:
 * there is no proposal to review, so the client renders no card and the answer
 * stands on its own prose.
 */
export function buildProposal(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; actorId: string; mintId?: () => string; proposalId?: string },
): AssistantProposal | null {
  if (intents.length === 0) return null;
  const { commands, errors } = resolveBatch(intents, detail, {
    tripId: opts.tripId,
    actorId: opts.actorId,
    ...(opts.mintId ? { mintId: opts.mintId } : {}),
  });
  if (commands.length === 0) return null;
  // Enforced, not requested — see `withoutFabricatedCost`. Applied after
  // resolution so it sees the parsed command, and before `changes` so the card
  // and the batch describe the same thing.
  const honest = commands.map(withoutFabricatedCost);
  return {
    proposalId: opts.proposalId ?? randomUUID(),
    changes: honest.map((command) => describeProposedChange(command, detail)),
    commands: honest,
    skipped: errors.filter((e) => e.code !== "no-op").map((e) => e.message),
  };
}

export interface ProposalCommitResult {
  /** `summarizeBatch` — derived from the COMMITTED commands, never the model's prose. */
  message: string;
  detail: TripDetail;
  history: TripHistory;
}

/**
 * Commit an approved proposal as ONE atomic batch (ADR-013): one history
 * entry, one undo — never one command per tool call.
 *
 * The two steps are the command endpoint's own, in its order and for its
 * reasons:
 *
 *   1. **`enrichCommandLocations`.** The model is not trusted with coordinates
 *      and the geocoder is not trusted to overrule it (KI-15: unsupervised
 *      enrichment moved a Niagara Falls dinner to Shropshire and swallowed
 *      seven rate-limited lookups). Approval must not become a second door
 *      that skips it, so it runs here on exactly the same terms — region bias
 *      from the trip's already-geocoded activities, best-effort, and everything
 *      unverified reported.
 *   2. **`flushPlanningBatch`.** One `executeTripCommandBatch` call.
 *
 * `geocoder` is resolved lazily for the reason `handleAiRequest` documents at
 * length: `getGeocoder()` throws on a missing LOCATIONIQ_API_KEY, and a batch
 * with no location to look up must not need one.
 */
export async function commitProposal(
  tripId: string,
  commands: BatchableCommand[],
  actorId: string,
  detail: TripDetail,
  geocoder?: Geocoder,
): Promise<{ ok: true; value: ProposalCommitResult } | { ok: false; error: { code: string; message: string } }> {
  const { commands: enriched, report } = await enrichCommandLocations(
    commands,
    () => geocoder ?? getGeocoder(),
    tripRegionOf(detail),
  );

  const batch = await flushPlanningBatch(tripId, enriched, actorId);
  if (!batch.ok) return { ok: false, error: batch.error };

  // Derived from what committed, so the sentence can never claim an edit the
  // batch did not make (planSummary.ts's whole design guarantee). Names resolve
  // against the PRE-change detail for the same reason they do there.
  const notices: string[] = [];
  if (hasUnverifiedLocations(report)) {
    const names = [...report.unverified, ...report.failed, ...report.skipped];
    const shown = names.slice(0, 3).join(", ");
    const rest = names.length - Math.min(3, names.length);
    notices.push(
      `I couldn't verify ${names.length === 1 ? "the location" : "locations"} for ${shown}${rest > 0 ? `, and ${rest} more` : ""} — worth checking on the map.`,
    );
  }
  const summary = summarizeBatch(enriched, detail);
  return {
    ok: true,
    value: {
      message: notices.length > 0 ? `${summary} (${notices.join(" ")})` : summary,
      detail: batch.detail,
      history: batch.history,
    },
  };
}

function tripRegionOf(detail: TripDetail) {
  const points = Object.values(detail.activities)
    .map((a) => (a.location ? plausibleCoords(a.location) : null))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return boundingBoxAround(points, TRIP_REGION_MARGIN_KM);
}

/**
 * Parse commands posted back for approval.
 *
 * Two rules, and the second is the one worth stating:
 *
 *  1. Every command is re-parsed against the contract. This is the typed choke
 *     point `batchResolver` describes: a command becomes a domain command only
 *     by parsing, never by an unchecked cast.
 *  2. A `tripId` that disagrees with the URL is **rejected**, not silently
 *     rewritten to match. The sibling door — `POST /trips/:id/commands/batch`
 *     — already answers 400 "a command tripId does not match the URL", and two
 *     doors onto the same executor that disagree about what a mismatch MEANS is
 *     how one of them ends up being the wrong one. Rejecting is also strictly
 *     safer: re-stamping turns "this body is confused" into "this body is now
 *     about your trip", silently.
 *
 * Neither is the security boundary — an editor can already post arbitrary
 * commands to `/trips/:id/commands/batch`, so nothing here grants authority
 * they lack.
 *
 * Costs are put through `withoutFabricatedCost` on the way in, so the honest-
 * unknowns guarantee holds at this door too and not only at the one that built
 * the proposal.
 */
export function parseApprovedCommands(
  value: unknown,
  tripId: string,
): { ok: true; commands: BatchableCommand[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "an approval must carry at least one change" };
  }
  const commands: BatchableCommand[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "malformed change in this approval" };
    const parsed = BatchableCommand.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `malformed change in this approval: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    }
    if (parsed.data.tripId !== tripId) {
      return { ok: false, error: "a command tripId does not match the URL" };
    }
    commands.push(withoutFabricatedCost(parsed.data));
  }
  return { ok: true, commands };
}
