import { randomUUID } from "node:crypto";
import { daySpan } from "@tc/domain";
import { z } from "zod";
import { Money, TripDetail } from "@tc/contracts";
import { orThrow, runBatch, runCommand, type CommandInput } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Pilot endpoint 2 of 2** (M22 Phase 2) — a single resource on one trip, so it
// is the one that exercises both gates: the token's trip confinement, then the
// unchanged member role check.
//
// `trip: "path"` is what buys all of that. The handler receives a `TripDetail`
// that is already loaded, already member-overlaid and already parsed, and the
// body of this endpoint is the word `trip`.
//
// **A deleted trip is 200 with `status: "deleted"`, not 404** — the same answer
// the BFF gives, and for the same reason: a caller can tell "gone" from "never
// existed", which is what makes a restore offerable. Only a genuinely unknown id
// 404s, and `tripAccessFor` is what encodes that.
export const { GET, PATCH, DELETE } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripDetail,
    // Non-null because `trip: "path"` is declared: the wrapper refuses the
    // request before reaching a handler whose trip it could not load.
    handle: ({ trip }) => trip!,
  },
  // **A PATCH is a PATCH** (Decision 14). Name, dates, currency and budget in
  // any combination — five commands behind one resource, and the caller never
  // learns there were five.
  //
  // **When more than one field moves, this composes a batch**, which is
  // all-or-nothing already and is what the browser uses when a drag both moves
  // a stop and retimes it. So the atomicity a public PATCH promises is free
  // rather than engineered.
  //
  // `startDate` alone is `SetTripStartDate`; `startDate` WITH `endDate` is
  // `SetTripDates`, which also adds or drops days to match. That is not the
  // caller's business to know — it is why this mapping exists.
  PATCH: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: z
      .object({
        name: z.string().min(1).max(200).optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        budget: Money.nullable().optional(),
      })
      .strict(),
    response: TripDetail,
    handle: async ({ actor, params, body, trip }) => {
      const patch = body as {
        name?: string;
        startDate?: string | null;
        endDate?: string | null;
        currency?: string;
        budget?: z.infer<typeof Money> | null;
      };
      const tripId = params["tripId"]!;
      const commands: CommandInput[] = [];
      if (patch.name !== undefined) commands.push({ type: "SetTripName", tripId, name: patch.name });
      if (patch.endDate !== undefined) {
        const startDate = patch.startDate === undefined ? trip!.startDate : patch.startDate;
        // **The ids the reconcile will need, minted here.** `SetTripDates`
        // reconciles the day COUNT to the range and the domain is pure, so it
        // cannot mint the uuids for days it has to append (Invariant 4) — it
        // refuses instead. This declaration supplied none, so every patch that
        // WIDENED a trip's dates was a 400 a caller could do nothing about:
        // the endpoint could shorten a trip and never lengthen one.
        //
        // The count is the same one `batchResolver` computes for the AI path,
        // from the same two numbers `decideTripCommand` reads.
        const needed =
          startDate === null || patch.endDate === null
            ? 0
            : Math.max(0, daySpan(startDate, patch.endDate) - trip!.days.length);
        commands.push({
          type: "SetTripDates",
          newDayIds: Array.from({ length: needed }, () => randomUUID()),
          tripId,
          // **A field this patch did not mention keeps its value.** `SetTripDates`
          // takes both halves, so a `PATCH { endDate }` has to supply a start
          // date — and `?? null` supplied the wrong one, clearing a start date
          // the caller never asked about. `undefined` means "leave it", which is
          // the trip's current value; an explicit `null` still clears it.
          startDate,
          endDate: patch.endDate,
        });
      } else if (patch.startDate !== undefined) {
        commands.push({ type: "SetTripStartDate", tripId, startDate: patch.startDate });
      }
      if (patch.currency !== undefined) {
        commands.push({ type: "SetTripCurrency", tripId, currency: patch.currency });
      }
      if (patch.budget !== undefined) {
        commands.push({ type: "SetTripBudget", tripId, budget: patch.budget });
      }
      return orThrow(await runBatch(actor, commands));
    },
  },
  // **A deleted trip is not gone.** `DELETE` is a soft delete the owner can undo
  // with `POST /restore`, which is why this answers with the trip rather than a
  // 204 — its `status` is now `"deleted"` and a caller can see that.
  DELETE: {
    scope: "trips:write",
    trip: "path",
    role: "owner",
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(await runCommand(actor, { type: "DeleteTrip", tripId: params["tripId"]! })),
  },
});
