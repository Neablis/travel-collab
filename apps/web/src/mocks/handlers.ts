import { HttpResponse, http } from "msw";
import type { AccountPlanView } from "@/lib/accountPlan";
import type { PlaceMatch, PlaceSearchResponse } from "@/lib/cities";
import {
  BatchableCommand,
  CreatePageInput,
  TripCommand,
  UpdatePageInput,
  type Page,
  type TripDetail,
  type TripEventsPage,
  type TripHistory,
  type TripRole,
} from "@tc/contracts";

type GeocodeResult = { lat: number; lng: number; canonicalName: string; countryCode?: string; city?: string; area?: string };

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
        kind: command.kind ?? "planned",
        tags: command.tags ?? [],
        cost: command.cost ?? null,
        bookedBy: command.bookedBy ?? null,
        participants: command.participants ?? [],
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
        if (command.kind !== undefined) activity.kind = command.kind;
        if (command.tags !== undefined) activity.tags = command.tags;
        if (command.cost !== undefined) activity.cost = command.cost;
        if (command.bookedBy !== undefined) activity.bookedBy = command.bookedBy;
        if (command.participants !== undefined) activity.participants = command.participants;
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
    events?: TripEventsPage;
    detailAt?: Record<number, TripDetail>;
    onCommand?: (command: TripCommand) => void;
    geocode?: GeocodeResult[];
    myRole?: TripRole;
    /** M20 link 6 — whether the trip's OWNER holds `trip.collaborators`. */
    collaboratorsEntitled?: boolean;
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
    // M13 link 2. `useTripBroadcast` polls this while a multi-member trip is
    // visible, so any component test whose trip has more than one member would
    // otherwise make an unhandled request every 5s. The default answer is
    // "nothing has happened": the head matches whatever history says, so a
    // caller seeded from that history is already caught up and the poll is
    // inert. A test that wants a remote edit overrides `events`.
    http.get("/api/trips/:tripId/events", () => {
      const history =
        options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false };
      return HttpResponse.json(
        options?.events ?? { headSeq: history.entries[0]?.toSeq ?? 0, events: [], resync: false },
      );
    }),
    http.get("/api/trips/:tripId/history/:seq", ({ params }) => {
      const at = options?.detailAt?.[Number(params.seq)];
      return at !== undefined
        ? HttpResponse.json({ trip: at })
        : HttpResponse.json({ error: "not-found" }, { status: 404 });
    }),
    // M11 link 3: TripProvider reads the caller's role alongside detail and
    // history. Mocked as `owner` by default so every existing component test
    // keeps the full-edit board it was written against; pass
    // `options.myRole` to exercise the read-only path.
    http.get("/api/trips/:tripId/access", () =>
      HttpResponse.json({
        access: {
          tripId: detail.tripId,
          myRole: options?.myRole ?? "owner",
          members: detail.members.map((m) => ({ ...m, name: null, email: null, image: null })),
          invites: [],
          // M20 link 6. Entitled by default so every board test written before
          // the collaboration gate keeps describing the behaviour it was
          // written for; the gate's own surfaces are covered in
          // `TravelersPanel.test.tsx` and `collaborationGate.int.test.ts`.
          collaboratorsEntitled: options?.collaboratorsEntitled ?? true,
        },
      }),
    ),
    // Overview also lists the trip's notebooks. Empty by default and NOT a
    // duplicate of `makePagesHandlers`, which is the stateful one a notebook
    // suite drives; no suite spreads both, checked before adding this.
    http.get("/api/trips/:tripId/pages", () => HttpResponse.json({ pages: [] })),
    // The Overview view asks for the trip's addressable collections (ADR-037
    // open question 4), so a suite that lands anywhere but `view=Plan` needs
    // this. It belongs here rather than inline in each suite for the reason
    // `PageScreen.test.tsx` already gives about its own defaults: an
    // unhandled request logged on every run is how a genuinely unhandled one
    // later gets missed. Empty collections, because no test asserts on them
    // through this path — a suite that cares overrides with `server.use`.
    http.get("/api/trips/:tripId/globals", () =>
      HttpResponse.json({ globals: { days: [], cities: [], tags: [], bookedCount: 0 } }),
    ),
    http.get("/api/geocode", ({ request }) => {
      const q = new URL(request.url).searchParams.get("q")?.trim();
      return HttpResponse.json({ results: q ? (options?.geocode ?? []) : [] });
    }),
  ];
}

// Deliberately naive in-memory pages store — just enough for UI development
// and component tests against the pages REST routes (Task 3.3). Seed with
// `@tc/pages`'s `instantiateDefaults(tripId)` (via `pagesClient.createPage`)
// or an explicit fixture array (see `pageFixture` in `@tc/factories`).
export function makePagesHandlers(
  initialPages: Page[],
  options?: {
    onCreate?: (tripId: string, input: CreatePageInput) => void;
    onUpdate?: (pageId: string, patch: UpdatePageInput) => void;
    onDelete?: (pageId: string) => void;
    viewerId?: string;
  },
) {
  let pages = structuredClone(initialPages);
  return [
    // `viewerId` mirrors the real route, which resolves the reader from its own
    // guard so the index's provenance line can say "Yours" truthfully. Defaults
    // to the fixture's own actor, so an unconfigured test sees its notebooks as
    // the reader's own — `options.viewerId` is how a test asks for the
    // collaborator case instead.
    http.get("/api/trips/:tripId/pages", ({ params }) =>
      HttpResponse.json({
        pages: pages.filter((p) => p.tripId === params.tripId),
        viewerId: options?.viewerId ?? "dev-alice",
      }),
    ),
    http.post("/api/trips/:tripId/pages", async ({ params, request }) => {
      const input = CreatePageInput.parse(await request.json());
      options?.onCreate?.(params.tripId as string, input);
      const now = new Date().toISOString();
      const page: Page = {
        id: crypto.randomUUID(),
        tripId: params.tripId as string,
        title: input.title,
        context: input.context,
        content: input.content,
        createdAt: now,
        updatedAt: now,
        actorId: "dev-alice",
      };
      pages.push(page);
      return HttpResponse.json({ page }, { status: 201 });
    }),
    http.get("/api/trips/:tripId/pages/:pageId", ({ params }) => {
      const page = pages.find((p) => p.id === params.pageId && p.tripId === params.tripId);
      return page !== undefined
        ? HttpResponse.json({ page })
        : HttpResponse.json({ error: "not-found" }, { status: 404 });
    }),
    http.patch("/api/trips/:tripId/pages/:pageId", async ({ params, request }) => {
      const idx = pages.findIndex((p) => p.id === params.pageId && p.tripId === params.tripId);
      if (idx === -1) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      const patch = UpdatePageInput.parse(await request.json());
      options?.onUpdate?.(params.pageId as string, patch);
      const existing = pages[idx]!;
      const updated: Page = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.context !== undefined ? { context: patch.context } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        updatedAt: new Date().toISOString(),
      };
      pages[idx] = updated;
      return HttpResponse.json({ page: updated });
    }),
    http.delete("/api/trips/:tripId/pages/:pageId", ({ params }) => {
      const idx = pages.findIndex((p) => p.id === params.pageId && p.tripId === params.tripId);
      if (idx === -1) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      options?.onDelete?.(params.pageId as string);
      pages = pages.filter((_, i) => i !== idx);
      return HttpResponse.json({ ok: true });
    }),
  ];
}

/**
 * `GET /api/account/plan`, entitled by default.
 *
 * **Why this is shared rather than a line in each suite.** Three suites were
 * logging it as unhandled — 52 of the unit lane's 60 unhandled-request errors
 * on 2026-09-23 — and `PageScreen.test.tsx`'s own setup already says what that
 * costs: *"Without it the suite's `onUnhandledRequest: "error"` logs on every
 * test, which is how a genuinely unhandled request later gets missed."* It was
 * missed here for exactly that reason.
 *
 * **And it was not only noise.** `useAiEntitled` resolves a failed read rather
 * than throwing (`apiClient.ts`'s invariant), so an unhandled `/api/account/plan`
 * makes the hook answer `null` — "unknown" — forever, silently. Every suite
 * below ran its assistant against an account whose plan never arrived, which is
 * not a state a signed-in user is ever in. The tests passed because the rail
 * renders while unknown; what they were not doing is exercising the entitled
 * path they read as covering.
 *
 * `entitlements` defaults to including `ai.ask` because that is the ordinary
 * case. A suite about the refusal overrides it with `server.use`.
 */
export function makeAccountPlanHandler(overrides: Partial<AccountPlanView> = {}) {
  const plan: AccountPlanView = {
    planVersionRef: "plus@v1",
    conferredVersionRef: "plus@v1",
    entitlements: ["ai.ask"],
    grantedVersionRefs: ["plus@v1"],
    questions: { used: 0, limit: 100 },
    steps: { used: 0, limit: 1000 },
    catalogue: [],
    referralCode: null,
    canRefer: false,
    billing: {
      state: "active",
      renewsAt: null,
      pastDueSince: null,
      graceEndsAt: null,
      trialEndsAt: null,
      losesOnLapse: [],
      available: true,
    },
    ...overrides,
  };
  return http.get("/api/account/plan", () => HttpResponse.json({ plan }));
}

/**
 * `GET /api/places?q=` (M12 link 7) over a fixed list of places, typed against
 * `PlaceMatch` so a mock row that fits neither the city nor the country arm is
 * a type error rather than a surprise in a component.
 *
 * Deliberately naive, like every handler here: a case-insensitive prefix match
 * on the label, the given order kept, and the real route's empty-box
 * short-circuit. The ranking is the server's (`server/places.ts`), and a suite
 * that cares about it asserts it there, not through this.
 */
export function makePlaceSearchHandler(places: PlaceMatch[]) {
  return http.get("/api/places", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase();
    const body: PlaceSearchResponse = {
      places: q
        ? places.filter((p) => (p.kind === "city" ? p.city : p.name).toLowerCase().startsWith(q))
        : [],
    };
    return HttpResponse.json(body);
  });
}
