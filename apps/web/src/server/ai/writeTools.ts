// The write half of the assistant (M9), offered on /ask beside the read tools.
//
// **One tool here is not derived, and exactly one.** The rest ARE
// `buildPlanningTools()` — the family derived from `@tc/contracts` command
// schemas (ADR-015 invariant 5, ADR-022 §4: "M9's write tools return by
// wrapping that pipeline from inside the agent, not by reimplementing it").
// `insert_playbook_day` is hand-written, which ADR-042 Decision 3 permits on a
// narrow reading: it takes a `savedDayId` and nothing else, executes no
// command, and the commands it eventually becomes are minted SERVER-side by
// `insertCommands` at approval. So ADR-022's argument transfers unchanged —
// there is nothing for its schema to drift from. A hand-written write tool
// that carried command fields from the model is still forbidden.
//
// This module adds three things around the tools:
//
//   1. `WRITE_TOOL_NAMES`, measured from the built tool set rather than typed
//      out, so `minimumRoleFor` cannot fall behind a new BatchableCommand.
//   2. `buildProposal` — `resolveBatch` run over what the turn collected, said
//      in a sentence per change. Nothing is committed by it.
//   3. `commitProposal` — the ONE atomic batch (ADR-013), through the same
//      `enrichCommandLocations` → `flushPlanningBatch` path the command
//      endpoint uses, so approval is not a second door around KI-15. It is
//      also where an approved `{ savedDayId }` is re-read and expanded, and
//      where the adds ledger rides the batch's own transaction.
//
// The tools themselves stay COLLECT-ONLY, exactly as they already are on the
// command path: `execute` pushes a raw intent and returns `{ queued: true }`.
// That is what makes "nothing commits without approval" structural rather than
// prompted — the agent loop has no reachable code path that writes an event.
// The only caller of `commitProposal` is the apply endpoint, and it runs after
// the human said yes.
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { BatchableCommand, type SavedDay, type TripDetail, type TripHistory } from "@tc/contracts";
import { getGeocoder, type Geocoder } from "@/server/geocoding";
import { insertCommands, readableSavedDay } from "@/server/savedDays";
import { addCounts, recordAdd } from "@/server/savedDayAdds";
import { resolveBatch, type RawToolIntent } from "@/server/ai/batchResolver";
import { buildPlanningTools, flushPlanningBatch } from "@/server/ai/planningTools";
import { ReadContextSchema, type ReadToolContext } from "@/server/ai/readTools";
import { enrichCommandLocations, hasUnverifiedLocations } from "@/server/ai/geocodeEnrichment";
import { tripRegionOf } from "@/server/ai/geocodeRegion";
import { summarizeBatch } from "@/server/ai/planSummary";
import { REF_PARAM_NAMES } from "@/server/ai/idFields";
import type { AskDroppedCall } from "@/server/ai/askAnalytics";
import { MAX_PROPOSAL_INSERTS } from "@/server/ai/limits";

export type { RawToolIntent } from "@/server/ai/batchResolver";

/** ADR-042 Decision 3's one hand-written write tool. */
export const INSERT_PLAYBOOK_DAY = "insert_playbook_day";

/**
 * The write tools, by name.
 *
 * The derived family is still MEASURED, never listed: every `BatchableCommand`
 * member becomes one tool (planningTools.ts), so a thirteenth command joins
 * this array — and therefore `minimumRoleFor`'s editor branch — without anyone
 * remembering to. Typing those names out here would be the hand-written
 * manifest ADR-015 invariant 5 forbids, one level up.
 *
 * `INSERT_PLAYBOOK_DAY` is named because it is genuinely not derived from
 * anything (ADR-042 Decision 3). It is appended rather than replacing the
 * measurement, so the derived half keeps its property.
 */
export const WRITE_TOOL_NAMES: readonly string[] = [
  ...Object.keys(buildPlanningTools().tools),
  INSERT_PLAYBOOK_DAY,
];

/**
 * A day the turn asked to insert, resolved at PROPOSE time.
 *
 * `name` and `stopCount` ride along so the change sentence can be written
 * without a second read — and, more to the point, so the sentence the user
 * approves names the day the server actually found rather than whatever the
 * model called it.
 */
export interface CollectedInsert {
  savedDayId: string;
  name: string;
  stopCount: number;
}

/**
 * The whole of what the model may say about an insert.
 *
 * One field, and it names a row rather than describing one — which is the
 * narrow reading ADR-042 Decision 3 permits a hand-written write tool under.
 * No `tripId` (ADR-022 §3, and the trip arrives from the URL at apply), no day
 * position, no stop list: everything about WHAT gets inserted comes from
 * `insertCommands` reading the row.
 *
 * `.min(1)` rather than `.uuid()` on purpose. A malformed id is a
 * hallucination like any other, and `readableSavedDay` already answers every
 * flavour of unreachable — never existed, not yours, withdrawn, not even a
 * uuid — with the same "no row". Validating the shape here would tell the
 * model which kind of wrong it was.
 */
const InsertPlaybookDayInput = z.object({
  savedDayId: z
    .string()
    .min(1)
    .describe("The `savedDayId` of a day search_playbooks returned. Never write or guess one."),
});

/**
 * The tools handed to the agent for an editor's turn: the derived planning
 * family, plus `insert_playbook_day`.
 *
 * The derived half is a pass-through, deliberately — wrapping
 * `buildPlanningTools()` in anything that alters a schema or an `execute` would
 * be the reimplementation ADR-022 §4 rules out.
 *
 * **`insert_playbook_day` is collect-only like every other write tool**, and it
 * resolves the row it was handed before collecting. That read is not
 * decoration: a hallucinated or unreadable id fails HERE, at propose time, with
 * a message the model can act on in the same turn — rather than surfacing as a
 * 404 after the user has already clicked Approve on a card naming a day that
 * was never reachable. The apply door re-reads regardless (`commitProposal`);
 * this one is for the model, that one is the guarantee.
 */
export function buildWriteTools(): {
  tools: ReturnType<typeof buildPlanningTools>["tools"];
  getCollected: () => RawToolIntent[];
  getInserts: () => CollectedInsert[];
} {
  const planning = buildPlanningTools();
  const inserts: CollectedInsert[] = [];
  return {
    tools: {
      ...planning.tools,
      [INSERT_PLAYBOOK_DAY]: tool({
        description:
          "Propose adding a whole day from the playbook library to this trip — every stop it holds, in order, as a new day at the end. Pass a `savedDayId` that search_playbooks returned; never invent one, and propose at most ONE day per turn. Like every other change tool this only DRAFTS: the day is inserted when the user approves.",
        inputSchema: InsertPlaybookDayInput,
        contextSchema: ReadContextSchema,
        execute: async ({ savedDayId }, { context }) => {
          // The collector's own ceiling, so the cap holds on both sides of the
          // stream: `/ask/apply` refuses an over-cap approval (limits.ts), and a
          // turn cannot draft a card that would be refused. Refused as a tool
          // result rather than a throw — the model can read it and stop.
          if (inserts.length >= MAX_PROPOSAL_INSERTS) {
            return {
              error: `You have already queued ${MAX_PROPOSAL_INSERTS} playbook days, which is the most one proposal may carry. Stop and tell the user what you have drafted.`,
            };
          }
          const saved = await readableSavedDay(savedDayId, context.userId);
          if (saved === null) {
            return {
              error:
                "There is no playbook day with that id that you can open. Call search_playbooks and use a savedDayId from its results.",
            };
          }
          inserts.push({ savedDayId: saved.savedDayId, name: saved.name, stopCount: saved.stops.length });
          return { queued: true, name: saved.name, stopCount: saved.stops.length };
        },
      }),
    },
    getCollected: planning.getCollected,
    getInserts: () => inserts,
  };
}

/**
 * The context `insert_playbook_day` reads, under its own name — `toolsContext`
 * is keyed by tool, so a write tool with a `contextSchema` needs an entry of
 * its own beside `readToolsContext`'s.
 *
 * The same `ReadToolContext` the read tools take, and only `userId` is used:
 * the library is read as the actor, and the trip is not this tool's business.
 */
export function writeToolsContext(context: ReadToolContext): Record<string, ReadToolContext> {
  return { [INSERT_PLAYBOOK_DAY]: context };
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
   * Days to insert, BY REFERENCE (ADR-042 Decision 1) — never as commands.
   *
   * The obvious implementation is to expand the day into `AddDay +
   * AddActivity[]` here and let it ride `commands`. That silently bypasses the
   * adds ledger: `recordAdd` runs only inside an `alsoInSameTransaction` hook,
   * so an assistant-inserted day would never reach `saved_day_adds` and SPEC
   * §15's *"a build that counts raw inserts will produce a different and
   * gameable order"* would be exactly what we shipped.
   *
   * So the reference travels and the server expands it. `name` is here for the
   * card and for nothing else — the apply door re-reads the row and takes the
   * name from there, because a ledger credit is not something a client may
   * mint.
   */
  inserts: { savedDayId: string; name: string }[];
  /**
   * Changes the resolver dropped, as sentences. `no-op` drops are excluded —
   * the domain simply had nothing to do, which is not something to warn about.
   * `droppedWriteCalls` below filters it the same way.
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
