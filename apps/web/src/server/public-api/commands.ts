import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { daySpan, isCalendarDate } from "@tc/domain";
import { BatchableCommand, TripCommand, type TripDetail } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch, executeTripCreation } from "@/server/commands";
import type { Actor } from "./actor";

// **Where a REST write becomes a planning command** (M22 Phase 4).
//
// **This is the cost the design said it could not eliminate, and it is real.**
// Everything cross-cutting is free forever — auth, scopes, validation, errors,
// pagination, rate limits, docs. Reads are close to free, because a projection
// DTO is already a contract. But `POST /v1/trips/:id/days` must BECOME an
// `AddDay`, and no wrapper can derive that: it is semantic, and it is one small
// mapping per write endpoint.
//
// What this module removes is everything AROUND the mapping — running it,
// translating a refusal into the v1 envelope, and pulling the affected resource
// back out of the result. The declaration keeps only the sentence that says
// which command this endpoint is.
//
// **The response is the affected resource, never the whole trip.** The BFF's
// command routes return the refreshed `TripDetail` *and* its history on every
// write, because the board re-renders from the mutation response. Publishing
// that shape would hand a third party a large payload they did not ask for and
// cannot opt out of, and would freeze a React re-render's needs as public
// contract. So a v1 write answers with the day, the stop or the trip it
// changed.

/**
 * A command as a HANDLER writes one — the schema's INPUT type.
 *
 * `z.input`, not `z.infer`, and the difference is the ergonomics this helper
 * exists for: `CreateTrip.forkedFrom` and `SetTripDates.newDayIds` carry
 * `.default()`s, so the output type demands fields a caller has no opinion
 * about. Taking the input type lets a declaration write the command it means and
 * lets zod supply the rest — while still failing to compile on a field that is
 * genuinely wrong.
 */
export type CommandInput = z.input<typeof TripCommand>;

/** A refusal the wrapper can turn into a response, or the trip as it now stands. */
export type WriteOutcome =
  | { ok: true; detail: TripDetail }
  | { ok: false; status: number; message: string };

/** A domain refusal as a `v1` status and message: 403, 409 for a lost race, 400 otherwise. */
export function refusal(error: { code: string; message: string }): WriteOutcome {
  // `forbidden` is the policy seam's word for "not a member, or not senior
  // enough". Everything else a command rejects is the caller's input — a day
  // that does not exist, a move to a position that is not there.
  if (error.code === "forbidden") {
    return { ok: false, status: 403, message: "You do not have access to this trip." };
  }
  // **Except the one refusal that is not about the request at all.** An append
  // that loses the optimistic-concurrency race is the caller being early, not
  // wrong, and it is the one refusal worth retrying verbatim. 400 told them to
  // change the request instead; `/api/trips/:id/commands`, its batch sibling
  // and the saved-days route have all answered 409 since M1.
  if (error.code === "concurrency-conflict") {
    return { ok: false, status: 409, message: error.message };
  }
  return { ok: false, status: 400, message: error.message };
}

/**
 * Run one command as this actor and hand back the trip it produced.
 *
 * **The role gate has already run** — `route()` resolved `trip: "path"` through
 * `tripAccessFor` before the handler was reached. The command pipeline checks
 * membership again through `memberRolePolicy`, which is not redundant: it is the
 * planning domain's own authority over which role may run which command
 * (`MINIMUM_ROLE`), and a route asking for `editor` is not the same statement as
 * a command declaring what it needs.
 */
export async function runCommand(actor: Actor, command: CommandInput): Promise<WriteOutcome> {
  const result = await executeTripCommand(command, actor.userId);
  return result.ok ? { ok: true, detail: result.detail } : refusal(result.error);
}

/**
 * Run several commands as one atomic batch.
 *
 * **What makes a REST `PATCH` honest over an event-sourced domain.** A patch
 * that touches a stop's title *and* its day is two commands internally, and they
 * must land together or not at all — which is exactly what the batch path
 * already is, and already what the browser uses when a drag both moves a stop
 * and retimes it. Any rejection appends nothing.
 *
 * So the atomicity a public `PATCH` promises is free rather than engineered, and
 * the API never has to leak that two commands were involved.
 */
export async function runBatch(actor: Actor, commands: CommandInput[]): Promise<WriteOutcome> {
  if (commands.length === 0) {
    return { ok: false, status: 400, message: "This patch changes nothing." };
  }
  if (commands.length === 1) return runCommand(actor, commands[0]!);
  const result = await executeTripCommandBatch(commands, actor.userId);
  return result.ok ? { ok: true, detail: result.detail } : refusal(result.error);
}

/**
 * Create a trip and run `then` against it, as one transaction.
 *
 * For an endpoint that makes a trip and fills it in the same request. A refusal
 * or a throw anywhere after the create rolls the create back too, so there is
 * no half — and no compensating delete for a caller to write
 * (KI-2026-09-19-b). `then` may be empty.
 */
export async function runCreation(
  actor: Actor,
  create: Extract<CommandInput, { type: "CreateTrip" }>,
  then: CommandInput[],
): Promise<WriteOutcome> {
  const result = await executeTripCreation(create, then, actor.userId);
  return result.ok ? { ok: true, detail: result.detail } : refusal(result.error);
}

/**
 * The contract check `runCommand`/`runBatch` will make, made early — for a
 * handler with something to spend before it runs the commands. A v1 stop write
 * geocodes first (ADR-007), and a travel leg on a non-transit stop (M24) is
 * refused by the schema alone, so checking afterwards charged a lookup for a
 * write that could never land.
 *
 * Throws the refusal the pipeline would have returned — same schema, same 400,
 * same message — and nothing when the commands parse. They are parsed again
 * when they run; this only moves the refusal earlier.
 */
export function refuseUnparseable(commands: CommandInput[]): void {
  if (commands.length === 0) return;
  const parsed =
    commands.length === 1 ? TripCommand.safeParse(commands[0]) : BatchableCommand.array().safeParse(commands);
  if (!parsed.success) throw new PublicApiError(400, parsed.error.message);
}

/** Throwable the wrapper turns into a response — see `PublicApiError` below. */
export class PublicApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** The envelope's machine-readable half — e.g. `{ currentVersion }` on a stale edit. */
  readonly details?: unknown;
  /**
   * The same request, sent again unchanged, may succeed — so an
   * `Idempotency-Key` must not keep this answer (ADR-051). Set only for a race
   * lost at the append with no caller precondition; a refusal the caller's own
   * request guarantees (a stale `expectedTripSeq`, a version pin) is not one.
   */
  readonly retryable?: true;

  constructor(status: number, message: string, code?: string, details?: unknown, options?: { retryable?: true }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = options?.retryable;
    this.name = "PublicApiError";
  }
}

/** Unwrap a write, or throw the refusal for `route()` to render. */
export function orThrow(outcome: WriteOutcome): TripDetail {
  if (outcome.ok) return outcome.detail;
  throw new PublicApiError(outcome.status, outcome.message);
}

/**
 * The command a `{ startDate?, endDate? }` pair becomes, or `undefined` when it
 * names neither. Shared by `PATCH /v1/trips/:id` and `POST /v1/trips`, so a
 * date means the same thing on both.
 *
 * `startDate` alone is `SetTripStartDate`; `endDate` (with or without
 * `startDate`) is `SetTripDates`, which also adds or drops days to match. That
 * is not the caller's business to know — it is why this mapping exists. An
 * `endDate` with no start date anywhere is left for the domain to refuse ("An
 * end date needs a start date."), so that refusal has one author.
 *
 * `current` is the trip as it stands: its start date and how many days it has.
 * A new trip is `{ startDate: null, dayCount: 0 }`.
 */
export function tripDatesCommand(
  tripId: string,
  patch: { startDate?: string | null; endDate?: string | null },
  current: { startDate: string | null; dayCount: number },
): CommandInput | undefined {
  if (patch.endDate !== undefined) {
    // **A field this patch did not mention keeps its value.** `SetTripDates`
    // takes both halves, so a `PATCH { endDate }` has to supply a start date —
    // and `?? null` supplied the wrong one, clearing a start date the caller
    // never asked about. `undefined` means "leave it", which is the trip's
    // current value; an explicit `null` still clears it.
    const startDate = patch.startDate === undefined ? current.startDate : patch.startDate;
    // **Shape is not calendar validity, and `daySpan` throws on the
    // difference.** The body schema takes a string; `parseIsoDateUtc` raises
    // `RangeError` for `"invalid"` and for shape-valid impossibles like
    // `2027-13-45`. Computing the span first put a throw in front of the
    // domain's own refusal, and the caller got a 500 for a request only they
    // could fix.
    //
    // `isCalendarDate` is the predicate `decide.ts` uses for the same reason
    // (KI-77), so this refuses exactly what the domain would. A regex on the
    // schema would not: `2027-13-45` matches it and still throws.
    for (const [field, value] of [
      ["startDate", startDate],
      ["endDate", patch.endDate],
    ] as const) {
      if (value !== null && !isCalendarDate(value)) {
        throw new PublicApiError(400, `"${field}" is not a calendar date.`);
      }
    }
    // **The ids the reconcile will need, minted here.** `SetTripDates`
    // reconciles the day COUNT to the range and the domain is pure, so it
    // cannot mint the uuids for days it has to append (Invariant 4) — it
    // refuses instead. Without these, a write that WIDENED a trip's dates was
    // a 400 a caller could do nothing about.
    //
    // The count is the same one `batchResolver` computes for the AI path, from
    // the same two numbers `decideTripCommand` reads.
    const needed =
      startDate === null || patch.endDate === null
        ? 0
        : Math.max(0, daySpan(startDate, patch.endDate) - current.dayCount);
    return {
      type: "SetTripDates",
      newDayIds: Array.from({ length: needed }, () => randomUUID()),
      tripId,
      startDate,
      endDate: patch.endDate,
    };
  }
  if (patch.startDate !== undefined) {
    return { type: "SetTripStartDate", tripId, startDate: patch.startDate };
  }
  return undefined;
}
