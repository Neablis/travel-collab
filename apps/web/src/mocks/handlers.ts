import { HttpResponse, http } from "msw";
import { BatchableCommand, TripCommand, type TripDetail, type TripHistory } from "@tc/contracts";

type GeocodeResult = { lat: number; lng: number; canonicalName: string; countryCode?: string };

// Deliberately naive state transitions — just enough for UI development and
// component tests. The real semantics live in @tc/domain, which UI-side code
// (including these mocks) may not import (lint wall).
function deriveMockDayDates(startDate: string | null, count: number): (string | null)[] {
  if (startDate === null) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => {
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}
function rederiveDates(detail: TripDetail): void {
  const dates = deriveMockDayDates(detail.startDate, detail.days.length);
  detail.days.forEach((day, i) => (day.date = dates[i]!));
}

// Deliberately naive rollup — the mock stands in for the projection
// (`packages/domain` may not be imported here, per the UI/server lint wall).
function rerollup(detail: TripDetail): void {
  const costOf = (id: string): number => detail.activities[id]?.cost?.amountMinor ?? 0;
  detail.days.forEach((day) => (day.costSubtotal = day.activityIds.reduce((s, id) => s + costOf(id), 0)));
  detail.unscheduledCostSubtotal = detail.backlog.reduce((s, id) => s + costOf(id), 0);
  detail.tripCostTotal = detail.days.reduce((s, d) => s + d.costSubtotal, 0) + detail.unscheduledCostSubtotal;
  detail.budgetRemaining = detail.budget ? detail.budget.amountMinor - detail.tripCostTotal : null;
  detail.conflicts = detail.conflicts.filter((c) => c.kind !== "over-budget");
  if (detail.budget && detail.tripCostTotal > detail.budget.amountMinor) {
    detail.conflicts.push({
      id: `over-budget:${detail.tripId}`, kind: "over-budget", severity: "warn",
      subjects: [detail.tripId], description: "Trip total exceeds the budget.",
      resolutions: ["Raise the budget", "Remove or reduce a cost"],
    });
  }
}

function applyMock(detail: TripDetail, command: TripCommand): TripDetail {
  const next = structuredClone(detail);
  switch (command.type) {
    case "AddDay":
      next.days.push({ dayId: command.dayId, activityIds: [], date: null, costSubtotal: 0 });
      rederiveDates(next);
      rerollup(next);
      break;
    case "RemoveDay": {
      const day = next.days.find((d) => d.dayId === command.dayId);
      next.backlog.push(...(day?.activityIds ?? []));
      next.days = next.days.filter((d) => d.dayId !== command.dayId);
      rederiveDates(next);
      rerollup(next);
      break;
    }
    case "SetTripStartDate":
      next.startDate = command.startDate;
      rederiveDates(next);
      break;
    case "AddActivity":
      next.activities[command.activityId] = {
        activityId: command.activityId,
        title: command.title,
        timeWindow: command.timeWindow ?? null,
        location: command.location ?? null,
        notes: command.notes ?? null,
        anchors: command.anchors ?? [],
        cost: command.cost ?? null,
      };
      if (command.dayId !== undefined) {
        next.days.find((d) => d.dayId === command.dayId)?.activityIds.push(command.activityId);
      } else {
        next.backlog.push(command.activityId);
      }
      rerollup(next);
      break;
    case "MoveActivity": {
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      const list =
        command.toDayId === null
          ? next.backlog
          : next.days.find((d) => d.dayId === command.toDayId)?.activityIds;
      list?.splice(Math.min(command.position, list.length), 0, command.activityId);
      rerollup(next);
      break;
    }
    case "UpdateActivity": {
      const activity = next.activities[command.activityId];
      if (activity !== undefined) {
        if (command.title !== undefined) activity.title = command.title;
        if (command.timeWindow !== undefined) activity.timeWindow = command.timeWindow;
        if (command.location !== undefined) activity.location = command.location;
        if (command.notes !== undefined) activity.notes = command.notes;
        if (command.anchors !== undefined) activity.anchors = command.anchors;
        if (command.cost !== undefined) activity.cost = command.cost;
      }
      rerollup(next);
      break;
    }
    case "RemoveActivity":
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      delete next.activities[command.activityId];
      rerollup(next);
      break;
    case "DismissConflict":
      next.dismissedConflictIds = [...next.dismissedConflictIds, command.conflictId].sort();
      break;
    case "SetTripCurrency":
      next.currency = command.currency;
      break;
    case "SetTripBudget":
      next.budget = command.budget;
      rerollup(next);
      break;
    case "UndoLastChange":
    case "RedoChange":
    case "RevertToState":
      break; // accepted no-ops in mocks; component tests assert via onCommand
    case "CreateTrip":
      break;
  }
  return next;
}

export function makeTripHandlers(
  initial: TripDetail,
  options?: {
    history?: TripHistory;
    detailAt?: Record<number, TripDetail>;
    onCommand?: (command: TripCommand) => void;
    geocode?: GeocodeResult[];
  },
) {
  let detail = structuredClone(initial);
  return [
    http.get("/api/trips/:tripId", ({ params }) =>
      params.tripId === detail.tripId
        ? HttpResponse.json({ trip: detail })
        : HttpResponse.json({ error: "not-found" }, { status: 404 }),
    ),
    http.post("/api/trips/:tripId/commands", async ({ request }) => {
      const command = TripCommand.parse(await request.json());
      options?.onCommand?.(command);
      detail = applyMock(detail, command);
      return HttpResponse.json({
        ok: true,
        tripId: detail.tripId,
        detail,
        history:
          options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
      });
    }),
    http.post("/api/trips/:tripId/commands/batch", async ({ request }) => {
      const body = (await request.json()) as { commands: unknown[] };
      const commands = body.commands.map((c) => BatchableCommand.parse(c));
      commands.forEach((c) => options?.onCommand?.(c));
      for (const command of commands) {
        detail = applyMock(detail, command);
      }
      return HttpResponse.json({
        ok: true,
        tripId: detail.tripId,
        detail,
        history:
          options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
      });
    }),
    http.get("/api/trips/:tripId/history", () =>
      HttpResponse.json({
        history:
          options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
      }),
    ),
    http.get("/api/trips/:tripId/history/:seq", ({ params }) => {
      const at = options?.detailAt?.[Number(params.seq)];
      return at !== undefined
        ? HttpResponse.json({ trip: at })
        : HttpResponse.json({ error: "not-found" }, { status: 404 });
    }),
    http.get("/api/geocode", ({ request }) => {
      const q = new URL(request.url).searchParams.get("q")?.trim();
      return HttpResponse.json({ results: q ? (options?.geocode ?? []) : [] });
    }),
  ];
}
