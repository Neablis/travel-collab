import { z } from "zod";
import { PageDoc } from "./pageDoc.ts";
import { BatchableCommand } from "./trip.ts";

// ---------------------------------------------------------------------------
// The `/ask` stream's envelope (KI-22, M9 Phase 0 P6).
//
// A turn's OUTCOME rides out on the stream's final chunk as the AI SDK's
// `messageMetadata`. Until this file existed it was an object literal in
// `handleAskRequest.ts` and a set of `typeof` guards in `apiClient.ts`, which
// is not a contract: it is two files agreeing, with nothing that fails when
// they stop. The key names and the `composeError` string cross the wire, so
// they live here (AGENTS.md invariant 5), the server builds against them and
// the client PARSES through them.
//
// Parse, not cast, and the reason is sharper than tidiness: `commands` go
// straight back to `/ask/apply` and `content` goes straight into the editor.
// This is the rule `defineTool`'s required `output` schema applies to tool
// results (KI-9), at the one boundary in the `/ask` path that P1–P5 left.
//
// **`simulated` is deliberately NOT a member of this union.** KI-22 named it
// as part of the old `/api/trips/:id/ai` envelope, and on `/ask` it is a
// response HEADER (`SIMULATED_HEADER` below) set before a byte of the stream —
// so a turn that fails mid-answer is still badged. A stream-metadata field
// rides the FINAL chunk, which on that failure path never arrives; folding
// `simulated` into this schema would reintroduce exactly the bug the header
// exists to prevent. What KI-22 was really complaining about is ownership, not
// transport, and the header's NAME gets the same treatment as the keys below.
// ---------------------------------------------------------------------------

/**
 * The header `/ask` sets on every turn, naming the `simulated` verdict on the
 * wire so the client stops deriving it from the model's own prose.
 *
 * Task 5's client matched the sentence "AI is switched off on this deployment"
 * to decide whether to show the Simulated badge, because the stream carried no
 * flag. That is a display concern derived from generated text — the same
 * anti-pattern `docs/milestones/M18-stop-kind.md` rejects for parsing `kind`
 * out of note text — and it breaks silently the first time the sentence is
 * reworded. A header is honest, is set on the same three lines that already
 * know the answer, and survives a turn that fails before it says anything.
 *
 * It is a constant and not a schema because there is nothing to parse: a
 * header value is `string | null`, the client compares it to `"true"`, and an
 * absent header reads `false` rather than "unknown" — an unbadged answer
 * claims a model wrote it, and that is the wrong way to be wrong. What it
 * needed was one owner. It had two: `handleAskRequest.ts` declared it and
 * `apiClient.ts` re-declared the same literal, with a comment saying it could
 * not import the server's copy (the UI may not import `@/server/*`). This file
 * is the third place both may import from.
 */
export const SIMULATED_HEADER = "x-tc-ai-simulated";

// Mitchell / the lead, 2026-09-24: users do not see raw provider text. `/ask`
// used to send `model call failed: <provider message>` on its 503 and the bare
// provider message as the stream's error chunk, and the rail printed both
// verbatim — a gateway's JSON, a rate-limit id, a stack-shaped string, all in
// the red line under the composer. The real cause is still recorded, with the
// error, by `recorder.abandon("error", err)` in `handleAskRequest.ts`; only the
// person reading the rail gets this sentence instead.
//
// Here rather than in `@/server/ai` because it crosses the wire and the UI may
// not import `@/server/*` — the same reason `SIMULATED_HEADER` above moved.
/**
 * What `/ask` tells the person when the model failed: the `error` of its 503
 * body when the turn could not start, and the text of the stream's `error`
 * chunk when it failed mid-answer. One fixed sentence on both paths; the
 * provider's own message never reaches the client.
 */
export const ASK_FAILED_MESSAGE = "The assistant couldn't answer just now. Try again in a moment.";

// The lead, 2026-09-24: `ASK_FAILED_MESSAGE` says "try again", which is true of
// a provider outage, a rate limit or a dropped connection and false of a bug
// in our own code — `buildProposal` throwing on the final chunk fails the same
// way on every retry. So a failure that did not come from the model, its
// provider or the network gets this sentence instead. Same rule as above: a
// fixed string, never the error's own text; the cause goes to the turn's
// `ai.ask` record.
/**
 * What `/ask` tells the person when the turn failed in OUR code rather than the
 * model's: the `error` of its 500 body, or the text of the stream's `error`
 * chunk. Deliberately does not suggest retrying.
 */
export const ASK_INTERNAL_ERROR_MESSAGE = "The assistant hit a problem on our side, and it has been logged.";

// Derived from `BatchableCommand`'s own options rather than spelled again, for
// the reason `describeProposedChange`'s exhaustive switch exists: a thirteenth
// command joins this for free and can never drift from the union it describes.
// `.innerType()` because the union carries the travel-leg refinement (trip.ts).
const COMMAND_TYPES = BatchableCommand.innerType().options.map((option) => option.shape.type.value) as [
  BatchableCommand["type"],
  ...BatchableCommand["type"][],
];

/**
 * One change, as the user reads it before deciding.
 *
 * `type` is the command type, so a client can group or icon them without
 * parsing prose; `text` is the server's own conditional-mood sentence — "Add
 * “Coffee at Fuglen” to day 2" — written where the commands are
 * (`writeTools.ts`) so the UI never has to interpret a command to describe one.
 * Nothing has happened yet, and the mood is the whole point.
 */
export const ProposedChange = z.object({
  type: z.enum(COMMAND_TYPES),
  text: z.string().min(1),
});
export type ProposedChange = z.infer<typeof ProposedChange>;

/**
 * A day the proposal would insert, BY REFERENCE (ADR-042 Decision 1) — never as
 * commands.
 *
 * The obvious implementation is to expand the day into `AddDay + AddActivity[]`
 * and let it ride `commands`. That silently bypasses the adds ledger:
 * `recordAdd` runs only inside an `alsoInSameTransaction` hook, so an
 * assistant-inserted day would never reach `saved_day_adds` and SPEC §15's *"a
 * build that counts raw inserts will produce a different and gameable order"*
 * would be exactly what we shipped.
 *
 * So the reference travels and the server expands it: the apply door re-reads
 * each row and mints the commands itself, which is what puts the insert through
 * the same code the manual "Add to a trip" dialog goes through. `name` is here
 * for the card and for nothing else — the door takes the name from the row,
 * because a ledger credit is not something a client may mint.
 */
export const ProposedInsert = z.object({
  savedDayId: z.string().min(1),
  name: z.string(),
});
export type ProposedInsert = z.infer<typeof ProposedInsert>;

/**
 * A turn's proposal: what WOULD change, said before it is true (M9).
 *
 * `commands` are the resolved, contract-parsed commands — the same objects the
 * apply endpoint re-parses and submits — so the batch that commits is the batch
 * that was REVIEWED, not a second resolution of the same intents against
 * different state. A command that has gone stale in the meantime aborts the
 * whole batch atomically (ADR-013) rather than applying a subset nobody saw.
 *
 * **Parsed all-or-nothing, on every field, and that is not symmetry for its own
 * sake.** `changes` — the sentences the card renders — and `skipped` are
 * SEPARATE server-provided arrays from `commands` and `inserts`. Dropping one
 * malformed entry from `inserts` while keeping its sentence in `changes` shows
 * the user "Add “A day in Kyoto” from the library" and then commits an approval
 * that no longer carries it; dropping a malformed `changes` entry is the same
 * mistake pointing the other way, a command approved with no sentence
 * describing it. A malformed entry anywhere makes the whole proposal fail to
 * parse, and the client renders no card.
 */
export const AssistantProposal = z
  .object({
    proposalId: z.string().min(1),
    changes: ProposedChange.array(),
    commands: BatchableCommand.array(),
    /**
     * A missing `inserts` is an empty one — a proposal drafted before this
     * field existed, or a turn that made no library call — but a
     * present-and-malformed one is not. Same for `skipped`.
     */
    inserts: ProposedInsert.array().default([]),
    /**
     * Changes the resolver dropped — the ones it could not match to this trip
     * — as sentences. `no-op` drops are excluded —
     * the domain simply had nothing to do, which is not something to warn
     * about. `droppedWriteCalls` filters it the same way.
     */
    skipped: z.string().array().default([]),
    /**
     * Why a proposal of more than one change is a card and not suggestions on
     * the board (ADR-067 decision 4): storing it was refused — the trip's open
     * suggestions are at their cap, say — so the turn falls back to ADR-022's
     * card and the user loses nothing. The card says this sentence. Absent on
     * every proposal that was never meant to be stored.
     */
    notSuggested: z.string().min(1).optional(),
  })
  // A proposal with nothing in it is not a proposal: there is nothing to
  // review, so the client renders no card and the answer stands on its own
  // prose. **An inserts-only turn is not that case** — a turn whose one write
  // call was `insert_playbook_day` resolves to zero commands by construction
  // (ADR-042 Decision 1), and refusing it would produce no card at all for the
  // only thing the user asked for. `buildProposal` returns `null` under exactly
  // this condition; stating it here is what keeps the two ends agreeing.
  .refine((proposal) => proposal.commands.length > 0 || proposal.inserts.length > 0, {
    message: "a proposal carries at least one command or one insert",
  });
export type AssistantProposal = z.infer<typeof AssistantProposal>;

/**
 * A planning turn of more than one change, stored as ONE suggestion on the
 * board instead of returned as a card (ADR-067 decision 4). Authored by the
 * person who asked, `via: "assistant"`, so the ghosts, the chip and *Accept
 * all* are its review — the chat only says where to look.
 *
 * `snapshotId` and `snapshotName` are the snapshot saved before it (decision
 * 6), or null when none was; `snapshotSkipped` then says why (the trip is at
 * its snapshot cap), in a sentence the chat can show as it stands.
 */
export const AssistantSuggested = z.object({
  suggestionId: z.string().uuid(),
  changeCount: z.number().int().positive(),
  snapshotId: z.string().uuid().nullable(),
  snapshotName: z.string().min(1).nullable(),
  snapshotSkipped: z.string().min(1).optional(),
  /**
   * The proposal's `skipped`, carried across: changes the resolver could not
   * match to this trip, as sentences. They are in no stored change, so the
   * chat note is the only place they are said. Defaulted, like the
   * proposal's, so an outcome from before this field still parses.
   */
  skipped: z.string().array().default([]),
});
export type AssistantSuggested = z.infer<typeof AssistantSuggested>;

/** One insert a page turn did not land: the widget's name (`text` for prose) and why. */
export const DroppedInsert = z.object({ name: z.string().min(1), reason: z.string().min(1) });
export type DroppedInsert = z.infer<typeof DroppedInsert>;

/**
 * What the stream's final chunk carries, and the only five shapes it may take.
 *
 * A proposal OR a page, never both: the two tool sets are disjoint server-side
 * — the page surface caps the `itinerary` domain at `read` and no other surface
 * grants `pages` at all (`assistant/grants.ts`) — so the scope that asked
 * decides which arrives. The union says so rather than leaving it to a
 * convention two files hold. A planning turn ends in `proposal` or
 * `suggested`, never both, by its command count (ADR-067 decisions 4 and 5).
 *
 * `{}` is the fifth shape and is a real one: a page-scoped turn that inserted
 * nothing is silence, not a failure — a turn can legitimately answer a question
 * about the page without editing it, which is most of what a conversation does.
 * A turn with no outcome at all sends no `messageMetadata` key instead.
 *
 * **The empty branch is strict and the other four are not, and the asymmetry
 * is load-bearing both ways.** A permissive `z.object({})` matches ANY object,
 * so `{ proposal: <garbage> }` would parse as "nothing" and the union would
 * accept every malformed payload rather than rejecting it — it would assert
 * nothing at all. The four payload branches are deliberately NOT strict for
 * the opposite reason: the stream is a superset the server may grow, and a key
 * added beside a valid `proposal` by a newer deployment must not cost an older
 * client the proposal. It strips the key and renders the card.
 *
 * That forward compatibility is not a hole on the producing side. The inferred
 * type is still exactly these five shapes, so a server literal with a sixth or
 * misspelled key fails to compile — the key set is pinned by the type, and the
 * parse is what protects the consumer.
 *
 * A reader that cannot parse a chunk drops it, exactly as it drops an unknown
 * stream part; an unreadable envelope must never break a conversation.
 */
const AskStreamShape = z.union([
  z.object({ proposal: AssistantProposal }),
  /**
   * A planning turn of more than one change, already stored as a suggestion
   * (ADR-067). The same turn never also carries `proposal`: storing it is what
   * replaced the card.
   */
  z.object({ suggested: AssistantSuggested }),
  /**
   * A planning turn that called write tools and had EVERY one refused when
   * resolved against the trip, so there is no proposal to show — with the
   * server's reason for each (deduplicated, never empty). Without it such a
   * turn ended on the model's own prose, which reads as if the changes were
   * made (2026-10-10: a deleted trip, three turns, nothing changed, no word why).
   */
  z.object({ notApplied: z.object({ skipped: z.array(z.string().min(1)).min(1) }) }),
  /**
   * What a `page`-scoped turn wants INSERTED. Validated server-side against the
   * macro registry before a byte leaves — which this side cannot see — so this
   * is the other half of the same rule, not a substitute for it.
   *
   * `PageDoc`, not `PageContent`, and the difference is the whole point:
   * `PageDoc` is what `CreatePageInput`/`UpdatePageInput` validate against since
   * ADR-038, so "a doc that would not survive a save never reaches the editor
   * either". Under `PageContent` — a doc node wrapping `z.array(z.unknown())` —
   * that sentence was true when it was written and stopped being true the moment
   * the write path got a real schema, because `PageContent` accepts documents
   * the write path now rejects.
   *
   * Inserted, not composed (ADR-035 decision 5). It carries no title because it
   * is not a whole page any more — a turn adds to the document the reader is
   * looking at, which is what lets a second turn mean something.
   */
  z.object({
    pageInserts: z.object({
      content: PageDoc,
      /**
       * What the turn asked for and did NOT get: a widget call refused and
       * never corrected, or a node the final check dropped. The rest of
       * `content` still lands — one bad widget no longer costs the batch
       * (KI-2026-09-26-r) — and the client says each of these out loud, because
       * the model's own sentence may claim it added them.
       */
      dropped: z.array(DroppedInsert).optional(),
    }),
  }),
  /**
   * A page turn whose assembled nodes failed validation, with the server's own
   * reason. The endpoint this replaced answered a bad doc with a 422; a stream
   * has already sent its 200, so the refusal rides out as data the client
   * renders — the nodes themselves still never reach it.
   */
  z.object({ composeError: z.string().min(1) }),
  /**
   * Silence. Strict at runtime for the reason above; typed
   * `Record<string, never>` rather than the `{}` zod infers, because `{}` is
   * assignable FROM every object — one `{}` member would make this whole union
   * accept any object, and a producer's `{ proposalTypo: ... }` would compile.
   * The transform is identity: this branch still parses `{}` and still rejects
   * `{ anything: 1 }`. Type only, and only here.
   */
  z.strictObject({}).transform((nothing): Record<string, never> => nothing),
]);

// Derived from the branches rather than spelled again. The empty branch is a
// transform and contributes no key, which is exactly what it means.
const OUTCOME_KEYS = AskStreamShape.options.flatMap((branch) =>
  branch instanceof z.ZodObject ? Object.keys(branch.shape) : [],
);

/**
 * One outcome per chunk.
 *
 * The union above says what a single outcome looks like; this says a chunk
 * carries one. Zod returns the FIRST branch that matches and a permissive
 * `z.object` strips what it does not name, so two recognised keys in one chunk
 * lose information silently: `{ proposal, composeError }` renders a card and
 * drops the server's refusal, and `{ proposal: <invalid>, composeError }` falls
 * through to the refusal — a valid sibling key hiding a broken one rather than
 * surfacing it. Our own `messageMetadata` cannot emit either today, because the
 * tool sets are disjoint; a contract that holds only while the producer is
 * correct is not the one KI-22 moved this here for.
 *
 * **Recognised keys only, and this must never become `.strict()`.** An
 * unrecognised key beside a single outcome is still stripped, deliberately —
 * that is the forward compatibility the docstring above defends. What is
 * narrowed here is ambiguity between the shapes this file already knows.
 */
export const AskStreamMetadata = z
  .unknown()
  .superRefine((chunk, ctx) => {
    // Not an object at all is the union's answer to give, with its own message.
    if (typeof chunk !== "object" || chunk === null) return;
    const outcomes = OUTCOME_KEYS.filter((key) => key in chunk);
    if (outcomes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a chunk carries one outcome, not ${outcomes.join(" and ")}`,
      });
    }
  })
  .pipe(AskStreamShape);
export type AskStreamMetadata = z.infer<typeof AskStreamMetadata>;
