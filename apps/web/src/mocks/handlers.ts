import { HttpResponse, http } from "msw";
import type { AccountPlanView } from "@/lib/accountPlan";
import type { AdminReportQueueItem } from "@/lib/reports";
import type { PlaceMatch, PlaceSearchResponse } from "@/lib/cities";
import {
  AdminReportAction,
  BatchableCommand,
  CreatePageInput,
  CreateReportInput,
  CreateSavedNotebookInput,
  PAGE_CHANGED_CODE,
  PutReviewInput,
  TripCommand,
  TripWeatherResponse,
  UpdatePageInput,
  type ContentReport,
  type Page,
  type Review,
  type ReviewSummary,
  type SavedDayReviewsResponse,
  type SavedNotebook,
  type SavedNotebookSummary,
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
        mode: command.mode ?? null,
        endLocation: command.endLocation ?? null,
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
        if (command.mode !== undefined) activity.mode = command.mode;
        if (command.endLocation !== undefined) activity.endLocation = command.endLocation;
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
      HttpResponse.json({ globals: { days: [], cities: [], tags: [] } }),
    ),
    makeWeatherHandler(),
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
      // The stale-save guard, as `executePageCommand` applies it: a save typed
      // against an older revision is refused, unless it would change nothing.
      const changes =
        (patch.title !== undefined && patch.title !== existing.title) ||
        (patch.content !== undefined && JSON.stringify(patch.content) !== JSON.stringify(existing.content));
      if (
        changes &&
        patch.expectedUpdatedAt !== undefined &&
        Date.parse(patch.expectedUpdatedAt) !== Date.parse(existing.updatedAt)
      ) {
        return HttpResponse.json(
          { error: "This page changed since you opened it.", code: PAGE_CHANGED_CODE },
          { status: 409 },
        );
      }
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

// Deliberately naive in-memory reviews for one shared day — just enough for the
// rating rail and the review form against `/api/saved-days/:id/reviews` (M12).
// The summary is recounted from the in-memory list on every call, which is the
// same "aggregate, never ++" shape the server keeps, so a test that posts and
// then reads sees the average move the way the real route moves it.
//
// `authorId` is who wrote the day, so the author posting gets the real route's
// 403 `own-day`; `publishedAt` is the day's current publish time, so a PUT
// carrying a different `seenPublishedAt` gets the 409 conflict body.
/**
 * MSW handlers for one day's reviews, seeded with `initial`, answering as
 * `viewerId`. Mirrors the real route's status codes, not its storage.
 */
export function makeReviewsHandlers(
  savedDayId: string,
  initial: Review[],
  options: { viewerId?: string; authorId?: string; publishedAt?: string; authorDisplayName?: string } = {},
) {
  const viewerId = options.viewerId ?? "dev-alice";
  let reviews = structuredClone(initial);
  const summary = (): ReviewSummary => {
    const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) histogram[r.stars as 1 | 2 | 3 | 4 | 5] += 1;
    const count = reviews.length;
    return { average: count === 0 ? null : reviews.reduce((n, r) => n + r.stars, 0) / count, count, histogram };
  };
  const mark = (r: Review): Review => ({ ...r, isMine: r.reviewerId === viewerId });
  const path = "/api/saved-days/:savedDayId/reviews";
  const notFound = () => HttpResponse.json({ error: "not-found" }, { status: 404 });
  return [
    http.get(path, ({ params }) => {
      if (params.savedDayId !== savedDayId) return notFound();
      const list = [...reviews].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(mark);
      const body: SavedDayReviewsResponse = {
        summary: summary(),
        reviews: list,
        mine: list.find((r) => r.isMine) ?? null,
      };
      return HttpResponse.json(body);
    }),
    http.put(path, async ({ params, request }) => {
      if (params.savedDayId !== savedDayId) return notFound();
      const parsed = PutReviewInput.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return HttpResponse.json({ error: "invalid-review" }, { status: 400 });
      if (options.authorId === viewerId) return HttpResponse.json({ error: "own-day" }, { status: 403 });
      const { seenPublishedAt } = parsed.data;
      if (
        seenPublishedAt !== undefined &&
        options.publishedAt !== undefined &&
        seenPublishedAt !== options.publishedAt
      ) {
        return HttpResponse.json(
          {
            error: "day-changed",
            changedAt: options.publishedAt,
            authorDisplayName: options.authorDisplayName ?? "Mei",
          },
          { status: 409 },
        );
      }
      const now = new Date().toISOString();
      const existing = reviews.find((r) => r.reviewerId === viewerId);
      const review: Review = {
        savedDayId,
        reviewerId: viewerId,
        reviewerDisplayName: existing?.reviewerDisplayName ?? viewerId,
        stars: parsed.data.stars,
        note: parsed.data.note,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        isMine: true,
      };
      reviews = [...reviews.filter((r) => r.reviewerId !== viewerId), review];
      return HttpResponse.json({ review, summary: summary() });
    }),
    http.delete(path, ({ params }) => {
      if (params.savedDayId !== savedDayId) return notFound();
      if (!reviews.some((r) => r.reviewerId === viewerId)) return notFound();
      reviews = reviews.filter((r) => r.reviewerId !== viewerId);
      return HttpResponse.json({ summary: summary() });
    }),
  ];
}

/**
 * MSW handlers for the signed-in person's saved notebooks (M14 link 10): list,
 * save, delete, and instantiate into a trip. Mirrors the real routes' shapes
 * and status codes, not their storage — a save snapshots an empty document
 * because the mock has no page store to read, and an instantiate creates a
 * page titled after the template.
 */
export function makeSavedNotebookHandlers(
  initial: SavedNotebook[] = [],
  options?: {
    onSave?: (input: CreateSavedNotebookInput) => void;
    onInstantiate?: (tripId: string, savedNotebookId: string) => void;
  },
) {
  let saved = structuredClone(initial);
  const summary = ({ content: _content, ...rest }: SavedNotebook): SavedNotebookSummary => rest;
  return [
    http.get("/api/saved-notebooks", () => HttpResponse.json({ savedNotebooks: saved.map(summary) })),
    http.post("/api/saved-notebooks", async ({ request }) => {
      const input = CreateSavedNotebookInput.parse(await request.json());
      options?.onSave?.(input);
      const savedNotebook: SavedNotebook = {
        savedNotebookId: crypto.randomUUID(),
        ownerId: "dev-alice",
        title: input.title ?? "Untitled notebook",
        docVersion: 1,
        visibility: "private",
        provenance: {
          sourceTripId: input.tripId,
          sourceTripName: "Mock trip",
          sourcePageId: input.pageId,
          savedAt: new Date().toISOString(),
        },
        content: { v: 1, type: "doc", content: [] },
      };
      saved.push(savedNotebook);
      return HttpResponse.json({ savedNotebook }, { status: 201 });
    }),
    http.delete("/api/saved-notebooks/:savedNotebookId", ({ params }) => {
      const before = saved.length;
      saved = saved.filter((s) => s.savedNotebookId !== params.savedNotebookId);
      return saved.length < before
        ? HttpResponse.json({ ok: true })
        : HttpResponse.json({ error: "not-found" }, { status: 404 });
    }),
    http.post("/api/trips/:tripId/saved-notebooks/:savedNotebookId", ({ params }) => {
      const template = saved.find((s) => s.savedNotebookId === params.savedNotebookId);
      if (template === undefined) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      options?.onInstantiate?.(params.tripId as string, template.savedNotebookId);
      const now = new Date().toISOString();
      const page: Page = {
        id: crypto.randomUUID(),
        tripId: params.tripId as string,
        title: template.title,
        context: { tripId: params.tripId as string },
        content: { v: 1, type: "doc", content: [] },
        createdAt: now,
        updatedAt: now,
        actorId: "dev-alice",
      };
      return HttpResponse.json({ page }, { status: 201 });
    }),
  ];
}

/**
 * `GET /api/trips/:tripId/weather` (ADR-052), answering zero points — what the
 * route says for a trip with no located stop.
 *
 * Shared for the reason `makeAccountPlanHandler` below is: since the seeded
 * Overview carries `day.weather`, any suite that renders a seeded page asks
 * for this, and `PageScreen.test.tsx` was logging it as unhandled on every
 * run. Parsed through the contract so the mock cannot drift from it; a suite
 * that wants the failed slot overrides it with a non-2xx.
 */
export function makeWeatherHandler() {
  return http.get("/api/trips/:tripId/weather", () =>
    HttpResponse.json(TripWeatherResponse.parse({ weather: { points: [] } })),
  );
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
    grants: [{ planId: "plus", version: 1, source: "founder", expiresAt: null }],
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
 * Reporting and the operator queue (M12 link 6), hand-written against
 * `CreateReportInput` / `AdminReportAction` like the rest of this file.
 *
 * Just enough state for a screen to walk it: a report is filed once per
 * target (a repeat answers 200 with the same report, as the server does), a
 * day in `ownSavedDayIds` is refused 403 `own-content`, and acting on an open
 * report settles it — `hide-*` as actioned, anything else as dismissed. What a
 * hide removes from Discover is the server's to prove, not this mock's.
 */
export function makeReportHandlers(
  options: {
    ownSavedDayIds?: string[];
    queue?: AdminReportQueueItem[];
    onAction?: (action: AdminReportAction) => void;
  } = {},
) {
  const filed = new Map<string, ContentReport>();
  const queue = structuredClone(options.queue ?? []);
  const keyOf = (target: ContentReport["target"]) =>
    target.kind === "review" ? `review:${target.savedDayId}:${target.reviewerId}` : `day:${target.savedDayId}`;
  return [
    http.post("/api/reports", async ({ request }) => {
      const body = CreateReportInput.safeParse(await request.json().catch(() => null));
      if (!body.success) return HttpResponse.json({ error: "invalid-report" }, { status: 400 });
      const { target } = body.data;
      if (target.kind === "saved_day" && options.ownSavedDayIds?.includes(target.savedDayId)) {
        return HttpResponse.json({ error: "own-content" }, { status: 403 });
      }
      const existing = filed.get(keyOf(target));
      if (existing !== undefined) return HttpResponse.json({ report: existing }, { status: 200 });
      const report: ContentReport = {
        reportId: crypto.randomUUID(),
        target,
        reporterId: "mock-reporter",
        reason: body.data.reason,
        note: body.data.note,
        status: "open",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      };
      filed.set(keyOf(target), report);
      return HttpResponse.json({ report }, { status: 201 });
    }),
    http.get("/api/admin/reports", ({ request }) => {
      const status = new URL(request.url).searchParams.get("status") ?? "open";
      return HttpResponse.json({ reports: queue.filter((item) => item.report.status === status) });
    }),
    http.post("/api/admin/reports/:reportId", async ({ params, request }) => {
      const action = AdminReportAction.safeParse(await request.json().catch(() => null));
      if (!action.success) return HttpResponse.json({ error: "invalid-action" }, { status: 400 });
      const item = queue.find((i) => i.report.reportId === params.reportId);
      if (item === undefined) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      options.onAction?.(action.data);
      if (item.report.status === "open") {
        item.report.status = action.data.action.startsWith("hide-") ? "actioned" : "dismissed";
        item.report.resolvedAt = new Date().toISOString();
        item.report.resolvedBy = "mock-operator";
      }
      return HttpResponse.json({ report: item.report });
    }),
  ];
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
