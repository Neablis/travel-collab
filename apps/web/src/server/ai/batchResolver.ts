// Resolves a batch of raw AI tool intents (human refs, no model-supplied UUIDs)
// into concrete BatchableCommands in ONE ordered, DOMAIN-ACCURATE pass.
//
// Why a deferred pass instead of resolving inside each tool's execute(): a
// command can reference an entity CREATED EARLIER IN THE SAME BATCH — "add a
// day, then put lunch on it". Resolving each call against the frozen pre-batch
// trip makes that new day invisible.
//
// Why a real TripState instead of a bespoke projection: refs also depend on what
// the batch REMOVES and MOVES. Day refs are positional ("day 2"), so a RemoveDay
// earlier in the batch renumbers every later day ref, and a RemoveActivity
// invalidates a later title ref. An append-only mirror got both silently wrong.
// So we hold the real TripState and advance it with the real decideTripCommand +
// evolveTrip — the same functions executeTripCommandBatch will run — which buys:
//   1. removals/moves reflected for later refs, with exact domain semantics;
//   2. a command the domain WOULD reject is dropped here, so one bad
//      sub-command can no longer abort the whole atomic batch downstream;
//   3. a `no-op` sub-command skipped exactly as the batch executor skips it.
// The server owns every id — `inject` (tripId), `mint` (new day/activity ids),
// `ref` (resolve a human ref to an existing id) — driven entirely by ID_FIELDS.
// Errors are per-command: a drop removes just that command (recorded in
// `errors`, with the domain's own rejection `code`); the rest still form one
// atomic batch.
import { randomUUID } from "node:crypto";
import { BatchableCommand, type TripDetail } from "@tc/contracts";
import { decideTripCommand, evolveTrip, hydrate, type TripState } from "@tc/domain";
import { activeConflicts } from "./context";
import { ID_FIELDS, REF_PARAM_NAMES, refParamName, type IdRole, type RefEntity } from "./idFields";

export interface RawToolIntent {
  type: BatchableCommand["type"];
  // Model-facing args: human refs (activityRef/dayRef) + literal fields
  // (title, position, …). New-entity ids are NOT here — the server mints them.
  args: Record<string, unknown>;
}

export interface BatchResolutionError {
  // The model's EMISSION position — kept stable so a caller can line an error
  // up with `meta.toolCalls` regardless of the order commands were resolved in.
  index: number;
  type: BatchableCommand["type"];
  // The domain rejection code (`no-op`, `day-not-found`, …) or a resolver code
  // (`unresolved-ref`, `invalid-command`). `no-op` is informational, not a
  // failure — callers should exclude it from user-facing "couldn't do that" counts.
  code: string;
  message: string;
  // When this drop was CAUSED by an earlier drop — the command that would have
  // created the entity this one references — the earlier command's emission
  // index. Without it a cascade reads as N unrelated failures.
  causeIndex?: number;
}

export interface ResolvedBatch {
  commands: BatchableCommand[];
  errors: BatchResolutionError[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

type ConflictRefMap = ReadonlyMap<number, string>;

// Ref lookups read the CURRENT state directly rather than maintaining parallel
// indices — that duplicated bookkeeping is exactly what drifted. A trip holds
// tens of entities and a batch tens of refs, so the rescan is free, and there
// is precisely one source of truth for what exists.
function resolveDay(state: TripState, refVal: unknown): Resolved<string | null> {
  if (refVal === undefined || refVal === null) return { ok: true, value: null };
  if (typeof refVal === "number") return dayByNumber(state, refVal, String(refVal));

  const s = String(refVal).trim();
  if (s.toLowerCase() === "backlog") return { ok: true, value: null };
  if (UUID_RE.test(s)) {
    return state.days.some((d) => d.dayId === s)
      ? { ok: true, value: s }
      : { ok: false, error: `No day with id ${s} exists on this trip at that point in the batch.` };
  }
  const m = /^(?:day\s*)?(\d+)$/i.exec(s);
  if (!m) {
    return { ok: false, error: `Couldn't read “${refVal}” as a day. Use "day N" (1-based), a dayId, or "backlog".` };
  }
  return dayByNumber(state, Number(m[1]), `“${refVal}”`);
}

function dayByNumber(state: TripState, n: number, label: string): Resolved<string | null> {
  if (!Number.isInteger(n) || n < 1 || n > state.days.length) {
    return {
      ok: false,
      error: `Day ${label} is out of range — this trip has ${state.days.length} day(s) at that point in the batch.`,
    };
  }
  return { ok: true, value: state.days[n - 1]!.dayId };
}

function resolveActivity(state: TripState, refVal: unknown): Resolved<string> {
  if (typeof refVal !== "string" || refVal.trim() === "") {
    return { ok: false, error: "An activity reference (title or id) is required." };
  }
  const s = refVal.trim();
  if (UUID_RE.test(s)) {
    return state.activities[s] !== undefined
      ? { ok: true, value: s }
      : { ok: false, error: `No activity with id ${s} exists on this trip at that point in the batch.` };
  }
  const key = s.toLowerCase();
  const matches = Object.entries(state.activities)
    .filter(([, a]) => a.title.trim().toLowerCase() === key)
    .map(([id]) => id);
  if (matches.length === 0) {
    return { ok: false, error: `No activity named “${refVal}”. Use its exact title (as shown in context) or its id.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `“${refVal}” matches ${matches.length} activities. Reference the one you mean by its exact id.`,
    };
  }
  return { ok: true, value: matches[0]! };
}

// Conflict ref numbering is PINNED to the pre-batch envelope: the model
// referenced the list it was shown, so it must not renumber as the batch changes
// which conflicts are active. Whether the conflict is STILL active when the
// dismissal is decided is decideTripCommand's call, not the ref map's.
function resolveConflict(byRef: ConflictRefMap, refVal: unknown): Resolved<string> {
  const n = typeof refVal === "number" ? refVal : Number(String(refVal).trim());
  if (!Number.isInteger(n)) {
    return { ok: false, error: `Couldn't read “${refVal}” as a conflict number. Use its ref from the context's conflicts list.` };
  }
  const id = byRef.get(n);
  return id !== undefined
    ? { ok: true, value: id }
    : { ok: false, error: `No conflict #${n} in the context — only listed conflicts can be dismissed.` };
}

function resolveRef(
  state: TripState,
  byRef: ConflictRefMap,
  entity: RefEntity,
  refVal: unknown,
): Resolved<string | null> {
  switch (entity) {
    case "day":
      return resolveDay(state, refVal);
    case "activity":
      return resolveActivity(state, refVal);
    case "conflict":
      return resolveConflict(byRef, refVal);
  }
}

function explain(
  error: BatchResolutionError,
  args: Record<string, unknown>,
  droppedTitles: Map<string, number>,
): BatchResolutionError {
  const ref = args[refParamName("activity")];
  if (typeof ref !== "string") return error;
  const causeIndex = droppedTitles.get(ref.trim().toLowerCase());
  if (causeIndex === undefined) return error;
  return {
    ...error,
    causeIndex,
    message: `${error.message} (The earlier change that would have created "${ref}" was itself skipped.)`,
  };
}

// Task 9 replaces this with the AddDay hoist. `index` is the model's emission
// position and stays attached to the intent through any reordering.
function orderIntents(intents: RawToolIntent[]): { intent: RawToolIntent; index: number }[] {
  return intents.map((intent, index) => ({ intent, index }));
}

export function resolveBatch(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; actorId: string; mintId?: () => string },
): ResolvedBatch {
  const { tripId, actorId, mintId = randomUUID } = opts;
  let state = hydrate(detail);
  const conflictIdByRef: ConflictRefMap = new Map(activeConflicts(detail).map((c) => [c.ref, c.id] as const));
  const commands: BatchableCommand[] = [];
  const errors: BatchResolutionError[] = [];
  // Titles an earlier DROPPED command would have created or renamed. A later ref
  // to one of them fails for a real reason ("No activity named X") that points at
  // the wrong thing — this lets the error name the actual cause.
  const droppedTitles = new Map<string, number>();

  for (const { intent, index } of orderIntents(intents)) {
    const spec = ID_FIELDS[intent.type];
    const command: Record<string, unknown> = { type: intent.type, tripId };

    // Copy every literal field the model supplied; the `<entity>Ref` params are
    // resolved below into their real id fields, so they never pass through raw.
    for (const [key, value] of Object.entries(intent.args)) {
      if (!REF_PARAM_NAMES.has(key)) command[key] = value;
    }

    let failure: { code: string; message: string } | undefined;
    for (const [field, role] of Object.entries(spec) as [string, IdRole][]) {
      if (role.role === "mint") {
        command[field] = mintId();
        continue;
      }
      if (role.role !== "ref") continue;
      const resolved = resolveRef(state, conflictIdByRef, role.entity, intent.args[refParamName(role.entity)]);
      if (!resolved.ok) {
        failure = { code: "unresolved-ref", message: resolved.error };
        break;
      }
      if (resolved.value === null) {
        // A "no day" ref: obey the field's backlog policy, or reject if it has
        // none (the command genuinely needs an existing day).
        if (role.backlog === "null") command[field] = null;
        else if (role.backlog !== "omit") {
          failure = { code: "unresolved-ref", message: "This command needs a specific day, not the backlog." };
          break;
        }
        // "omit": leave the field unset (= backlog).
      } else {
        command[field] = resolved.value;
      }
    }

    if (failure === undefined) {
      // The typed choke point: a resolved command becomes a domain command only
      // by PARSING against the contract, never an unchecked cast. A failure means
      // a ref resolver or the manifest has drifted from BatchableCommand.
      // `.parse` also strips stray keys, so what we collect is exactly the shape.
      const parsed = BatchableCommand.safeParse(command);
      if (!parsed.success) {
        failure = { code: "invalid-command", message: `Could not build a valid command: ${parsed.error.message}` };
      } else {
        // Dry-run the SAME decision executeTripCommandBatch will make. A
        // rejection here would have aborted the whole atomic batch downstream;
        // dropping it now keeps every other command applicable.
        const decision = decideTripCommand(state, parsed.data, { actorId });
        if (decision.ok) {
          for (const event of decision.events) state = evolveTrip(state, event);
          commands.push(parsed.data);
          continue;
        }
        failure = decision.rejection;
      }
    }

    errors.push(explain({ index, type: intent.type, code: failure.code, message: failure.message }, intent.args, droppedTitles));
    // Recorded AFTER explain(), so a command that both references and sets the
    // same title can never be cited as its own cause.
    const title = typeof intent.args.title === "string" ? intent.args.title.trim().toLowerCase() : undefined;
    if (title !== undefined && !droppedTitles.has(title)) droppedTitles.set(title, index);
  }

  return { commands, errors };
}
