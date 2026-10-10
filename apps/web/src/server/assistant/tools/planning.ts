// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand member becomes one `defineTool` call. Its input schema
// is that command's schema TRANSFORMED by the id-field manifest (idFields.ts)
// so the AI never handles a UUID: `type` is dropped (implied by the tool name);
// `inject` fields (tripId) are dropped (server-injected); `mint` fields (new
// ids) are dropped (server-generated); `ref` fields (an EXISTING
// day/activity/conflict) are swapped for a human `<entity>Ref`. A tool call
// records the model's raw intent only — resolveBatch (batchResolver.ts) turns
// the ordered batch into concrete commands in one batch-aware pass, then
// commitProposal submits them as ONE atomic batch (ADR-013).
//
// `defineTool` is the envelope and this loop is the body: a thirteenth
// BatchableCommand becomes a thirteenth tool with no hand edit here, and
// therefore a thirteenth entry in the registry — and, since P2, a thirteenth
// member of every grant that reaches `itinerary`/`propose`. There is no list of
// command names in this file and there must never be one.
//
// The loop is a pass-through, deliberately: wrapping these definitions in
// anything that alters a schema or a `run` would be the reimplementation
// ADR-022 §4 rules out. `hiddenFromModel` below is not that: the command schema
// and its validation are untouched, and only the model's view of it is shorter.
import { z } from "zod";
import { BatchableCommand, type BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { ID_FIELDS, refParamName, type IdRole } from "@/server/assistant/idFields";
import { defineTool, type AnyAssistantTool } from "@/server/assistant/defineTool";
import { untrusted } from "@/server/assistant/prompt";
import type { TaskClass } from "@/server/assistant/taskClass";

// How to WRITE a money amount is said once per turn, in the instruction
// (`handleAskRequest.ts`, on every posture that can write or escalate to
// writing), not here. It used to be appended to AddActivity, UpdateActivity and
// SetTripBudget, so an edit turn read it three times on top of the
// instruction's own rule, on every step (contextBudget.test.ts).

const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a new day to the trip (the server assigns its id).",
  RemoveDay: 'Remove an existing day (dayRef: "day N" or its dayId); its activities return to the backlog.',
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  SetTripName: "Rename the trip.",
  SetTripDates: "Set the trip's date range; the server reconciles day count to match it.",
  AddActivity: `Add a new activity; place it on a day via dayRef ("day N") or leave it in the backlog.`,
  UpdateActivity: `Update fields on an existing activity (activityRef — its title or id). Omitted fields are unchanged, except that a new kind clears the details only another kind may carry (pendingReason off pending; mode and endLocation off transit).`,
  MoveActivity:
    'Move an activity (activityRef) to a different day (dayRef: "day N", a dayId, or null/backlog) and position.',
  RemoveActivity: "Remove an activity from the trip (activityRef — its title or id).",
  DismissConflict:
    "Dismiss an active conflict by its number in the context's `conflicts` list (conflictRef: e.g. 1). Only conflicts shown there can be dismissed.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: `Set (or clear, with null) the trip's budget.`,
};

/**
 * **What the model is not shown of a stop's place** (ADR-022 amendment
 * 2026-10-03). A confirmed coordinate arrives through `placeRef`, which the
 * server turns into `{ lat, lng, precision: "venue" }` itself, and a
 * model-claimed `precision` is stripped by `groundCitedPlaces` regardless. A
 * coordinate the model writes is NOT simply discarded, though: enrichment uses
 * it as a search HINT (`resolveOne` centres the geocoder on it when it sits in
 * the trip's region) and keeps it as the FALLBACK pin, reported `unverified`,
 * when the lookup finds nothing. Hiding them is a measured trade, so it is made
 * per place (Mitchell, 2026-10-04, on CodeRabbit's #312 finding):
 *
 * - **`location` — hidden.** A stop has a verified path (`search_places` →
 *   `placeRef`), and a place that path cannot find is usually one the model
 *   does not know either; no pin is more honest than a guessed one there.
 * - **`endLocation` — `lat`/`lng` shown.** A transit leg's end has no
 *   `placeRef`, so the model's coordinate is its only fallback, and the ends
 *   are stations and airports a model mostly does know. ~120 tokens a step.
 *
 * `precision` is hidden on both: it is stripped from anything the model sends
 * regardless. `address` stays on both — it is how a place search cannot find
 * reaches the stop at all (the first live session's brewery). Everything here
 * is still accepted if sent.
 */
const HIDDEN_FROM_MODEL: Partial<Record<BatchableCommandType["type"], readonly string[]>> = {
  AddActivity: ["location.lat", "location.lng", "location.precision", "endLocation.precision"],
  UpdateActivity: ["location.lat", "location.lng", "location.precision", "endLocation.precision"],
};

/**
 * **Which planning commands a turn of each class is offered.**
 *
 * Absent from this map means every class, so a command earns a restriction and
 * never earns its way in — a new `BatchableCommand` member is offered
 * everywhere until somebody decides otherwise, which is the direction that
 * fails safe.
 *
 * **Only `plan` is narrowed, and now only by three commands.** A planning turn
 * is "fill out my days"; it has no business setting the trip's currency or
 * budget, or dismissing a conflict. Everything a plan might plausibly need is
 * kept, including both date commands — "plan me six days from March 3" is a
 * planning turn that has to set dates.
 *
 * **`SetTripName` was the fourth, and M9's KI-12 is why it is not.** This
 * comment used to end: *"A user who says 'plan me a trip and rename it to Japan
 * 2027' in one turn gets the plan and no rename… If it proves annoying, the fix
 * is to delete an entry here and nothing else."* It did not prove annoying; it
 * proved to be a **gate box**. KI-12 is *"the AI cannot leave a trip
 * half-planned"* — the headline flow finishing the job it advertises — and a
 * planning turn that cannot name the trip it just planned is precisely that
 * flow not finishing. The prediction was right and so was the remedy: one
 * deleted entry, and nothing else here.
 *
 * It does not, on its own, make a plan turn NAME anything. Being offered a tool
 * is not being told to use it; the instruction that does that lives in
 * `handleAskRequest.ts`, is conditioned on the trip being empty, and is why an
 * assistant does not rename a trip somebody has already put stops into (see
 * `TripStanding`).
 *
 * **What this does NOT claim.** Three fewer tools (17 -> 14) is a move within
 * the 10-30 band the published measurements call degraded, not out of it. The
 * larger lever would be the twelve-way command split itself, and that is
 * `@tc/contracts`' closed action space (ADR-015) — the property that makes the
 * model structurally unable to invent an operation — so it is not something to
 * trade away for a token count. This is the cut that costs nothing.
 *
 * **The dead end the fourth entry bought is still real for the other three**,
 * and still handled: the `propose` posture tells the model to say what it
 * cannot draft this turn and to ask again — the same branch a viewer's turn
 * uses — so a request to set a budget mid-plan degrades to one extra turn
 * rather than to a silent omission.
 */
const TASK_CLASSES_FOR: Partial<Record<BatchableCommandType["type"], readonly TaskClass[]>> = {
  SetTripCurrency: ["question", "edit", "compose"],
  SetTripBudget: ["question", "edit", "compose"],
  DismissConflict: ["question", "edit", "compose"],
};

const activityRefSchema = z
  .string()
  .min(1)
  .describe("An existing activity's exact title (as shown in the context) or its id.");

const conflictRefSchema = z
  .union([z.string(), z.number().int()])
  .describe("The conflict to dismiss, by its `ref` number in the context's `conflicts` list (e.g. 1). Never a raw conflict id.");

/**
 * What a `ref` day field is swapped for: a day as a person names one — "day 2",
 * a dayId, or the backlog.
 */
function dayRefSchema(backlog: "null" | "omit" | undefined): z.ZodTypeAny {
  const base = z
    .union([z.string(), z.number().int()])
    .nullable()
    .describe('A day as "day N" (1-based, e.g. "day 2"), a dayId, or "backlog"/null for the backlog.');
  // `omit` backlog fields are truly optional (a bare add = backlog); `null`
  // backlog fields must be stated (choose a day or the backlog).
  return backlog === "omit" ? base.optional() : base;
}

/**
 * The `ref` half of the id-field manifest: one field naming an EXISTING entity,
 * as the human reference the model is asked for in place of its id.
 */
function refSchemaFor(role: Extract<IdRole, { role: "ref" }>): z.ZodTypeAny {
  switch (role.entity) {
    case "activity":
      return activityRefSchema;
    case "day":
      return dayRefSchema(role.backlog);
    case "conflict":
      return conflictRefSchema;
  }
}

// Every write tool answers the same receipt, so the shape is stated once. It
// is a `literal(true)`, not a boolean: "queued" is the only thing a collect-only
// tool can truthfully say, and a schema that could also carry `false` would be
// a schema that admits a tool having done something.
//
// **Or the trip's refusal, as a result the model can act on** — the shape
// `insert_playbook_day` already answers with. A call the trip would refuse
// (an activity it does not have, a deleted trip) used to be told "queued" like
// any other, so the model went on as if it had worked and the proposal came
// back without it. Six writes on a deleted trip, each "queued", and nothing
// to show (2026-10-10).
const QueuedReceipt = z.union([
  z.object({ queued: z.literal(true), type: z.string() }),
  z.object({ error: z.string(), reason: z.string() }),
]);

const REFUSED =
  "Not queued: the trip refuses this change, for the reason given. Fix the call and try again, or tell the user why it can't be done.";

/**
 * One `BatchableCommand` member as one tool — the derivation ADR-015
 * invariant 5 requires, performed per command.
 *
 * The contract's own schema, with `type` and the server-supplied ids dropped
 * and each `ref` field swapped for a human reference, and a `run` that records
 * the model's raw intent in the turn's buffer. Nothing here names a command,
 * which is what makes the thirteenth one free.
 */
function planningToolFor(optionSchema: z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>): AnyAssistantTool {
  const type = optionSchema.shape.type.value as BatchableCommandType["type"];

  let schema = optionSchema.omit({ type: true, tripId: true }) as unknown as z.ZodObject<z.ZodRawShape>;
  for (const [field, role] of Object.entries(ID_FIELDS[type]) as [string, IdRole][]) {
    const drop = { [field]: true } as Record<string, true>;
    if (role.role === "mint") {
      schema = schema.omit(drop) as unknown as z.ZodObject<z.ZodRawShape>;
    } else if (role.role === "ref") {
      schema = schema
        .omit(drop)
        .extend({ [refParamName(role.entity)]: refSchemaFor(role) }) as unknown as z.ZodObject<z.ZodRawShape>;
    }
  }

  return defineTool({
    name: type,
    description: DESCRIPTIONS[type],
    domain: "itinerary",
    // Collect-only, and that is what `propose` means: the intent is recorded
    // and the loop ends. Nothing in the agent loop has a reachable path to an
    // event.
    effect: "propose",
    spend: "none",
    input: schema,
    output: QueuedReceipt,
    needs: ["proposalBuffer"] as const,
    minimumRole: "editor",
    taskClasses: TASK_CLASSES_FOR[type],
    hiddenFromModel: HIDDEN_FROM_MODEL[type],
    // The reason names what the model asked for and what the trip holds —
    // titles a collaborator wrote — so it reaches the model fenced, like every
    // other read of the trip. The instruction beside it is ours, and is not.
    taint: (result) => ("error" in result ? { ...result, reason: untrusted(result.reason) } : result),
    run: (args: Record<string, unknown>, deps) => {
      // Asked before collecting, and collected either way: a call that always
      // collects is what lets the ledger reconcile these calls by name
      // (askAnalytics.ts, `AskCollectedWrite`), and a refused intent is
      // dropped when the proposal is built, exactly as it always was.
      const refusal = deps.proposalBuffer.refusalOf({ type, args });
      deps.proposalBuffer.collect({ type, args });
      if (refusal !== null) {
        return { error: REFUSED, reason: refusal };
      }
      return { queued: true as const, type };
    },
  }) as unknown as AnyAssistantTool;
}

/**
 * One tool per `BatchableCommand` union member, keyed by type — MEASURED from
 * the contract rather than listed, which is what makes a thirteenth command a
 * thirteenth tool for free.
 *
 * Built once at module load rather than per turn. That is the second thing the
 * collector-as-dependency rule bought: with the collection injected, a
 * definition holds no per-turn state, so it is a constant.
 */
export const PLANNING_TOOLS: readonly AnyAssistantTool[] = (
  BatchableCommand.innerType().options as unknown as z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>[]
).map(planningToolFor);
