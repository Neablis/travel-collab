import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { executeTripCommand } from "@/server/commands";
import { validateComposedPage } from "@/server/ai/pageTools";
import { getGeocoder } from "@/server/geocoding";
import type { Geocoder, GeocodeResult } from "@/server/geocoding";
import { simulatedModel } from "@/server/ai/simulatedModel";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

// Not exported by `ai`'s top-level barrel (it's an `@ai-sdk/provider` type,
// which isn't a direct dependency of this package) — shaped to match
// LanguageModelV4ToolCall exactly, which is all MockLanguageModelV4 needs
// from us. Note `input` (not `args`) and it's a stringified JSON object, same
// as v4's `args` was.
type FunctionToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };

// AI SDK v7's LanguageModelV4Usage requires nested inputTokens/outputTokens
// objects (each field individually optional-typed as `number | undefined`,
// but the object itself is required) instead of v4's flat
// `{ promptTokens, completionTokens }`.
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: undefined, reasoning: undefined },
};

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Regression coverage for the lazy-geocoder fix: `getGeocoder()` throws if
// LOCATIONIQ_API_KEY isn't set, so it must never be reached for a page-surface
// request (Notebook AI-authoring), which never touches location data. Mocked
// to throw (not just spied on) so an accidental call fails loudly here rather
// than silently succeeding because this worktree's .env.local happens to carry
// a real key.
vi.mock("@/server/geocoding", () => ({
  getGeocoder: vi.fn(() => {
    throw new Error("getGeocoder should never be called for a page-surface request");
  }),
}));

// Import after the mock so the route picks up the mocked `auth`. Only
// `handleAiRequest` is exercised directly (never `POST`, which is the only
// path that could ever construct a real `aiModel()`) — every test here
// injects a `MockLanguageModelV4` so no network call is ever made.
// `handleAiRequest` lives in @/server/ai/handleAiRequest, not the route file
// itself — Next.js's route-type-checking only allows HTTP-method exports
// from app/api/**/route.ts, so it can't be exported from ./route.
const { handleAiRequest } = await import("@/server/ai/handleAiRequest");

function seedTrip() {
  const tripId = randomUUID();
  return executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID).then((result) => {
    if (!result.ok) throw new Error("failed to seed trip");
    return tripId;
  });
}

function req(tripId: string, body: unknown) {
  return new Request(`http://test/api/trips/${tripId}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A MockLanguageModelV4 that emits the given tool calls on its first
// doGenerate invocation, then reports "stop" on any subsequent call. This is
// a fully local fake LanguageModelV4 — generateText calls `doGenerate`
// directly, no network involved. The "stop" tail matters: with `stopWhen:
// isStepCount(N)` for N > 1, the AI SDK loops calling `doGenerate` again
// after a "tool-calls" finish reason (to let a real model react to tool
// results); a fake that always re-emitted the same tool calls would have
// them executed — and, for planning tools, collected/batched — once per
// remaining step.
function modelWithToolCalls(toolCalls: FunctionToolCall[]) {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      if (calls > 1) {
        return {
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
          content: [],
        };
      }
      return {
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USAGE,
        warnings: [],
        content: toolCalls,
      };
    },
  });
}

function toolCall(toolName: string, args: Record<string, unknown>): FunctionToolCall {
  return { type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(args) };
}

// A model that NEVER stops: every `doGenerate` re-emits the same tool calls, so
// the run can only end when `stopWhen: isStepCount(N)` fires. This is the shape
// of a real model working through a long plan — a 7-day itinerary with lunches
// is ~28 tool calls — and getting cut off partway. Before the truncation check,
// such a run returned 200 with "Done — added a day, added a day, …" over a trip
// left holding only empty days (2026-07-26 live run: steps 6, finishReason
// "tool-calls", zero AddActivity).
function modelThatNeverStops(toolCalls: FunctionToolCall[]) {
  return new MockLanguageModelV4({
    // Fresh toolCallIds per step — reusing one across steps is invalid.
    doGenerate: async () => ({
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage: USAGE,
      warnings: [],
      content: toolCalls.map((call) => ({ ...call, toolCallId: randomUUID() })),
    }),
  });
}

// A fake Geocoder (matching the `Geocoder` interface exactly) keyed by exact
// query string. Maps a query to either a results array (possibly empty, for
// the "no match" case) or an Error (for the "vendor threw/rejected" case).
// `forward` is a vi.fn so tests can assert call count/args — the dedupe test's
// whole point is that an identical place name across two commands triggers
// exactly one call.
function fakeGeocoder(responses: Record<string, GeocodeResult[] | Error>): Geocoder {
  const forward = vi.fn(async (query: string) => {
    const r = responses[query];
    if (r instanceof Error) throw r;
    return r ?? [];
  });
  return { forward } as unknown as Geocoder;
}

// No DB truncation: every test seeds its own randomUUID() tripId and every
// assertion reads back through that trip's response body — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6). currentUserId still resets every test — that's mock auth state,
// not DB state.
describe("POST /api/trips/:id/ai", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    const res = await handleAiRequest(
      req(tripId, { prompt: "hi", surface: "page" }),
      tripId,
      modelWithToolCalls([]),
    );
    expect(res.status).toBe(401);
  });

  it("403s for a non-member", async () => {
    const tripId = await seedTrip();
    currentUserId = OUTSIDER_ID;
    const res = await handleAiRequest(
      req(tripId, { prompt: "hi", surface: "page" }),
      tripId,
      modelWithToolCalls([]),
    );
    expect(res.status).toBe(403);
  });

  it("page surface: returns a doc that passes validateComposedPage", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("compose_page", {
        title: "Trip Notes",
        blocks: [
          { type: "heading", level: 1, text: "Overview" },
          { type: "paragraph", text: "Some notes." },
          { type: "macro", name: "trip.name" },
        ],
      }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content.type).toBe("doc");
    const validated = validateComposedPage(body.content);
    expect("error" in validated).toBe(false);
  });

  it("page surface: an unknown macro is rejected, never persisted as a broken node", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("compose_page", {
        title: "Trip Notes",
        blocks: [{ type: "macro", name: "not.a.real.macro" }],
      }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      model,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.content).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  // Regression test: `geocoder` used to be `Geocoder = getGeocoder()`, a
  // default parameter evaluated at call time whenever omitted — which is
  // every real request, since route.ts's `POST` calls `handleAiRequest(request,
  // tripId)` with no 3rd/4th argument. `getGeocoder()` throws if
  // LOCATIONIQ_API_KEY is unset, so that would have broken page-surface
  // requests too, even though the geocode-enrichment step only ever runs for
  // board/combined surfaces. This pins that a page-surface request succeeds
  // with NO geocoder argument at all (matching POST's real call shape exactly)
  // and never constructs/calls a geocoder to do it.
  it("page surface: succeeds with no geocoder argument, and never constructs one", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("compose_page", {
        title: "Trip Notes",
        blocks: [{ type: "paragraph", text: "Some notes." }],
      }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      model,
      // Deliberately no 4th argument — this is exactly how route.ts's POST
      // calls handleAiRequest for every real request.
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content.type).toBe("doc");
    expect(getGeocoder).not.toHaveBeenCalled();
  });

  it("board surface: a tool call is submitted as exactly one atomic batch", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([
      toolCall("AddDay", { dayId: randomUUID() }),
      toolCall("AddDay", { dayId: randomUUID() }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "add two days", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(2);
    // ADR-013: one batchId → one history entry describing both commands
    // (plus the seed trip's own "Created trip" entry) — proof the two
    // AddDay calls landed as ONE atomic executeTripCommandBatch call, not
    // two separate ones.
    expect(body.history.entries).toHaveLength(2);
    expect(body.history.entries[0].description).toBe("Added Day 1; Added Day 2");
    // A plain-language summary of what was applied, derived from the batch.
    expect(body.message).toBe("Done — added a day and added a day.");
    // Auditing meta: the caller can see the model call actually happened and
    // which tools fired, and resolvedCommands mirrors the applied batch.
    expect(body.meta.model.requested).toBeDefined();
    expect(body.meta.finishReason).toBeDefined();
    expect(body.meta.steps).toBeGreaterThanOrEqual(1);
    expect(body.meta.toolCalls.map((c: { name: string }) => c.name)).toEqual(["AddDay", "AddDay"]);
    expect(body.resolvedCommands).toHaveLength(2);
  });

  it("board surface: the applied summary names the moved activity and its target", async () => {
    const tripId = await seedTrip();
    const dayId = randomUUID();
    const activityId = randomUUID();
    // Seed an on-day activity so the AI's MoveActivity references it BY TITLE —
    // the exact shape of the user's "move Treasure Island …" prompt. The server
    // resolves activityRef/dayRef to real ids (the model never sees a UUID).
    await executeTripCommand({ type: "AddDay", tripId, dayId }, ACTOR_ID);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId, dayId, title: "Treasure Island" },
      ACTOR_ID,
    );
    const model = modelWithToolCalls([
      toolCall("MoveActivity", { activityRef: "Treasure Island", dayRef: "backlog", position: 0 }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "move treasure island to the backlog", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Name resolved from the (pre-change) trip detail, not the raw id/args.
    expect(body.message).toBe("Done — moved “Treasure Island” to the backlog.");
    // The audit trail shows the ref→id resolution end to end: the model sent a
    // human title + "backlog" (meta.toolCalls), and the applied command carries
    // the real activityId and a null day (resolvedCommands).
    expect(body.meta.toolCalls[0].input).toMatchObject({ activityRef: "Treasure Island", dayRef: "backlog" });
    expect(body.resolvedCommands[0]).toMatchObject({ type: "MoveActivity", activityId, toDayId: null });
  });

  it("board surface: zero tool calls returns the trip unchanged, with a message explaining nothing applied", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "what's the weather like", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(0);
    // Not a silent no-op: the user is told why the board didn't change.
    expect(body.message).toMatch(/nothing was applied/i);
    // meta.toolCalls empty confirms the model called nothing (vs. calling
    // tools whose refs all failed to resolve, which would populate it).
    expect(body.meta.toolCalls).toHaveLength(0);
    expect(body.resolvedCommands).toHaveLength(0);
  });

  it("board surface: a run cut off by the step budget is reported as truncated, not as done", async () => {
    const tripId = await seedTrip();
    const model = modelThatNeverStops([toolCall("AddDay", {})]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "create a 7 day itinerary for Rochester NY", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // `stopWhen` firing while the model still wanted to call tools is the ONLY
    // way a finished run lands on "tool-calls" — a model that is done returns
    // "stop". That distinction is the whole truncation signal.
    expect(body.meta.finishReason).toBe("tool-calls");
    expect(body.meta.truncated).toBe(true);
    // Whatever it managed IS applied — truncated, not discarded. One AddDay per
    // step, so the day count also pins that the budget is sized for a real
    // itinerary (~28 tool calls) rather than the old 6.
    expect(body.detail.days.length).toBe(body.meta.steps);
    expect(body.detail.days.length).toBeGreaterThanOrEqual(28);
    // The user is told the plan is unfinished instead of being handed a
    // confident "Done — added a day, added a day, …".
    expect(body.message).toMatch(/didn't finish/i);
  });

  it("board surface: a model that finishes on its own is not reported as truncated", async () => {
    const tripId = await seedTrip();
    const model = modelWithToolCalls([toolCall("AddDay", {})]);
    const res = await handleAiRequest(req(tripId, { prompt: "add a day", surface: "board" }), tripId, model);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.finishReason).toBe("stop");
    expect(body.meta.truncated).toBe(false);
    expect(body.message).not.toMatch(/didn't finish/i);
  });

  it("board surface: adds a day and places an activity on it in one batch", async () => {
    const tripId = await seedTrip(); // 0 days
    const model = modelWithToolCalls([
      toolCall("AddDay", {}),
      toolCall("AddActivity", { title: "Lunch at the market", dayRef: "day 1" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "add a day and put lunch on it", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The new day exists and carries the activity — proof the AddActivity's
    // "day 1" resolved to the day minted by the AddDay earlier in the SAME batch.
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    const addedId = body.detail.days[0].activityIds[0];
    expect(body.detail.activities[addedId].title).toBe("Lunch at the market");
    // resolvedCommands shows the linkage: AddActivity.dayId === AddDay.dayId.
    const [addDay, addActivity] = body.resolvedCommands;
    expect(addActivity.dayId).toBe(addDay.dayId);
    expect(body.resolutionErrors).toEqual([]);
  });

  it("board surface: a removal and a dependent add apply as one partial batch", async () => {
    const tripId = await seedTrip();
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, ACTOR_ID);
    const keptDayId = randomUUID();
    await executeTripCommand({ type: "AddDay", tripId, dayId: keptDayId }, ACTOR_ID);

    // After RemoveDay(day 1), "day 1" is what was day 2 — the resolver must see
    // the removal. Before the dry-run this either targeted the removed day (and
    // aborted the WHOLE batch on day-not-found) or silently hit the wrong day.
    // The third call is unresolvable on purpose — "day 99" is out of range once
    // RemoveDay has run and left only one day — so this batch is genuinely
    // PARTIAL: two commands apply, one is dropped, and nothing aborts.
    const model = modelWithToolCalls([
      toolCall("RemoveDay", { dayRef: "day 1" }),
      toolCall("AddActivity", { title: "Dinner", dayRef: "day 1" }),
      toolCall("AddActivity", { title: "Ghost", dayRef: "day 99" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "drop the first day and add dinner to the remaining one", surface: "board" }),
      tripId,
      model,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].dayId).toBe(keptDayId);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    // The two resolvable commands still apply exactly as before...
    expect(Object.values(body.detail.activities as Record<string, { title: string }>).map((a) => a.title)).toEqual([
      "Dinner",
    ]);
    // ...while the unresolvable third one is reported as a drop, not a silent
    // loss and not an abort of the whole batch (proof of the "partial batch"
    // behavior this test is named for).
    expect(body.resolutionErrors).toHaveLength(1);
    expect(body.resolutionErrors[0]).toMatchObject({ type: "AddActivity", code: "unresolved-ref", index: 2 });
    expect(body.resolutionErrors[0].message).toMatch(/out of range/i);
  });

  // ADR-007's "pre-command enrichment" was only ever wired into the manual
  // "Add a place" search — the AI planning path was never connected to a real
  // geocoder, so the model was left to invent lat/lng itself (observed live:
  // lat 0, lng 0). These pin the server-side fix: AddActivity/UpdateActivity
  // commands with a `location` get it replaced by a real geocoder lookup,
  // deduped per request, run in parallel, and best-effort (never fails the
  // whole AI request).
  describe("AI-planned activity locations are geocoded server-side", () => {
    const GEOCODED: GeocodeResult = {
      lat: 43.1566,
      lng: -77.6088,
      canonicalName: "Rochester, NY, USA",
      countryCode: "US",
    };

    it("an AddActivity's location is replaced by the geocoder's result, not the model's guessed lat/lng", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({ "Rochester, NY": [GEOCODED] });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        toolCall("AddActivity", {
          title: "Lunch",
          dayRef: "day 1",
          // The model's own (wrong) guess — must be discarded, not persisted.
          location: { name: "Rochester, NY", lat: 0, lng: 0, countryCode: "US" },
        }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add lunch in rochester", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const addedId = body.detail.days[0].activityIds[0];
      expect(body.detail.activities[addedId].location).toEqual({
        name: "Rochester, NY, USA",
        lat: 43.1566,
        lng: -77.6088,
        countryCode: "US",
      });
      expect(geocoder.forward).toHaveBeenCalledWith("Rochester, NY", { limit: 1 });
    });

    it("dedupes identical place-name queries within one request to a single geocoder call", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({ "Rochester, NY": [GEOCODED] });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        toolCall("AddDay", {}),
        toolCall("AddActivity", { title: "Day 1 lunch", dayRef: "day 1", location: { name: "Rochester, NY" } }),
        toolCall("AddActivity", { title: "Day 2 lunch", dayRef: "day 2", location: { name: "Rochester, NY" } }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add lunch in rochester on both days", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const activities = Object.values(body.detail.activities as Record<string, { title: string; location: unknown }>);
      expect(activities).toHaveLength(2);
      for (const a of activities) {
        expect(a.location).toEqual({
          name: "Rochester, NY, USA",
          lat: 43.1566,
          lng: -77.6088,
          countryCode: "US",
        });
      }
      // The whole point: one geocoder call serves both identically-named commands.
      expect(geocoder.forward).toHaveBeenCalledTimes(1);
      expect(geocoder.forward).toHaveBeenCalledWith("Rochester, NY", { limit: 1 });
    });

    // NOTE (Task 5, KI-15 contract change): under the old contract ANY
    // model-supplied lat/lng was untrusted and unconditionally dropped on a
    // no-match. Under the new one (Task 1/4), a PLAUSIBLE model coordinate
    // (unlike the null-island 0,0 sentinel used elsewhere in this describe
    // block) is treated as a hint: it biases the lookup's viewbox, and if the
    // geocoder can't confirm it, "enrichment may refine, never relocate"
    // means we keep the hint rather than discard it — reported `unverified`,
    // not silently thrown away. This assertion was updated to match; it is
    // not a weakening, the underlying behavior genuinely changed.
    it("keeps the model's plausible coordinates as an unverified hint when the geocoder finds no match", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({ "Nowhereville": [] });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        toolCall("AddActivity", {
          title: "Lunch",
          dayRef: "day 1",
          location: { name: "Nowhereville", lat: 12, lng: 34, countryCode: "US" },
        }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add lunch in nowhereville", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const addedId = body.detail.days[0].activityIds[0];
      expect(body.detail.activities[addedId].location).toEqual({ name: "Nowhereville", lat: 12, lng: 34 });
      // Biased by the plausible hint (a tight viewbox around 12,34), not a
      // bare lookup.
      expect(geocoder.forward).toHaveBeenCalledWith(
        "Nowhereville",
        expect.objectContaining({ limit: 1, viewbox: expect.any(Object) }),
      );
      expect(body.locationReport.unverified).toEqual(["Nowhereville"]);
    });

    it("falls back to a name-only location when the geocoder rejects, without failing the request", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({ "Rochester, NY": new Error("LocationIQ rate limit exceeded") });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        // The model's own (wrong) guessed lat/lng — must be DROPPED when the
        // lookup throws, not persisted as if it were real.
        toolCall("AddActivity", {
          title: "Lunch",
          dayRef: "day 1",
          location: { name: "Rochester, NY", lat: 0, lng: 0, countryCode: "US" },
        }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add lunch in rochester", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const addedId = body.detail.days[0].activityIds[0];
      expect(body.detail.activities[addedId].location).toEqual({ name: "Rochester, NY" });
      expect(geocoder.forward).toHaveBeenCalledWith("Rochester, NY", { limit: 1 });
    });

    it("does not call the geocoder for an UpdateActivity that clears its location", async () => {
      const tripId = await seedTrip();
      const dayId = randomUUID();
      const activityId = randomUUID();
      await executeTripCommand({ type: "AddDay", tripId, dayId }, ACTOR_ID);
      await executeTripCommand(
        {
          type: "AddActivity",
          tripId,
          activityId,
          dayId,
          title: "Museum visit",
          location: { name: "Some Museum", lat: 1, lng: 2, countryCode: "US" },
        },
        ACTOR_ID,
      );
      const geocoder = fakeGeocoder({});
      const model = modelWithToolCalls([
        toolCall("UpdateActivity", { activityRef: "Museum visit", location: null }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "clear the museum's location", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.detail.activities[activityId].location).toBeNull();
      expect(geocoder.forward).not.toHaveBeenCalled();
    });
  });

  // KI-15's other half: enrichment now reports what it could/couldn't verify,
  // and the region derived from the trip's own already-geocoded activities is
  // threaded in as a bias. These pin that the report reaches the response body
  // and that only the notice-worthy buckets (unverified/failed/skipped) — never
  // `unchecked` — show up in the user-facing message.
  describe("geocode enrichment report reaches the user", () => {
    it("tells the user which locations it could not verify", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({
        "The Red Coach Inn": [
          { lat: 52.907918, lng: -2.8901, canonicalName: "Shropshire, England", countryCode: "GB" },
        ],
      });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        toolCall("AddActivity", {
          title: "Dinner",
          dayRef: "day 1",
          // The model's own coordinates are right; the geocoder's top match
          // (Shropshire) disagrees badly and must be rejected, not applied.
          location: { name: "The Red Coach Inn", lat: 43.0866, lng: -79.0628 },
        }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add dinner at the red coach inn", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toContain("couldn't verify");
      expect(body.message).toContain("The Red Coach Inn");
      expect(body.locationReport.unverified).toEqual(["The Red Coach Inn"]);

      // And the coordinates the model got right were persisted, not Shropshire.
      const addedId = body.detail.days[0].activityIds[0];
      expect(body.detail.activities[addedId].location.lat).toBeCloseTo(43.0866, 3);
    });

    // A freshly seeded trip has no geocoded activities, so a lone lookup with
    // no model-supplied hint has no region to check against and comes back
    // `unchecked` — accepted, reported in the payload, and deliberately silent
    // in the message (see LocationEnrichmentReport.unchecked's comment).
    it("says nothing extra when a location is accepted with nothing to verify against", async () => {
      const tripId = await seedTrip();
      const geocoder = fakeGeocoder({
        "Niagara Falls State Park": [
          { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
        ],
      });
      const model = modelWithToolCalls([
        toolCall("AddDay", {}),
        toolCall("AddActivity", {
          title: "Falls",
          dayRef: "day 1",
          location: { name: "Niagara Falls State Park" },
        }),
      ]);
      const res = await handleAiRequest(
        req(tripId, { prompt: "add the falls", surface: "board" }),
        tripId,
        model,
        geocoder,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).not.toContain("couldn't verify");
      expect(body.locationReport.unchecked).toEqual(["Niagara Falls State Park"]);
    });
  });

  describe("simulated mode", () => {
    it("applies a real plan and marks it simulated", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "plan me something", surface: "board" }),
        tripId,
        simulatedModel("board"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        simulated: boolean;
        message: string;
        detail: { days: unknown[]; activities: Record<string, unknown> };
        meta: { simulated: boolean; model: { requested: string } };
      };

      // Simulated, and saying so in both channels.
      expect(body.simulated).toBe(true);
      expect(body.meta.simulated).toBe(true);
      expect(body.message).toContain("Simulated response");
      expect(body.meta.model.requested).toBe("simulated/no-op");

      // And genuinely applied — this is what separates it from a canned refusal.
      expect(body.detail.days).toHaveLength(2);
      expect(Object.keys(body.detail.activities)).toHaveLength(3);
    });

    // The geocoding mock throws on any call, so reaching this line at all proves
    // the simulated path never touched LocationIQ.
    it("never reaches the geocoder, because it emits no locations", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "plan me something", surface: "board" }),
        tripId,
        simulatedModel("board"),
      );
      const body = (await res.json()) as { locationReport: { unverified: string[]; failed: string[]; skipped: string[] } };
      expect(body.locationReport.unverified).toEqual([]);
      expect(body.locationReport.failed).toEqual([]);
      expect(body.locationReport.skipped).toEqual([]);
    });

    it("composes a valid page on the page surface", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
        tripId,
        simulatedModel("page"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { simulated: boolean; content: unknown };
      expect(body.simulated).toBe(true);
      expect(validateComposedPage(body.content as never)).not.toHaveProperty("error");
    });

    // The 32-step budget is the hazard: a model that re-emits every step applies
    // its plan once per remaining step. Two days, not sixty-four.
    it("applies the plan exactly once despite the 32-step budget", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "plan me something", surface: "board" }),
        tripId,
        simulatedModel("board"),
      );
      const body = (await res.json()) as { detail: { days: unknown[] }; meta: { steps: number } };
      expect(body.detail.days).toHaveLength(2);
      expect(body.meta.steps).toBe(2); // one step of tool calls, one to stop
    });

    it("marks an injected model as not simulated", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "add a day", surface: "board" }),
        tripId,
        modelWithToolCalls([toolCall("AddDay", {})]),
      );
      const body = (await res.json()) as { simulated: boolean; message: string };
      expect(body.simulated).toBe(false);
      expect(body.message).not.toContain("Simulated response");
    });

    // The spec's core promise, stated as a test: with AI off the endpoint works
    // on a deployment carrying no AI_GATEWAY_API_KEY at all. This is the ONLY
    // test in this file that omits the model argument, so it is the only one
    // exercising the real selectAiModel() path — AI_LIVE short-circuits before
    // the Vercel adapter is consulted, so no request scope and no network are
    // needed. If aiModel() ever creeps back onto the off path, this fails.
    it("serves a request with no model injected and no gateway key set", async () => {
      const tripId = await seedTrip();
      const priorLive = process.env.AI_LIVE;
      const priorKey = process.env.AI_GATEWAY_API_KEY;
      process.env.AI_LIVE = "false";
      delete process.env.AI_GATEWAY_API_KEY;
      try {
        const res = await handleAiRequest(req(tripId, { prompt: "plan me something", surface: "board" }), tripId);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { simulated: boolean; detail: { days: unknown[] } };
        expect(body.simulated).toBe(true);
        expect(body.detail.days).toHaveLength(2);
      } finally {
        if (priorLive === undefined) delete process.env.AI_LIVE;
        else process.env.AI_LIVE = priorLive;
        if (priorKey !== undefined) process.env.AI_GATEWAY_API_KEY = priorKey;
      }
    });

    // The flip side of the test above: flag ON but no gateway key configured.
    // selectAiModel()'s live branch calls aiModel(), which throws — this must
    // come back as the handler's standard error envelope (503), not a bare
    // unhandled-rejection 500.
    it("returns a 503 envelope when the flag is on but no gateway key is set", async () => {
      const tripId = await seedTrip();
      const priorLive = process.env.AI_LIVE;
      const priorKey = process.env.AI_GATEWAY_API_KEY;
      process.env.AI_LIVE = "true";
      delete process.env.AI_GATEWAY_API_KEY;
      try {
        const res = await handleAiRequest(req(tripId, { prompt: "plan me something", surface: "board" }), tripId);
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string; simulated: boolean };
        expect(body.simulated).toBe(false);
        expect(body.error).toContain("model selection failed");
      } finally {
        if (priorLive === undefined) delete process.env.AI_LIVE;
        else process.env.AI_LIVE = priorLive;
        if (priorKey !== undefined) process.env.AI_GATEWAY_API_KEY = priorKey;
      }
    });
  });
});
