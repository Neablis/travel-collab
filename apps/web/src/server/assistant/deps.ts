// What a tool may reach, and the only way it reaches it (ADR-043 decision 1).
//
// Before this module every tool received the SAME ambient context under every
// tool name, whether it read any of it or not — so no tool's dependencies were
// legible from its definition, and nothing in the type system stopped a new
// tool reaching something it had no business reaching. `AssistantDeps` is the
// registry those keys index into; `defineTool`'s `needs` is what selects from
// it, and `run`'s second parameter is `Pick<AssistantDeps, Needs[number]>`, so
// reaching an undeclared dep is a compile error rather than a convention.
//
// The keys are what the tools that exist TODAY actually need, read off them
// rather than guessed at: `trip` (three read tools), `actor` (the two that
// reach the library as somebody), `scope` (the day-scope fallback that a model
// must not be able to omit its way out of), and the two per-turn collectors.
// A key nothing needs is a key nothing can audit.
import { z } from "zod";
import type { PageNode, TripDetail } from "@tc/contracts";
import type { RawToolIntent } from "@/server/ai/batchResolver";
import type { AskScope } from "@/server/ai/context";

/**
 * Who is asking, and about which trip.
 *
 * One value rather than two loose strings because it is one fact: identity
 * arrives at the tool boundary from the guard's answer, never from anything a
 * model can type (ADR-022 §3).
 */
export interface AssistantActor {
  tripId: string;
  userId: string;
}

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
 * What one turn's page tools produced: an ordered list of nodes to insert.
 *
 * **This replaces `ComposedPage`, and the inversion is the whole point.**
 * `compose_page` documented itself as "last compose wins — a page is one
 * document, not an append log", which was right for a one-shot box. It is
 * exactly wrong for a conversation: `ComposePanel`'s own header names the
 * problem ("a page that accumulated turns would have to decide what 'draft this
 * page' means the second time"), and the answer ADR-035 decision 5 gives is to
 * stop composing documents and start inserting into one. Every call counts, in
 * call order, and the second turn adds to the first instead of erasing it.
 */
export interface PageInserts {
  nodes: PageNode[];
}

/**
 * Where a planning write tool puts what the model asked for.
 *
 * **A collector is a dependency, not a closure.** This used to be an array
 * captured by `buildWriteTools()`, which is why that builder returned
 * `{ tools, getCollected, getInserts }` rather than tools — the thing a write
 * tool could reach that a read tool could not was implied by which builder had
 * constructed it. As a declared `needs: ["proposalBuffer"]` it is stated on the
 * tool instead, which is the first place the `needs` rule pays for itself.
 *
 * Handing back a COPY from `collected()`/`inserts()` rather than the live array
 * keeps the same guarantee the closure had: a reader cannot mutate a turn's
 * record of what the model asked for.
 */
export interface ProposalBuffer {
  collect(intent: RawToolIntent): void;
  collected(): RawToolIntent[];
  addInsert(insert: CollectedInsert): void;
  inserts(): CollectedInsert[];
}

/**
 * Where a page tool puts the nodes it wants inserted.
 *
 * The collector exists because the inserts leave on the stream's `finish` part
 * as message metadata, and by then the tool result is several SDK frames behind
 * — the same reason the proposal buffer collects. `run` still returns, so the
 * model sees its own result and can talk about what it added.
 */
export interface PageBuffer {
  insert(nodes: readonly PageNode[]): void;
  inserted(): PageInserts;
}

/** One turn's proposal collector. Never shared between turns. */
export function newProposalBuffer(): ProposalBuffer {
  const intents: RawToolIntent[] = [];
  const inserts: CollectedInsert[] = [];
  return {
    collect: (intent) => void intents.push(intent),
    collected: () => [...intents],
    addInsert: (insert) => void inserts.push(insert),
    inserts: () => [...inserts],
  };
}

/** One turn's page collector. Never shared between turns. */
export function newPageBuffer(): PageBuffer {
  const nodes: PageNode[] = [];
  return {
    insert: (inserted) => void nodes.push(...inserted),
    inserted: () => ({ nodes: [...nodes] }),
  };
}

/**
 * Everything any tool may reach. `defineTool`'s `needs` indexes into this and
 * nothing else, so "what can this tool touch?" is one line of its definition
 * and the set of answers is this interface.
 */
export interface AssistantDeps {
  /**
   * The trip the turn is about.
   *
   * It rides along rather than being re-fetched per tool call: `guard()` has
   * already read and PARSED it at the access seam, and a tool that fetched its
   * own copy could answer about a trip the guard never checked.
   */
  trip: TripDetail;
  /** Who is asking. The only way a tool learns an identity. */
  actor: AssistantActor;
  /**
   * What the turn is narrowed to. Here for the same reason `trip` is:
   * narrowing is a property of the turn, not something the model should be
   * able to talk its way out of by omitting a parameter.
   */
  scope: AskScope;
  /** The planning write tools' per-turn collector. */
  proposalBuffer: ProposalBuffer;
  /** The page tools' per-turn collector. */
  pageBuffer: PageBuffer;
}

export type DepKey = keyof AssistantDeps;

/**
 * The keys that arrive on the AI SDK's per-tool-call context channel, as
 * against the ones a turn supplies when it builds its tool set.
 *
 * The split is where the values COME FROM, not a second permission system:
 * `needs` is still the whole of what a tool may reach. Ambient keys are the
 * request's own facts (`contextSchema` re-validates them on every call);
 * the rest are objects with identity that only the turn can mint.
 */
export const AMBIENT_DEP_KEYS = ["trip", "actor", "scope"] as const;
export type AmbientDepKey = (typeof AMBIENT_DEP_KEYS)[number];
export type TurnDepKey = Exclude<DepKey, AmbientDepKey>;
export type TurnDeps = Pick<AssistantDeps, TurnDepKey>;

// A dep that is not ambient has to be listed here, or the adapter stops
// checking that a turn supplied it — silently, on exactly the tool that needs
// it most. Neither list is derivable from `AssistantDeps` at runtime, so the
// exhaustiveness is bought with a `Record<TurnDepKey, true>`: a sixth
// non-ambient key fails to compile until it appears below.
//
// (The obvious spelling — `const _: Exclude<TurnDepKey, …>[] = []` — asserts
// nothing, because an empty array satisfies any element type. Measured.)
const TURN_DEP_KEY_SET: Record<TurnDepKey, true> = { proposalBuffer: true, pageBuffer: true };
export const TURN_DEP_KEYS = Object.keys(TURN_DEP_KEY_SET) as readonly TurnDepKey[];

export function isTurnDepKey(key: DepKey): key is TurnDepKey {
  return (TURN_DEP_KEYS as readonly string[]).includes(key);
}

/**
 * The ambient half, as it crosses the AI SDK's context channel.
 *
 * `contextSchema` is validated on EVERY tool call (ai/dist:
 * validateToolContext), so re-running `TripDetail.parse` here would re-walk a
 * 68-activity document per call to re-check something `requireTripAccess`
 * already checked at the seam. The identity fields are checked because they
 * are what ADR-022 §3 is about; `detail` and `scope` are passed through.
 */
export interface AssistantContext {
  tripId: string;
  userId: string;
  detail: TripDetail;
  scope: AskScope;
}

export const AssistantContextSchema = z.object({
  tripId: z.string().uuid(),
  userId: z.string().min(1),
  detail: z.custom<TripDetail>((v) => typeof v === "object" && v !== null),
  scope: z.custom<AskScope>((v) => typeof v === "object" && v !== null),
});

/** The context channel's flat shape, keyed the way `needs` names it. */
export function ambientDepsFrom(context: AssistantContext): Pick<AssistantDeps, AmbientDepKey> {
  return {
    trip: context.detail,
    actor: { tripId: context.tripId, userId: context.userId },
    scope: context.scope,
  };
}
