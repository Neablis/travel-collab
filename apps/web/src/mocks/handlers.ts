import { HttpResponse, http } from "msw";
import { defaultDocumentFor, instantiateMissingDefaults, notebookPreviewOf } from "@tc/pages";
import type { AccountPlanView } from "@/lib/accountPlan";
import type { AdminReportQueueItem } from "@/lib/reports";
import type { PlaceMatch, PlaceSearchResponse } from "@/lib/cities";
import {
  AddDefaultPagesInput,
  AdminReportAction,
  BatchableCommand,
  ChangeRoleInput,
  CoverCandidate,
  CreatePageInput,
  CreateReportInput,
  CreateSavedNotebookInput,
  CreateSuggestionInput,
  NearbyStopsResponse,
  PAGE_CHANGED_CODE,
  PutReviewInput,
  ResolveSuggestionChangeInput,
  RestorePageInput,
  SetCoverBody,
  SetTravellingInput,
  SYSTEM_ACTOR_ID,
  stopTotal,
  travellerIds,
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
  type SuggestionChange,
  type TripDetail,
  type TripEventsPage,
  type TripCover,
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
// A stop's price is still `stopTotal`'s, from contracts: per person, times who
// is in it, or every traveller when nobody is (ADR-060; travellers spec D1).
// Naive about structure, never about what a price means.
function rerollup(detail: TripDetail): void {
  const travellers = travellerIds(detail.members).length;
  const costOf = (id: string): number => {
    const activity = detail.activities[id];
    return activity ? stopTotal(activity, travellers) : 0;
  };
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
        pendingReason: command.pendingReason ?? null,
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
        if (command.pendingReason !== undefined) activity.pendingReason = command.pendingReason;
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
    /**
     * Who is reading, as `TripAccess.viewerId`. Defaults to the owner when
     * `myRole` is `owner`, and to nobody otherwise — a suite reading as a
     * member names which one.
     */
    viewerId?: string;
    /** Every suggestion draft POSTed, as parsed — what a suggester sent. */
    onSuggestion?: (input: CreateSuggestionInput) => void;
    /** Changes already stored when the suite starts, oldest first. */
    suggestions?: SuggestionChange[];
  },
) {
  let detail = structuredClone(initial);
  // The suggester spec's changes, stored as the route would answer them.
  // Not role-scoped beyond the viewer's 404: a suite that needs a suggester's
  // narrower list seeds only that suggester's changes.
  const suggestions: SuggestionChange[] = structuredClone(options?.suggestions ?? []);
  const role = options?.myRole ?? "owner";
  // The route serves pending changes only, and hashes those (W53).
  const pendingSuggestions = () => suggestions.filter((c) => c.status === "pending");
  // Any stable string over (id, status) does here; the route's is a hash (W31).
  const suggestionsRev = () => {
    let hash = 5381;
    for (const ch of pendingSuggestions().map((c) => `${c.id}:${c.status}`).sort().join(",")) {
      hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
    }
    return `r${hash.toString(36)}`;
  };
  const rankAtLeastSuggester = role !== "viewer";
  const viewerId = options?.viewerId ?? (role === "owner" ? detail.members[0]?.userId : undefined);
  // The trip's access counter (W5): "0" until a member write here moves it.
  let accessRev = 0;
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
      // Plain `commands`, or keyed `units` (ADR-066). The mock applies every
      // unit; leaving out one the server already applied needs its receipts.
      const body = (await request.json()) as { commands?: unknown[]; units?: { commands: unknown[] }[] };
      const raw = body.units ? body.units.flatMap((u) => u.commands) : (body.commands ?? []);
      const commands = raw.map((c) => BatchableCommand.parse(c));
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
    // Accepts any well-formed draft: the real route's dry run (spec W4) needs
    // the domain, which a mock may not import. A test that wants the 422
    // overrides this with `server.use`.
    http.post("/api/trips/:tripId/suggestions", async ({ request }) => {
      const input = CreateSuggestionInput.parse(await request.json());
      options?.onSuggestion?.(input);
      const suggestionId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const changes = input.units.map(
        (unit): SuggestionChange => ({
          id: crypto.randomUUID(),
          suggestionId,
          tripId: detail.tripId,
          authorId: "dev-alice",
          note: input.note ?? null,
          createdAt,
          commands: unit.commands,
          description: unit.commands.map((c) => c.type).join(", "),
          status: "pending",
          dependsOn: [],
          resolvedBy: null,
          resolvedAt: null,
        }),
      );
      suggestions.push(...changes);
      return HttpResponse.json({ changes }, { status: 201 });
    }),
    http.get("/api/trips/:tripId/suggestions", () =>
      rankAtLeastSuggester
        ? HttpResponse.json({ changes: pendingSuggestions(), rev: suggestionsRev() })
        : HttpResponse.json({ error: "Not found", code: "not-found" }, { status: 404 }),
    ),
    // The resolve route's rules that a board test can reach (spec §2.7, W28,
    // W33), without its role checks: accept applies the commands to the mock
    // trip so a refetch shows them confirmed; dismiss and withdraw take the
    // change's pending dependents with them.
    http.post("/api/trips/:tripId/suggestions/changes/:changeId", async ({ params, request }) => {
      const { action } = ResolveSuggestionChangeInput.parse(await request.json());
      const target = suggestions.find((c) => c.id === params.changeId);
      if (!target) return HttpResponse.json({ error: "Not found", code: "not-found" }, { status: 404 });
      if (target.status !== "pending") {
        return HttpResponse.json({ error: "Already resolved", code: "already-resolved" }, { status: 409 });
      }
      const resolvedAt = new Date().toISOString();
      if (action === "accept") {
        const blocked = target.dependsOn.some((id) => suggestions.find((c) => c.id === id)?.status !== "accepted");
        if (blocked) {
          return HttpResponse.json({ error: "Accept the change it builds on first", code: "dependency-pending" }, { status: 409 });
        }
        for (const command of target.commands) detail = applyMock(detail, command);
        Object.assign(target, { status: "accepted", resolvedBy: "dev-alice", resolvedAt });
        return HttpResponse.json({ changes: [target] });
      }
      const status = action === "dismiss" ? "dismissed" : "withdrawn";
      const resolved = [target];
      for (let i = 0; i < resolved.length; i++) {
        const parent = resolved[i]!;
        for (const c of suggestions) {
          if (c.status === "pending" && c !== target && !resolved.includes(c) && c.dependsOn.includes(parent.id)) {
            resolved.push(c);
          }
        }
      }
      for (const c of resolved) Object.assign(c, { status, resolvedBy: "dev-alice", resolvedAt });
      return HttpResponse.json({ changes: resolved });
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
    //
    // `suggestionsRev` rides along for a suggester and up (W6), as the route
    // sends it; a suite's own `events` may still state one of its own.
    http.get("/api/trips/:tripId/events", () => {
      const history =
        options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false };
      return HttpResponse.json({
        ...(rankAtLeastSuggester ? { suggestionsRev: suggestionsRev() } : {}),
        ...(options?.events ?? { headSeq: history.entries[0]?.toSeq ?? 0, events: [], resync: false }),
      });
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
          // `people/PeopleSection.test.tsx` and `collaborationGate.int.test.ts`.
          collaboratorsEntitled: options?.collaboratorsEntitled ?? true,
          accessRev: String(accessRev),
          viewerId,
        },
      }),
    ),
    // The People section's member writes: `PATCH`/`DELETE …/members/:userId`.
    // Each answers with the access the GET above serves, that one member
    // changed or gone — stateless like the GET, so a suite that needs the
    // change to stick across a re-read overrides both with `server.use`.
    //
    // **Refused as the route refuses** (`members/[userId]/route.ts`), in its
    // order: a UI built against a mock that answers 200 to anything never
    // meets a 403. Each success moves `accessRev`, as the route's write does.
    ...(["patch", "delete"] as const).map((method) =>
      http[method]("/api/trips/:tripId/members/:userId", async ({ params, request }) => {
        const target = String(params.userId);
        const owner = detail.members[0]?.userId;
        const onTrip = detail.members.some((m) => m.userId === target);
        const refuse = (status: number, error: string) => HttpResponse.json({ error }, { status });
        let change: SetTravellingInput | ChangeRoleInput | null = null;
        if (method === "delete") {
          if (role !== "owner") return refuse(403, "forbidden");
          if (target === owner) return refuse(409, "The trip's owner cannot be removed.");
          if (!onTrip) return refuse(404, "That person is not a member of this trip.");
        } else {
          const body = SetTravellingInput.or(ChangeRoleInput).safeParse(await request.json().catch(() => null));
          if (!body.success) return refuse(400, "invalid-member-change");
          change = body.data;
          if ("travelling" in change) {
            if (role !== "owner" && target !== viewerId) {
              return refuse(403, "Only the trip's owner can change this for someone else.");
            }
            if (!onTrip) return refuse(404, "That person is not on this trip.");
          } else {
            if (role !== "owner") return refuse(403, "Only the trip's owner can change roles.");
            if (target === owner) return refuse(409, "The trip's owner cannot be given another role.");
            if (!onTrip) return refuse(404, "That person is not a member of this trip.");
          }
        }
        accessRev += 1;
        const members = detail.members
          .filter((m) => change !== null || m.userId !== target)
          .map((m) => ({ ...m, ...(m.userId === target ? change : null), name: null, email: null, image: null }));
        return HttpResponse.json({
          access: {
            tripId: detail.tripId,
            myRole: role,
            members,
            invites: [],
            collaboratorsEntitled: options?.collaboratorsEntitled ?? true,
            accessRev: String(accessRev),
            viewerId,
          },
        });
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
    // Trip settings reads the cover when it opens, and an editor's sheet
    // makes the empty search that says covers are set up (M37). No cover and
    // no results, by default; a suite about the picker uses
    // `makeCoverHandlers` with what it needs.
    http.get("/api/trips/:tripId/cover/search", () => HttpResponse.json({ results: [] })),
    http.get("/api/trips/:tripId/cover", () => HttpResponse.json({ cover: null })),
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
  const versions = new Map<number, Page>();
  let versionSeq = 0;
  return [
    // `viewerId` mirrors the real route, which resolves the reader from its own
    // guard so the index's provenance line can say "Yours" truthfully. Defaults
    // to the fixture's own actor, so an unconfigured test sees its notebooks as
    // the reader's own — `options.viewerId` is how a test asks for the
    // collaborator case instead.
    http.get("/api/trips/:tripId/pages", ({ params }) =>
      HttpResponse.json({
        // With what each says, as the real route adds it (ADR-056).
        pages: pages.filter((p) => p.tripId === params.tripId).map((p) => ({ ...p, preview: notebookPreviewOf(p.content) })),
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
    // The default-notebook actions (owner only on the real routes; a suite
    // exercising the refusal overrides these). Built by the same `@tc/pages`
    // functions the server uses, so a mocked reset puts back what a real one
    // would. The reset's Undo reads a version kept here, where the server folds
    // the log to `toSeq`.
    http.post("/api/trips/:tripId/pages/defaults", async ({ params, request }) => {
      const tripId = params.tripId as string;
      const { seedKey } = AddDefaultPagesInput.parse(await request.json());
      const now = new Date().toISOString();
      for (const seed of instantiateMissingDefaults(tripId, pages.filter((p) => p.tripId === tripId), () => crypto.randomUUID(), [], seedKey)) {
        pages.push({ ...seed, tripId, createdAt: now, updatedAt: now, actorId: SYSTEM_ACTOR_ID });
      }
      return HttpResponse.json({
        pages: pages.filter((p) => p.tripId === tripId).map((p) => ({ ...p, preview: notebookPreviewOf(p.content) })),
        viewerId: options?.viewerId ?? "dev-alice",
      });
    }),
    http.post("/api/trips/:tripId/pages/:pageId/reset", ({ params }) => {
      const idx = pages.findIndex((p) => p.id === params.pageId && p.tripId === params.tripId);
      if (idx === -1) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      const existing = pages[idx]!;
      const seed = defaultDocumentFor(existing);
      if (seed === null) return HttpResponse.json({ error: "not a default", code: "not-a-default" }, { status: 409 });
      versions.set(++versionSeq, existing);
      const reset: Page = { ...existing, ...seed, updatedAt: new Date().toISOString() };
      pages[idx] = reset;
      return HttpResponse.json({ page: reset, restoreSeq: versionSeq });
    }),
    http.post("/api/trips/:tripId/pages/:pageId/restore", async ({ params, request }) => {
      const idx = pages.findIndex((p) => p.id === params.pageId && p.tripId === params.tripId);
      const { toSeq } = RestorePageInput.parse(await request.json());
      const past = versions.get(toSeq);
      if (idx === -1 || past === undefined) return HttpResponse.json({ error: "not-found" }, { status: 404 });
      const restored: Page = { ...pages[idx]!, title: past.title, content: past.content, updatedAt: new Date().toISOString() };
      pages[idx] = restored;
      return HttpResponse.json({ page: restored });
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

/**
 * `GET /api/trips/:tripId/nearby-stops` (M34), answering `stops` as given for
 * any trip and any query. The ranking is the server's (`server/nearbyStops.ts`)
 * and is asserted there; parsed through the contract so a mock row cannot
 * drift from it. Not in any default list: only the add-stop sheet asks, and a
 * suite that renders it says what the library holds.
 */
export function makeNearbyStopsHandler(stops: NearbyStopsResponse["stops"]) {
  return http.get("/api/trips/:tripId/nearby-stops", () =>
    HttpResponse.json(NearbyStopsResponse.parse({ stops })),
  );
}

/**
 * The cover routes (M37): `GET`, `PUT` and `DELETE /api/trips/:tripId/cover`
 * and `GET …/cover/search` — or a saved day's, `/api/saved-days/:id/cover`,
 * with `at: "saved-day"` — over one in-memory cover. Search answers `pages[n-1]`
 * for `?page=n` and nothing past the last. `search: "unavailable"` answers the
 * route's 503 (no Unsplash key here), `"quota"` its 429 — the two refusals the
 * picker words differently. Every pick and clear is recorded, as sent.
 */
export function makeCoverHandlers(
  options: {
    cover?: TripCover | null;
    pages?: CoverCandidate[][];
    search?: "ok" | "unavailable" | "quota";
    onSet?: (candidate: CoverCandidate) => void;
    onClear?: () => void;
    at?: "trip" | "saved-day";
  } = {},
) {
  let cover = options.cover ?? null;
  const pages = options.pages ?? [];
  const base = options.at === "saved-day" ? "/api/saved-days/:savedDayId/cover" : "/api/trips/:tripId/cover";
  return [
    http.get(`${base}/search`, ({ request }) => {
      if (options.search === "unavailable") return HttpResponse.json({ error: "covers-unavailable" }, { status: 503 });
      if (options.search === "quota") {
        return HttpResponse.json(
          { error: "you've made too many requests — try again later", reason: "user", retryAfterSeconds: 60 },
          { status: 429 },
        );
      }
      const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
      return HttpResponse.json({ results: pages[page - 1] ?? [] });
    }),
    http.get(base, () => HttpResponse.json({ cover })),
    http.put(base, async ({ request }) => {
      const { candidate } = SetCoverBody.parse(await request.json());
      options.onSet?.(candidate);
      // What the route stores: everything but the ping URL (D2).
      cover = {
        unsplashId: candidate.id,
        urls: candidate.urls,
        alt: candidate.alt,
        photographerName: candidate.photographerName,
        photographerUrl: candidate.photographerUrl,
        photoPageUrl: candidate.photoPageUrl,
      };
      return HttpResponse.json({ cover });
    }),
    http.delete(base, () => {
      options.onClear?.();
      cover = null;
      return HttpResponse.json({ cover: null });
    }),
  ];
}
