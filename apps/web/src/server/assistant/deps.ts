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
// rather than guessed at: `trip` (four read tools now — `search_places`
// region-biases on it), `actor` (the two that reach the library as somebody),
// `scope` (the day-scope fallback that a model must not be able to omit its way
// out of), the three per-turn collectors, and the three library ports. A key
// nothing needs is a key nothing can audit.
import { z } from "zod";
import type { PageNode, SavedDay, TripDetail } from "@tc/contracts";
import type { DiscoverDay } from "@/lib/playbooks";
import type { RawToolIntent } from "@/server/ai/batchResolver";
import type { AskScope } from "@/server/ai/context";
import type { BoundingBox } from "@/server/geocoding/geocoder";

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
 * The Playbook corpus, as much of it as one reader may see.
 *
 * **A port because the kernel reaches no database, and this is the hop that
 * proved a denylist cannot say so.** `search_playbooks` imported `discoverDays`
 * from `@/server/playbooks`, which imports `./db/client` — so the kernel was
 * already inside Postgres while the wall's five forbidden names all passed,
 * silently (ADR-043's 2026-09-10 correction; the wall is now deny-by-default
 * over `@/server/**` with an allowlist, and this port is what pays for it).
 *
 * It is narrow on purpose: the kernel names WHAT it needs — the days this
 * reader may see, ranked the way the library ranks them — and the adapter
 * (`server/ai/assistantPorts.ts`) knows how the corpus is queried, including
 * the visibility clause that must stay the apply door's. Widening this to
 * `DiscoverQuery` would move that clause back into the kernel.
 */
export interface PlaybookLibrary {
  discover(query: { cities: string[]; readerId: string }): Promise<readonly DiscoverDay[]>;
}

/**
 * One saved day, resolved as somebody — the read `insert_playbook_day` makes
 * before it collects.
 *
 * A port for the same reason and by the same hop: `readableSavedDay` lives in
 * `@/server/savedDays`, which imports `./db/client` (savedDays.ts:12). The
 * shape is `readableSavedDay`'s own, unchanged, because the guarantee is its
 * WHERE clause — *your own days plus anybody's published one* — and a port
 * that re-stated it would be the third copy ADR-042 Decision 2 forbids.
 */
export interface SavedDayLibrary {
  readable(savedDayId: string, readerId: string): Promise<SavedDay | null>;
}

/**
 * One place a vendor returned, normalised — never one a model wrote.
 *
 * It is `GeocodeResult` minus `canonicalName`'s name, and the rename is the
 * point: `name` here is what will be written onto a stop's `Location.name` if
 * the model cites it, so the field the tool prints and the field that commits
 * are the same field. A shape that printed one label and stored another would
 * make the approval card a claim about something the user did not see.
 */
export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
  countryCode?: string;
  city?: string;
  area?: string;
}

/**
 * What one query got, which is not always places.
 *
 * `skipped` is set when the lookup was never sent — the geocode ceiling was
 * reached mid-batch (KI-93), or the vendor was unreachable. It is a per-QUERY
 * fact rather than a per-CALL one because a five-query call can cross the
 * ceiling in the middle, and telling the model "nothing worked" when three
 * queries did would make it search again for places it already has.
 */
export interface PlaceLookup {
  query: string;
  places: readonly ResolvedPlace[];
  skipped?: "quota" | "unavailable";
}

/**
 * How the assistant looks a place up — the third library port, and the first
 * one that SPENDS.
 *
 * A port for the two reasons the other two are: the kernel's import wall
 * refuses `@/server/geocoding` (`getGeocoder()` reads `serverConfig` and
 * constructs the vendor adapter), and a tool may reach only what it declares.
 * It is also where the geocode quota is charged, which is the half KI-93 is
 * about — the charge belongs beside the lookup it is charging for, and a
 * kernel that could charge a quota would be a kernel that could read a
 * database.
 *
 * `userId` rides in the input rather than being closed over, because the
 * ceiling is per-user and the adapter is per-process.
 */
export interface PlaceSearchPort {
  search(input: {
    queries: readonly string[];
    /** Soft bias toward where the trip already is. Null on a trip with no coordinates yet. */
    region: BoundingBox | null;
    userId: string;
  }): Promise<readonly PlaceLookup[]>;
}

/**
 * One candidate, numbered — and the number is the whole of M9's grounding.
 *
 * `AddActivity.placeRef` is an index into this cache, so a place the model did
 * not search for has no number and therefore cannot be cited. That is the
 * guarantee `idFields.ts` already gives for UUIDs, extended to locations, and
 * it is structural rather than prompted: there is no spelling of "somewhere in
 * Shropshire" that resolves.
 *
 * 1-based, because the model reads the numbers in a printed list and a list
 * starting at 0 invites an off-by-one the schema cannot catch. (The contract
 * allows 0 — `nonnegative`, deliberately, so the numbering stays this file's
 * to choose.)
 */
export interface PlaceCandidate extends ResolvedPlace {
  ref: number;
}

/**
 * One turn's numbered candidates. Never shared between turns, for the same
 * reason a proposal buffer is not: a ref that outlived its turn would resolve
 * to a place from a different question.
 *
 * It is a collector, not a closure — see `ProposalBuffer` above for why that
 * distinction is worth a type.
 */
export interface PlaceCache {
  /** Number and keep these candidates, in order. Returns them as the model will see them. */
  add(places: readonly ResolvedPlace[]): readonly PlaceCandidate[];
  /** The candidate a `placeRef` cites, or null when nothing was searched under that number. */
  get(ref: number): PlaceCandidate | null;
  /** How many candidates this turn has numbered. */
  size(): number;
}

/** One turn's place cache. Never shared between turns. */
export function newPlaceCache(): PlaceCache {
  const candidates: PlaceCandidate[] = [];
  return {
    add: (places) => {
      const added = places.map((place, index) => ({ ...place, ref: candidates.length + index + 1 }));
      candidates.push(...added);
      return added;
    },
    // `?? null` rather than an index guard: `ref` arrives from a model and may
    // be any non-negative integer the schema admits, including one past the end
    // and including 0, which this numbering never issues.
    get: (ref) => candidates[ref - 1] ?? null,
    size: () => candidates.length,
  };
}

/**
 * What a turn asked for when it escalated, in the model's own words.
 *
 * `intendedChange` is the half that is worth keeping past the turn: an
 * escalation is a LABELLED CLASSIFIER MISS — the sentence, the wrong verdict,
 * and the model's own statement of what it should have been allowed to do.
 * That is the eval corpus KI-11 needs, written by real use rather than by hand,
 * and it is the reason this is a typed record rather than a boolean.
 */
export interface EscalationRequest {
  reason: string;
  intendedChange: string;
}

/**
 * Where an escalation lands — **once per turn, tracked here rather than in the
 * model's head**.
 *
 * A second call returns `false` and changes nothing. A latch in the prompt
 * ("only call this once") is a request; a latch in the collector is a fact, and
 * the difference matters because the thing being bounded is a charged step and
 * a tier upgrade.
 *
 * It is a collector for the same reason `ProposalBuffer` is: the tool runs
 * several SDK frames before anything downstream can read what it did, and a
 * closure would make "did this turn escalate?" a property of which builder
 * constructed the tool rather than a declared `needs`.
 */
export interface EscalationBuffer {
  /** Records the request. `false` if this turn has already escalated. */
  request(request: EscalationRequest): boolean;
  /** What the turn escalated with, or null if it did not. */
  escalated(): EscalationRequest | null;
}

/** One turn's escalation latch. Never shared between turns. */
export function newEscalationBuffer(): EscalationBuffer {
  let recorded: EscalationRequest | null = null;
  return {
    request: (request) => {
      if (recorded !== null) return false;
      recorded = { ...request };
      return true;
    },
    // A copy, so a reader cannot edit the turn's own record of why it escalated
    // — the same guarantee the other three collectors give.
    escalated: () => (recorded === null ? null : { ...recorded }),
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
  /** How `search_playbooks` reaches the library. */
  playbooks: PlaybookLibrary;
  /** How `insert_playbook_day` resolves the row it was handed. */
  savedDays: SavedDayLibrary;
  /** How `search_places` reaches the gazetteer — and the quota that bounds it. */
  placeSearch: PlaceSearchPort;
  /** Where `search_places` numbers what it found, for a `placeRef` to cite. */
  placeCache: PlaceCache;
  /** Where the escalation tool records that this turn was misclassified. */
  escalation: EscalationBuffer;
}

export type DepKey = keyof AssistantDeps;

/**
 * The keys that arrive on the AI SDK's per-tool-call context channel, as
 * against the ones a turn supplies when it builds its tool set.
 *
 * The split is where the values COME FROM, not a second permission system:
 * `needs` is still the whole of what a tool may reach. Ambient keys are the
 * request's own facts (`contextSchema` re-validates them on every call); the
 * rest are supplied when the tool set is BUILT, because there is nothing for a
 * schema to validate about them — a collector is an object with identity only
 * the turn can mint, and a library port is a function only the app's edge can
 * supply. Their lifetimes differ (a buffer is per-turn, a port is per-process)
 * and that is not what this split is about.
 */
export const AMBIENT_DEP_KEYS = ["trip", "actor", "scope"] as const;
export type AmbientDepKey = (typeof AMBIENT_DEP_KEYS)[number];
export type TurnDepKey = Exclude<DepKey, AmbientDepKey>;
export type TurnDeps = Pick<AssistantDeps, TurnDepKey>;

// A dep that is not ambient has to be listed here, or the adapter stops
// checking that a turn supplied it — silently, on exactly the tool that needs
// it most. Neither list is derivable from `AssistantDeps` at runtime, so the
// exhaustiveness is bought with a `Record<TurnDepKey, true>`: a further
// non-ambient key fails to compile until it appears below. (It said "a fifth"
// while there were four; M9's grounding added the sixth, and a count in a
// comment beside a list is a count that goes stale.)
//
// (The obvious spelling — `const _: Exclude<TurnDepKey, …>[] = []` — asserts
// nothing, because an empty array satisfies any element type. Measured.)
const TURN_DEP_KEY_SET: Record<TurnDepKey, true> = {
  proposalBuffer: true,
  pageBuffer: true,
  playbooks: true,
  savedDays: true,
  placeSearch: true,
  placeCache: true,
  escalation: true,
};
export const TURN_DEP_KEYS = Object.keys(TURN_DEP_KEY_SET) as readonly TurnDepKey[];

/**
 * Whether a dep key is one the turn supplies, as against one arriving on the
 * context channel — the runtime half of the split above. `registry.ts` uses it
 * to sort a definition's `needs` into its two sources.
 */
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
