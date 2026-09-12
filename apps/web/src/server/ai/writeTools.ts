// The write half of the assistant (M9), offered on /ask beside the read tools.
//
// **The tools themselves moved to the assistant kernel** (ADR-043 decision 1):
// the derived family to `@/server/assistant/tools/planning` and ADR-042
// Decision 3's one hand-written tool to
// `@/server/assistant/tools/insertPlaybookDay`, each carrying the reasoning
// that earned it. What is left in this module is the two things that were
// always AROUND the tools rather than in them — P2 took the third,
// `WRITE_TOOL_NAMES`, which is now the `itinerary` and `library` domains
// granted at `propose` (assistant/grants.ts):
//
//   1. `buildProposal` — `resolveBatch` run over what the turn collected, said
//      in a sentence per change. Nothing is committed by it.
//   2. `commitProposal` — the ONE atomic batch (ADR-013), through the same
//      `enrichCommandLocations` → `flushPlanningBatch` path the command
//      endpoint uses, so approval is not a second door around KI-15. It is
//      also where an approved `{ savedDayId }` is re-read and expanded, and
//      where the adds ledger rides the batch's own transaction.
//
// The tools themselves stay COLLECT-ONLY, exactly as they already are on the
// command path: `run` pushes a raw intent into the turn's `proposalBuffer` and
// returns `{ queued: true }`. That is what makes "nothing commits without
// approval" structural rather than prompted — the agent loop has no reachable
// code path that writes an event. The only caller of `commitProposal` is the
// apply endpoint, and it runs after the human said yes.
import { randomUUID } from "node:crypto";
import {
  BatchableCommand,
  type AssistantProposal,
  type ProposedChange,
  type SavedDay,
  type TripDetail,
  type TripHistory,
} from "@tc/contracts";
import { getGeocoder, type Geocoder } from "@/server/geocoding";
import { insertCommands, readableSavedDay } from "@/server/savedDays";
import { addCounts, recordAdd } from "@/server/savedDayAdds";
import { resolveBatch, type RawToolIntent } from "@/server/ai/batchResolver";
import { flushPlanningBatch } from "@/server/ai/planningTools";
import {
  enrichCommandLocations,
  hasCityLevelLocations,
  hasUnverifiedLocations,
  type LocationEnrichmentReport,
} from "@/server/ai/geocodeEnrichment";
import { tripRegionOf } from "@/server/ai/geocodeRegion";
import { summarizeBatch } from "@/server/ai/planSummary";
import { REF_PARAM_NAMES } from "@/server/ai/idFields";
import type { AskDroppedCall } from "@/server/ai/askAnalytics";
import type { CollectedInsert } from "@/server/assistant/deps";

export type { RawToolIntent } from "@/server/ai/batchResolver";
export type { CollectedInsert } from "@/server/assistant/deps";

export { INSERT_PLAYBOOK_DAY } from "@/server/assistant/tools/insertPlaybookDay";

// `ProposedChange` and `AssistantProposal` are `@tc/contracts` types since P6
// (KI-22). They ride the stream's final chunk, so they are cross-boundary by
// construction and the reasoning that used to live here — why `inserts` travel
// by reference, why a proposal with nothing in it is not one, why `skipped`
// excludes `no-op` — moved WITH them to `packages/contracts/src/assistant.ts`
// rather than being restated on this side of the wire.

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
 * two cannot be written from here. Recorded in docs/known-issues/.
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
 * An insert, as the user reads it before deciding.
 *
 * `type: "AddDay"` because that is what an insert IS — a new day at the end of
 * the trip — and the field's whole job is letting a client group or icon a
 * change without parsing prose. `describeProposedChange` and `ID_FIELDS` stay
 * untouched (ADR-042's consequences): there is no command here to describe,
 * only a row, and the commands are minted at approval.
 *
 * The stop count is in the sentence because it is the one number that says how
 * big the yes is. "Add a day" and "add a day with eleven stops" are different
 * decisions.
 */
function describeProposedInsert(insert: CollectedInsert): ProposedChange {
  return {
    type: "AddDay",
    text: `Add “${insert.name}” from the library (${insert.stopCount} stop${insert.stopCount === 1 ? "" : "s"}) as a new day`,
  };
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
 * A created stop the model said nothing about defaults to `hold`, not the
 * domain's `planned` zero value (KI-86 addendum, Mitchell 2026-08-29 — "a new
 * activity is more likely to need booking than one that's already booked").
 *
 * **Why here and not `decide.ts` or the `AddActivity` contract schema.** Both
 * are shared with `@tc/fixtures`, which builds the canonical Japan trip
 * through these same commands — but always states `kind` explicitly per stop
 * (`commands.ts`), so a default placed upstream of resolution would recolor
 * every fixture stop the model never asked about into `hold` and undo KI-86's
 * tuning (3 of 14 Calendar days flagged, not 14). Defaulting here, on the
 * RESOLVED command, only reaches a real assistant-authored creation.
 *
 * `resolveBatch` (`batchResolver.ts`) is pinned to its current behaviour on
 * this branch, so this cannot live there either. It used to be the one seam
 * `/ask` and the older `/ai` command endpoint shared; `/ai` was deleted in
 * db5a5cb, so `/ask` is now the only caller.
 *
 * `UpdateActivity` is untouched: an omitted `kind` there means "unchanged"
 * (activity.ts), not "nothing was ever stated" — defaulting it would silently
 * flip an edit that never mentioned kind into one that does.
 */
export function withDefaultKind(command: BatchableCommand): BatchableCommand {
  if (command.type !== "AddActivity" || command.kind !== undefined) return command;
  return { ...command, kind: "hold" };
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
 * stands on its own prose. **An inserts-only turn is not that case** — a turn
 * whose one write call was `insert_playbook_day` resolves to zero commands by
 * construction, and returning `null` for it would produce no card at all for
 * the only thing the user asked for.
 *
 * Also where a created stop with no stated `kind` becomes `hold` rather than
 * `planned` — see `withDefaultKind`.
 *
 * This used to disagree with the older `/ai` command endpoint, which called
 * `resolveBatch` directly and so reached neither `withDefaultKind` nor
 * `withoutFabricatedCost` — the same model behaviour read as `hold` on one
 * door and `planned` on the other (KI-87). ADR-033 Decision 4 retired that
 * endpoint's planning surfaces, so there is no second creation path left to
 * disagree with: this function is now the only way a stop is created by a
 * model. Do not reintroduce one without moving both wrappers into
 * `resolveBatch` itself.
 */
export function buildProposal(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; actorId: string; mintId?: () => string; proposalId?: string },
  inserts: readonly CollectedInsert[] = [],
): AssistantProposal | null {
  if (intents.length === 0 && inserts.length === 0) return null;
  const { commands, errors } = resolveBatch(intents, detail, {
    tripId: opts.tripId,
    actorId: opts.actorId,
    ...(opts.mintId ? { mintId: opts.mintId } : {}),
  });
  if (commands.length === 0 && inserts.length === 0) return null;
  // Enforced, not requested — see `withoutFabricatedCost` and `withDefaultKind`.
  // Applied after resolution so each sees the parsed command, and before
  // `changes` so the card and the batch describe the same thing.
  const honest = commands.map(withoutFabricatedCost).map(withDefaultKind);
  return {
    proposalId: opts.proposalId ?? randomUUID(),
    changes: [
      ...honest.map((command) => describeProposedChange(command, detail)),
      ...inserts.map(describeProposedInsert),
    ],
    commands: honest,
    // `stopCount` is dropped on the way out: it was for the sentence above, and
    // the apply door reads the row rather than anything on this list.
    inserts: inserts.map(({ savedDayId, name }) => ({ savedDayId, name })),
    skipped: errors.filter((e) => e.code !== "no-op").map((e) => e.message),
  };
}

/**
 * The same `resolveBatch` dry run `buildProposal` runs, reduced to what a
 * tuning log needs: which write calls were dropped, and why — never the
 * commands or the prose, which is `buildProposal`'s job.
 *
 * A second `resolveBatch` pass over the same intents, not a reuse of
 * `buildProposal`'s: the analytics recorder's `finish()` fires from the
 * agent's `onEnd`, which runs before the stream's `finish` part does — the
 * moment `handleAskRequest`'s `messageMetadata` builds the actual proposal
 * (see the comment there). `resolveBatch` is a pure, in-memory dry run with
 * no I/O, so running it twice costs nothing worth avoiding; threading one
 * proposal object backward through a callback that fires first would cost
 * more than it saves.
 *
 * `no-op` is filtered out, the same way `buildProposal`'s `skipped` filters
 * it: a no-op is the domain correctly declining to do nothing, not a failure
 * to explain.
 */
export function droppedWriteCalls(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; actorId: string },
): AskDroppedCall[] {
  const { errors } = resolveBatch(intents, detail, opts);
  return errors
    .filter((e) => e.code !== "no-op")
    .map((e) => ({
      type: e.type,
      code: e.code,
      refs: refsOf(intents[e.index]),
      message: e.message,
    }));
}

// The human ref(s) the model supplied for one intent — e.g. `{ activityRef:
// "Nope" }` — as opposed to its literal fields (title, position, …). Reads
// `REF_PARAM_NAMES` rather than a hand-picked field list for the same reason
// `batchResolver` does: a new ref-bearing command joins this for free.
function refsOf(intent: RawToolIntent | undefined): Record<string, unknown> | null {
  if (!intent) return null;
  const entries = Object.entries(intent.args).filter(([key]) => REF_PARAM_NAMES.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
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
 *   0. **Every `{ savedDayId }` is RE-READ**, through `readableSavedDay` as the
 *      approving actor (ADR-042 Decision 1). This is not a formality and it is
 *      not the propose-time read repeated for tidiness: `/ask/apply` has no
 *      server-side proposal store, so nothing here can verify that a claimed
 *      insert corresponds to something a model proposed. Trusting the posted
 *      id would make board position client-mintable, which is the one thing
 *      the adds ledger exists to prevent. A hallucinated id, somebody else's
 *      private day and a day withdrawn since the proposal all fail closed as
 *      the same "no row" — the indistinguishability `savedDays.ts` records at
 *      length.
 *   1. **`enrichCommandLocations`.** The model is not trusted with coordinates
 *      and the geocoder is not trusted to overrule it (KI-15: unsupervised
 *      enrichment moved a Niagara Falls dinner to Shropshire and swallowed
 *      seven rate-limited lookups). Approval must not become a second door
 *      that skips it, so it runs here on exactly the same terms — region bias
 *      from the trip's already-geocoded activities, best-effort, and everything
 *      unverified reported.
 *   2. **`flushPlanningBatch`.** One `executeTripCommandBatch` call.
 *
 * **`geocoder` is resolved lazily, and that is an incident rather than a
 * style.** It used to be a `geocoder: Geocoder = getGeocoder()` default
 * parameter on the command endpoint — evaluated at call time whenever omitted,
 * which was every real request. `getGeocoder()` throws when LOCATIONIQ_API_KEY
 * is unset, so a deployment without that key could not compose a Notebook page:
 * a surface that touches no location data at all was broken by a lookup it
 * never needed. Hence the thunk: a batch with nothing to look up must never
 * construct one. The rule survives the endpoint (ADR-033 Decision 4) because
 * this is where /ask still enriches.
 */
/**
 * The one sentence describing places the geocoder could not corroborate.
 *
 * Extracted so the commit path and the REFUSAL path cannot drift into telling
 * a user two different stories about the same batch. Capped at three names
 * because the point is "go look at the map", not a manifest.
 */
function nameList(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length - Math.min(3, names.length);
  return `${shown}${rest > 0 ? `, and ${rest} more` : ""}`;
}

function unverifiedNotice(report: LocationEnrichmentReport): string {
  const names = [...report.unverified, ...report.failed, ...report.skipped];
  return `I couldn't verify ${names.length === 1 ? "the location" : "locations"} for ${nameList(names)} — worth checking on the map.`;
}

/**
 * The sentence for a stop that IS on the map, roughly.
 *
 * A second notice rather than a clause inside the first, because the two say
 * opposite things: `unverifiedNotice` is about stops that got no coordinates at
 * all, and this is about stops that got a city's. Folding them together is what
 * made the shipped copy wrong in the other direction — a stop with a city and
 * no pin was told to go "check it on the map", where there was nothing to check.
 *
 * It names the granularity rather than calling the pin bad. A city centroid is
 * not a wrong coordinate; it is a coordinate for a city, which is the whole
 * reason `Location.precision` stores the tier rather than a quality verdict.
 */
function cityLevelNotice(report: LocationEnrichmentReport, committed: boolean): string {
  const names = report.cityLevel;
  const one = names.length === 1;
  // **Past tense only when something actually happened.** On the refusal path
  // the batch committed nothing, so "that pin is approximate" describes a pin
  // that does not exist — the same species of claim-without-a-change this whole
  // branch is about, and it would be this endpoint making it. Raised by
  // CodeRabbit on PR 169.
  return committed
    ? `I could only place ${nameList(names)} at city level, so ${one ? "that pin is" : "those pins are"} approximate.`
    : `I could only resolve ${nameList(names)} to city level, and nothing was committed.`;
}

/**
 * Both sentences, in the order a reader wants them: what landed, then what did
 * not. `committed` is false on the refusal path, where nothing landed at all.
 *
 * `unverifiedNotice` needs no such split: "I couldn't verify the location for
 * X" is true whether or not the batch went on to commit.
 */
function enrichmentNotices(report: LocationEnrichmentReport, committed: boolean): string[] {
  return [
    ...(hasCityLevelLocations(report) ? [cityLevelNotice(report, committed)] : []),
    ...(hasUnverifiedLocations(report) ? [unverifiedNotice(report)] : []),
  ];
}

export async function commitProposal(
  tripId: string,
  commands: BatchableCommand[],
  actorId: string,
  detail: TripDetail,
  geocoder?: Geocoder,
  inserts: readonly { savedDayId: string }[] = [],
): Promise<{ ok: true; value: ProposalCommitResult } | { ok: false; error: { code: string; message: string } }> {
  const days: SavedDay[] = [];
  for (const { savedDayId } of inserts) {
    const saved = await readableSavedDay(savedDayId, actorId);
    if (saved === null) {
      return { ok: false, error: { code: "not-found", message: "That saved day does not exist." } };
    }
    days.push(saved);
  }

  const { commands: enriched, report } = await enrichCommandLocations(
    commands,
    () => geocoder ?? getGeocoder(),
    tripRegionOf(detail),
  );

  // `insertCommands` — the SAME exported function the manual "Add to a trip"
  // dialog goes through, so the two paths cannot disagree about what inserting
  // a day means. Appended AFTER enrichment on purpose: a saved day's stops were
  // located by whoever wrote them and by the importer's geocoder (ADR-041), the
  // manual path runs no enrichment over them, and putting this one through
  // LocationIQ would make the assistant's insert a different day than the
  // dialog's.
  const inserted = days.flatMap((day) => insertCommands(day, tripId));

  // ONE batch, with the ledger rows in its own transaction (ADR-013 + M11b).
  // Two calls would be two history entries and two undos for one approval; a
  // ledger write after the call returns would be a credit for a batch that
  // might have lost its optimistic-concurrency check.
  const batch = await flushPlanningBatch(
    tripId,
    [...enriched, ...inserted],
    actorId,
    days.length === 0
      ? undefined
      : async (tx) => {
          for (const day of days) {
            // `addCounts`, uncopied — the assistant's door and the manual
            // dialog's cannot disagree about who gets credited, which is the
            // whole reason the rule is one function and not two.
            if (!addCounts({ authorId: day.ownerId, actorId })) continue;
            await recordAdd(tx, {
              savedDayId: day.savedDayId,
              tripId,
              addedBy: actorId,
              createdAt: new Date(),
            });
          }
        },
  );
  // **The report reaches the user on BOTH paths, not just the happy one.**
  // It used to be read only after a successful commit, so an approval that the
  // enrichment step had quietly hollowed out answered with the domain's bare
  // "This change would have no effect." — a sentence about the user's request
  // that was really about a vendor lookup they could not see, could not
  // influence, and would hit identically on every retry (2026-09-12, prod).
  // The `sanitizeCoords` invariant in geocodeEnrichment.ts is what stops that
  // particular hollowing-out; this is what stops the NEXT one being silent.
  if (!batch.ok) {
    const why = enrichmentNotices(report, false);
    return {
      ok: false,
      error: why.length > 0
        ? { ...batch.error, message: `${batch.error.message} (${why.join(" ")})` }
        : batch.error,
    };
  }

  // Derived from what committed, so the sentence can never claim an edit the
  // batch did not make (planSummary.ts's whole design guarantee). Names resolve
  // against the PRE-change detail for the same reason they do there.
  const notices: string[] = enrichmentNotices(report, true);
  // The inserted days are named in their own sentence rather than folded into
  // `summarizeBatch`. Its phrasing is per command, and the day it adds is new —
  // so an eleven-stop insert would read as "added a day and added X to a day"
  // eleven times over, which says less than the one line the user approved.
  const summary = [
    ...(enriched.length > 0 ? [summarizeBatch(enriched, detail)] : []),
    // The name comes from the row this server just read, never from the
    // proposal the client posted back.
    ...days.map((day) => `Added “${day.name}” from the library.`),
  ].join(" ");
  return {
    ok: true,
    value: {
      message: notices.length > 0 ? `${summary} (${notices.join(" ")})` : summary,
      detail: batch.detail,
      history: batch.history,
    },
  };
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
 * Costs and kinds are put through `withoutFabricatedCost` and `withDefaultKind`
 * on the way in, so both guarantees hold at this door too and not only at the
 * one that built the proposal. A round-trip through `buildProposal` already
 * carries a stated `kind`, so this is defense in depth rather than the usual
 * path — the same relationship `withoutFabricatedCost` has here.
 */
export function parseApprovedCommands(
  value: unknown,
  tripId: string,
): { ok: true; commands: BatchableCommand[] } | { ok: false; error: string } {
  // An EMPTY list is accepted here and refused one level up. An inserts-only
  // approval carries no commands at all (ADR-042 Decision 1), so "at least one
  // change" is a question about the whole approval — commands and inserts
  // together — and only the caller can see both.
  if (!Array.isArray(value)) return { ok: false, error: "malformed change in this approval" };
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
    commands.push(withDefaultKind(withoutFabricatedCost(parsed.data)));
  }
  return { ok: true, commands };
}
