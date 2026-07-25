// Resolves a batch of raw AI tool intents (human refs, no model-supplied UUIDs)
// into concrete BatchableCommands in ONE ordered, batch-aware pass.
//
// Why a single deferred pass instead of resolving inside each tool's execute():
// a command can reference an entity CREATED EARLIER IN THE SAME BATCH — "add a
// day, then put lunch on it". Resolving each call against the frozen pre-batch
// trip makes that new day invisible. So we walk the intents in emission order
// over a running projection: seeded from the real trip, then updated as each
// AddDay/AddActivity mints and registers a new entity, so a later "day N" or
// title ref sees it. The server owns every id — `inject` (tripId), `mint` (new
// day/activity ids), and `ref` (resolve a human ref to an existing id) — driven
// entirely by ID_FIELDS. Errors are per-command: a bad ref drops just that
// command (recorded in `errors`); the rest still form one atomic batch.
import { randomUUID } from "node:crypto";
import { BatchableCommand, type TripDetail } from "@tc/contracts";
import { activeConflicts } from "./context";
import { ID_FIELDS, REF_PARAM_NAMES, refParamName, type IdRole, type RefEntity } from "./idFields";

export interface RawToolIntent {
  type: BatchableCommand["type"];
  // Model-facing args: human refs (activityRef/dayRef) + literal fields
  // (title, position, …). New-entity ids are NOT here — the server mints them.
  args: Record<string, unknown>;
}

export interface BatchResolutionError {
  index: number;
  type: BatchableCommand["type"];
  message: string;
}

export interface ResolvedBatch {
  commands: BatchableCommand[];
  errors: BatchResolutionError[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

// Mutable projection of the trip as the batch builds it. Only the parts ref
// resolution needs: the ordered day-id list (for "day N"), a day-id set (for
// raw dayId refs), a title→ids index and id set for activities, and the
// existing conflict ids.
class BatchProjection {
  private readonly dayIds: string[];
  private readonly daySet: Set<string>;
  private readonly titleIndex = new Map<string, string[]>();
  private readonly activityIds: Set<string>;
  // 1-based conflict `ref` (as the envelope's `activeConflicts` numbers them) →
  // real conflict id. The model dismisses a conflict by its ref number, never
  // by the compound, content-derived id it is never shown.
  private readonly conflictIdByRef: Map<number, string>;

  constructor(detail: TripDetail) {
    this.dayIds = detail.days.map((d) => d.dayId);
    this.daySet = new Set(this.dayIds);
    this.activityIds = new Set(Object.keys(detail.activities));
    for (const [id, activity] of Object.entries(detail.activities)) this.indexTitle(activity.title, id);
    this.conflictIdByRef = new Map(activeConflicts(detail).map((c) => [c.ref, c.id]));
  }

  private indexTitle(title: string, id: string): void {
    const key = title.trim().toLowerCase();
    const existing = this.titleIndex.get(key);
    if (existing) existing.push(id);
    else this.titleIndex.set(key, [id]);
  }

  addDay(dayId: string): void {
    this.dayIds.push(dayId);
    this.daySet.add(dayId);
  }

  addActivity(activityId: string, title: unknown): void {
    this.activityIds.add(activityId);
    if (typeof title === "string") this.indexTitle(title, activityId);
  }

  // null = the backlog / "no day"; callers decide whether that's allowed.
  resolveDay(refVal: unknown): Resolved<string | null> {
    if (refVal === undefined || refVal === null) return { ok: true, value: null };
    if (typeof refVal === "number") return this.dayByNumber(refVal, String(refVal));

    const s = String(refVal).trim();
    if (s.toLowerCase() === "backlog") return { ok: true, value: null };
    if (UUID_RE.test(s)) {
      return this.daySet.has(s)
        ? { ok: true, value: s }
        : { ok: false, error: `No day with id ${s} exists on this trip.` };
    }
    const m = /^(?:day\s*)?(\d+)$/i.exec(s);
    if (!m) {
      return { ok: false, error: `Couldn't read “${refVal}” as a day. Use "day N" (1-based), a dayId, or "backlog".` };
    }
    return this.dayByNumber(Number(m[1]), `“${refVal}”`);
  }

  private dayByNumber(n: number, label: string): Resolved<string | null> {
    if (!Number.isInteger(n) || n < 1 || n > this.dayIds.length) {
      return { ok: false, error: `Day ${label} is out of range — this trip has ${this.dayIds.length} day(s).` };
    }
    return { ok: true, value: this.dayIds[n - 1]! };
  }

  resolveActivity(refVal: unknown): Resolved<string> {
    if (typeof refVal !== "string" || refVal.trim() === "") {
      return { ok: false, error: "An activity reference (title or id) is required." };
    }
    const s = refVal.trim();
    if (UUID_RE.test(s)) {
      return this.activityIds.has(s)
        ? { ok: true, value: s }
        : { ok: false, error: `No activity with id ${s} exists on this trip.` };
    }
    const matches = this.titleIndex.get(s.toLowerCase()) ?? [];
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

  // The model dismisses a conflict by its 1-based `ref` number from the
  // envelope's `conflicts` list (a number or its string form), resolved here to
  // the real id.
  resolveConflict(refVal: unknown): Resolved<string> {
    const n = typeof refVal === "number" ? refVal : Number(String(refVal).trim());
    if (!Number.isInteger(n)) {
      return { ok: false, error: `Couldn't read “${refVal}” as a conflict number. Use its ref from the context's conflicts list.` };
    }
    const id = this.conflictIdByRef.get(n);
    return id !== undefined
      ? { ok: true, value: id }
      : { ok: false, error: `No conflict #${n} in the context — only listed conflicts can be dismissed.` };
  }
}

export function resolveBatch(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; mintId?: () => string },
): ResolvedBatch {
  const { tripId, mintId = randomUUID } = opts;
  const projection = new BatchProjection(detail);
  const commands: BatchableCommand[] = [];
  const errors: BatchResolutionError[] = [];

  intents.forEach((intent, index) => {
    const spec = ID_FIELDS[intent.type];
    const command: Record<string, unknown> = { type: intent.type, tripId };

    // Copy every literal field the model supplied; the `<entity>Ref` params are
    // resolved below into their real id fields, so they never pass through raw.
    for (const [key, value] of Object.entries(intent.args)) {
      if (!REF_PARAM_NAMES.has(key)) command[key] = value;
    }

    let failed = false;
    for (const [field, role] of Object.entries(spec) as [string, IdRole][]) {
      if (role.role === "mint") {
        const id = mintId();
        command[field] = id;
        if (role.entity === "day") projection.addDay(id);
        else if (role.entity === "activity") projection.addActivity(id, command.title);
      } else if (role.role === "ref") {
        const resolved = resolveRef(projection, role.entity, intent.args[refParamName(role.entity)]);
        if (!resolved.ok) {
          errors.push({ index, type: intent.type, message: resolved.error });
          failed = true;
          break;
        }
        if (resolved.value === null) {
          // A "no day" ref: obey the field's backlog policy, or reject if it
          // has none (the command genuinely needs an existing day).
          if (role.backlog === "null") command[field] = null;
          else if (role.backlog !== "omit") {
            errors.push({
              index,
              type: intent.type,
              message: "This command needs a specific day, not the backlog.",
            });
            failed = true;
            break;
          }
          // "omit": leave the field unset (= backlog).
        } else {
          command[field] = resolved.value;
        }
      }
    }

    if (failed) return;

    // The single typed choke point: a resolved command becomes a domain command
    // only by PARSING against the contract, never an unchecked cast. A failure
    // means a ref resolver or the manifest has drifted from BatchableCommand —
    // record it like any other drop rather than pushing a malformed command.
    // `.parse` also strips stray keys, so what we collect is exactly the shape.
    const parsed = BatchableCommand.safeParse(command);
    if (parsed.success) commands.push(parsed.data);
    else errors.push({ index, type: intent.type, message: `Could not build a valid command: ${parsed.error.message}` });
  });

  return { commands, errors };
}

function resolveRef(projection: BatchProjection, entity: RefEntity, refVal: unknown): Resolved<string | null> {
  switch (entity) {
    case "day":
      return projection.resolveDay(refVal);
    case "activity":
      return projection.resolveActivity(refVal);
    case "conflict":
      return projection.resolveConflict(refVal);
  }
}
