import { HttpResponse, http } from "msw";
import { TripCommand, type TripDetail } from "@tc/contracts";

// Deliberately naive state transitions — just enough for UI development and
// component tests. The real semantics live in @tc/domain, which UI-side code
// (including these mocks) may not import (lint wall).
function applyMock(detail: TripDetail, command: TripCommand): TripDetail {
  const next = structuredClone(detail);
  switch (command.type) {
    case "AddDay":
      next.days.push({ dayId: command.dayId, activityIds: [] });
      break;
    case "RemoveDay": {
      const day = next.days.find((d) => d.dayId === command.dayId);
      next.backlog.push(...(day?.activityIds ?? []));
      next.days = next.days.filter((d) => d.dayId !== command.dayId);
      break;
    }
    case "SetTripStartDate":
      next.startDate = command.startDate;
      break;
    case "AddActivity":
      next.activities[command.activityId] = {
        activityId: command.activityId,
        title: command.title,
        timeWindow: command.timeWindow ?? null,
        location: command.location ?? null,
        notes: command.notes ?? null,
      };
      if (command.dayId !== undefined) {
        next.days.find((d) => d.dayId === command.dayId)?.activityIds.push(command.activityId);
      } else {
        next.backlog.push(command.activityId);
      }
      break;
    case "MoveActivity": {
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      const list =
        command.toDayId === null
          ? next.backlog
          : next.days.find((d) => d.dayId === command.toDayId)?.activityIds;
      list?.splice(Math.min(command.position, list.length), 0, command.activityId);
      break;
    }
    case "UpdateActivity": {
      const activity = next.activities[command.activityId];
      if (activity !== undefined) {
        if (command.title !== undefined) activity.title = command.title;
        if (command.timeWindow !== undefined) activity.timeWindow = command.timeWindow;
        if (command.location !== undefined) activity.location = command.location;
        if (command.notes !== undefined) activity.notes = command.notes;
      }
      break;
    }
    case "RemoveActivity":
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      delete next.activities[command.activityId];
      break;
    case "CreateTrip":
      break;
  }
  return next;
}

export function makeTripHandlers(initial: TripDetail) {
  let detail = structuredClone(initial);
  return [
    http.get("/api/trips/:tripId", ({ params }) =>
      params.tripId === detail.tripId
        ? HttpResponse.json({ trip: detail })
        : HttpResponse.json({ error: "not-found" }, { status: 404 }),
    ),
    http.post("/api/trips/:tripId/commands", async ({ request }) => {
      const command = TripCommand.parse(await request.json());
      detail = applyMock(detail, command);
      return HttpResponse.json({ ok: true, tripId: detail.tripId });
    }),
  ];
}
