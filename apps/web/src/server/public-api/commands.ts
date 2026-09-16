import type { z } from "zod";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
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

function refusal(error: { code: string; message: string }): WriteOutcome {
  // `forbidden` is the policy seam's word for "not a member, or not senior
  // enough". Everything else a command rejects is the caller's input — a day
  // that does not exist, a move to a position that is not there.
  if (error.code === "forbidden") {
    return { ok: false, status: 403, message: "You do not have access to this trip." };
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

/** Throwable the wrapper turns into a response — see `PublicApiError` below. */
export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

/** Unwrap a write, or throw the refusal for `route()` to render. */
export function orThrow(outcome: WriteOutcome): TripDetail {
  if (outcome.ok) return outcome.detail;
  throw new PublicApiError(outcome.status, outcome.message);
}
