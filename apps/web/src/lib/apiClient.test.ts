import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { HttpResponse, http } from "msw";
import * as apiClientModule from "@/lib/apiClient";
import {
  acceptInvite,
  applyAssistantProposal,
  askAssistant,
  cloneSharedTrip,
  createSavedDay,
  createTrip,
  createTripInvite,
  createTripShare,
  deleteSavedDay,
  duplicateTrip,
  leaveTrip,
  fetchInviteLanding,
  fetchPreferences,
  fetchSavedDay,
  fetchSavedDays,
  fetchSharedTrip,
  fetchTripAccess,
  fetchTripDetail,
  fetchTripGlobals,
  fetchTripWeather,
  fetchTrips,
  fetchTripDetailAt,
  fetchTripEvents,
  fetchTripHistory,
  fetchTripShares,
  insertSavedDay,
  publishSavedDay,
  resetDemoData,
  revokeTripInvite,
  revokeTripShare,
  searchCities,
  searchPlaces,
  searchPlaybooks,
  fetchReviews,
  putReview,
  deleteReview,
  createReport,
  fetchAdminReports,
  actOnReport,
  fetchLeaderboard,
  fetchPublicProfile,
  sendTripCommand,
  sendTripCommandBatch,
  unpublishSavedDay,
  updatePreferences,
  type ApiResult,
} from "@/lib/apiClient";
import { cachedRead, clearQueryCache } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { INVITE_TOKEN_HEADER, beginInviteLook } from "@/lib/inviteLook";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { historyFixture, tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("apiClient", () => {
  it("fetches and schema-validates a trip detail", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail(fixture.tripId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.name).toBe("Rome 2027");
  });

  it("sends a command and the mock applies it", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const sent = await sendTripCommand({
      type: "AddDay",
      tripId: fixture.tripId,
      dayId: "44444444-4444-4444-8444-444444444444",
    });
    expect(sent.ok).toBe(true);
    const detail = await fetchTripDetail(fixture.tripId);
    if (!detail.ok) throw new Error("expected ok");
    expect(detail.value.days).toHaveLength(1);
  });

  it("sendTripCommand returns the authoritative detail + history", async () => {
    const fixture = tripDetailFixture();
    const history = historyFixture(fixture.tripId);
    server.use(...makeTripHandlers(fixture, { history }));
    const r = await sendTripCommand({
      type: "AddDay",
      tripId: fixture.tripId,
      dayId: "44444444-4444-4444-8444-444444444444",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.detail.tripId).toBe(fixture.tripId);
    expect(r.value.detail.days).toHaveLength(1);
    expect(r.value.history.entries).toEqual(history.entries);
  });

  it("sendTripCommandBatch posts to the batch endpoint and applies every command", async () => {
    const fixture = tripDetailFixture();
    let batchRequestSeen = false;
    server.use(
      http.post("/api/trips/:tripId/commands/batch", async ({ request }) => {
        batchRequestSeen = true;
        const body = (await request.json()) as { commands: unknown[] };
        expect(body.commands).toHaveLength(2);
        return HttpResponse.json({
          ok: true,
          tripId: fixture.tripId,
          detail: {
            ...fixture,
            days: [
              {
                dayId: "44444444-4444-4444-8444-444444444444",
                activityIds: [],
                date: null,
                costSubtotal: 0,
              },
            ],
          },
          history: historyFixture(fixture.tripId),
        });
      }),
    );
    const r = await sendTripCommandBatch(fixture.tripId, [
      { type: "AddDay", tripId: fixture.tripId, dayId: "44444444-4444-4444-8444-444444444444" },
      { type: "AddDay", tripId: fixture.tripId, dayId: "55555555-5555-4555-8555-555555555555" },
    ]);
    expect(batchRequestSeen).toBe(true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.detail.days).toHaveLength(1);
  });

  it("surfaces HTTP errors as typed results", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail("00000000-0000-4000-8000-000000000000");
    if (result.ok) throw new Error("expected error");
    expect(result.error.status).toBe(404);
  });

  it("fetches and schema-validates trip history", async () => {
    const fixture = tripDetailFixture();
    const history = historyFixture(fixture.tripId);
    server.use(...makeTripHandlers(fixture, { history }));
    const result = await fetchTripHistory(fixture.tripId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual(history);
  });

  it("fetches a past detail by seq, and 404s for an unknown seq", async () => {
    const fixture = tripDetailFixture();
    const past = tripDetailFixture({ name: "Rome 2027 (earlier)" });
    server.use(...makeTripHandlers(fixture, { detailAt: { 1: past } }));
    const known = await fetchTripDetailAt(fixture.tripId, 1);
    if (!known.ok) throw new Error("expected ok");
    expect(known.value.name).toBe("Rome 2027 (earlier)");
    const unknown = await fetchTripDetailAt(fixture.tripId, 99);
    if (unknown.ok) throw new Error("expected error");
    expect(unknown.error.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The module invariant: EVERY helper resolves an ApiResult and none of them
// rejects.
//
// Nine helpers used to have no try/catch at all, and TripProvider's sequential
// sender awaits one without a try/catch of its own — so a rejected fetch
// (offline, DNS) skipped `inFlight.current = false` and gated the send queue
// permanently: "Saving…" forever, no failure recorded, no retry offered, every
// queued edit lost on navigation (docs/reviews/2026-08-28-project-review.md
// §1.1, docs/reviews/2026-08-28-m11-pr71-review.md §3). A `.parse` throw on a
// 200 reached the same place by a different door.
//
// Table-driven over the whole module rather than the two helpers the queue
// happens to use today: the totality claim is about the module, and the
// coverage test below is what stops a new helper from being added without it.
// ---------------------------------------------------------------------------

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const UUID = "22222222-2222-4222-8222-222222222222";

// Every exported helper that performs a request, and how to call it. Arguments
// only have to be well-typed — no call in this suite ever reaches a server.
const FETCHING_HELPERS: Record<string, () => Promise<ApiResult<unknown>>> = {
  createTrip: () => createTrip({ name: "Rome" }),
  fetchTripDetail: () => fetchTripDetail(TRIP_ID),
  fetchTripGlobals: () => fetchTripGlobals(TRIP_ID),
  fetchTripWeather: () => fetchTripWeather(TRIP_ID),
  fetchTrips: () => fetchTrips(),
  fetchTripHistory: () => fetchTripHistory(TRIP_ID),
  fetchTripEvents: () => fetchTripEvents(TRIP_ID, 0),
  fetchTripDetailAt: () => fetchTripDetailAt(TRIP_ID, 1),
  sendTripCommand: () => sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID }),
  sendTripCommandBatch: () =>
    sendTripCommandBatch(TRIP_ID, [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }]),
  duplicateTrip: () => duplicateTrip(TRIP_ID),
  // M26 link 6b. Not `sendTripCommand` — leaving is Access CRUD, not a
  // planning command — so it needs its own row in this table.
  leaveTrip: () => leaveTrip(TRIP_ID),
  resetDemoData: () => resetDemoData(),
  fetchTripAccess: () => fetchTripAccess(TRIP_ID),
  createTripInvite: () => createTripInvite(TRIP_ID, { email: "a@b.com", role: "editor" }),
  revokeTripInvite: () => revokeTripInvite(TRIP_ID, UUID),
  fetchInviteLanding: () => fetchInviteLanding("tok"),
  acceptInvite: () => acceptInvite("tok"),
  fetchTripShares: () => fetchTripShares(TRIP_ID),
  createTripShare: () => createTripShare(TRIP_ID),
  revokeTripShare: () => revokeTripShare(TRIP_ID, UUID),
  fetchSharedTrip: () => fetchSharedTrip("tok"),
  cloneSharedTrip: () => cloneSharedTrip("tok"),
  fetchPreferences: () => fetchPreferences(),
  updatePreferences: () => updatePreferences({ distanceUnit: "mi" }),
  fetchSavedDays: () => fetchSavedDays(),
  createSavedDay: () => createSavedDay({ name: "Day", tripId: TRIP_ID, dayIds: [UUID] }),
  deleteSavedDay: () => deleteSavedDay(UUID),
  insertSavedDay: () => insertSavedDay(TRIP_ID, UUID),
  fetchSavedDay: () => fetchSavedDay(UUID),
  publishSavedDay: () => publishSavedDay(UUID),
  unpublishSavedDay: () => unpublishSavedDay(UUID),
  searchCities: () => searchCities("Kyo"),
  searchPlaces: () => searchPlaces("Mexic"),
  searchPlaybooks: () => searchPlaybooks({ cities: ["Kyoto"] }),
  fetchLeaderboard: () => fetchLeaderboard(),
  fetchPublicProfile: () => fetchPublicProfile("dev-alice"),
  fetchReviews: () => fetchReviews(UUID),
  putReview: () => putReview(UUID, { stars: 4, note: null }),
  deleteReview: () => deleteReview(UUID),
  createReport: () =>
    createReport({ target: { kind: "saved_day", savedDayId: UUID }, reason: "spam", note: null }),
  fetchAdminReports: () => fetchAdminReports(),
  actOnReport: () => actOnReport(UUID, { action: "dismiss" }),
  askAssistant: () =>
    askAssistant(TRIP_ID, [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }], { kind: "trip" }),
  applyAssistantProposal: () =>
    applyAssistantProposal(TRIP_ID, {
      proposalId: "p1",
      changes: [],
      commands: [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }],
      inserts: [],
      skipped: [],
    }),
};

// Pure URL builders, and the two failure-shape builders every client module
// shares — they touch no network, so totality is not a claim about them.
// Anything else exported as a function has to be in the table above.
const NON_FETCHING_EXPORTS = new Set([
  "apiUrl", "inviteLink", "shareLink", "askEventFromFrame", "networkError", "refusal",
]);

// **The screen→client seam was covered; the client→URL seam was not.**
// `DiscoverScreen.test.tsx` mocks `searchPlaybooks` outright, so it proves the
// screen passes `length` along and can say nothing about whether the request
// carries it. Deleting the `params.set("length", …)` line left every test in
// the suite green — found while proving those screen tests could fail, not by
// review. These are the filters Discover is built out of, so the query string
// is worth one assertion of its own.
describe("searchPlaybooks puts its filters on the wire", () => {
  it("sends every filter it was given, repeating city rather than joining", async () => {
    let seen: URL | null = null;
    server.use(
      http.get("*/api/playbooks", ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({
          days: [],
          siblings: [],
          budgetCurrency: null,
          truncated: false,
          matchCount: 0,
          matchCountExact: true,
          sharedDayCount: 0,
        });
      }),
    );

    // Two cities, because a city name may contain a comma and joining on one
    // would invent a city called " Japan".
    const result = await searchPlaybooks({
      cities: ["Kyoto", "Osaka, Japan"],
      countries: ["JP", "MX"],
      scope: "everyone",
      sort: "newest",
      budget: "under200",
      length: "two-three",
      rating: "4.5",
    });
    expect(result.ok).toBe(true);
    expect(seen).not.toBeNull();
    expect(seen!.searchParams.getAll("city")).toEqual(["Kyoto", "Osaka, Japan"]);
    expect(seen!.searchParams.getAll("country")).toEqual(["JP", "MX"]);
    expect(seen!.searchParams.get("scope")).toBe("everyone");
    expect(seen!.searchParams.get("sort")).toBe("newest");
    expect(seen!.searchParams.get("budget")).toBe("under200");
    expect(seen!.searchParams.get("length")).toBe("two-three");
    expect(seen!.searchParams.get("rating")).toBe("4.5");
    // **No `season`.** M26 link 2 cut it (SPEC §33.2) — it filtered on the
    // month a day was run and nobody used it. Asserted as absent rather than
    // merely deleted from the call above, so a `season` that crept back into
    // the query builder fails here.
    expect(seen!.searchParams.has("season")).toBe(false);
  });

  // An omitted filter is absent rather than sent as a word the route would
  // have to interpret — `?length=` or `?length=undefined` are both worse than
  // no parameter, and the route's `.catch("any")` should never be load-bearing.
  it("omits a filter it was not given", async () => {
    let seen: URL | null = null;
    server.use(
      http.get("*/api/playbooks", ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({
          days: [],
          siblings: [],
          budgetCurrency: null,
          truncated: false,
          matchCount: 0,
          matchCountExact: true,
          sharedDayCount: 0,
        });
      }),
    );

    await searchPlaybooks({ cities: ["Kyoto"], rating: "any" });
    expect(seen!.searchParams.has("rating")).toBe(false);
    expect(seen!.searchParams.has("length")).toBe(false);
    expect(seen!.searchParams.has("budget")).toBe(false);
    expect(seen!.searchParams.has("season")).toBe(false);
  });
});

// §15's conflict banner needs WHO changed the day and WHEN. Folded into
// `ApiError` those would be a message string the banner could not word, so the
// 409 is its own arm of the outcome — and a 409 whose body is not the contract's
// shape is still an error, never a banner naming nobody.
describe("putReview reads a 409 as the day having changed", () => {
  it("returns the day-changed arm with the author and the time", async () => {
    server.use(
      http.put("*/api/saved-days/:id/reviews", () =>
        HttpResponse.json(
          { error: "day-changed", changedAt: "2026-09-21T10:00:00.000Z", authorDisplayName: "Mei Tanaka" },
          { status: 409 },
        ),
      ),
    );
    const result = await putReview(UUID, { stars: 5, note: null, seenPublishedAt: "2026-09-01T00:00:00.000Z" });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "day-changed",
        changed: { error: "day-changed", changedAt: "2026-09-21T10:00:00.000Z", authorDisplayName: "Mei Tanaka" },
      },
    });
  });

  it("treats a 409 without the contract's body as an error", async () => {
    server.use(http.put("*/api/saved-days/:id/reviews", () => HttpResponse.json({}, { status: 409 })));
    const result = await putReview(UUID, { stars: 5, note: null });
    expect(result.ok).toBe(false);
  });
});

// A held review's `seenPublishedAt` comes from here, and the three answers mean
// three different things to the server: a time (check against it), `null` ("I
// saw it unpublished" — always a 409 on a public day) and absent ("do not
// check"). Collapsing absent into `null` would turn every flush into a conflict.
describe("fetchSavedDay carries publishedAt without inventing one", () => {
  const day = {
    savedDayId: UUID,
    ownerId: "dev-alice",
    name: "Kyoto temples",
    stops: [],
    dayCount: 1,
    cities: [],
    visibility: "public",
    authorKind: "human",
    adds: 0,
    sourceTripId: TRIP_ID,
    sourceTripName: "Japan",
    createdAt: "2026-08-04T00:00:00.000Z",
  };
  const answer = (extra: Record<string, unknown>) =>
    server.use(
      http.get("*/api/saved-days/:id", () =>
        HttpResponse.json({ savedDay: day, isAuthor: false, pinning: false, ...extra }),
      ),
    );

  it("reads a time, a null and an absence as three different answers", async () => {
    answer({ publishedAt: "2026-09-01T09:00:00.000Z" });
    const at = await fetchSavedDay(UUID);
    expect(at.ok && at.value.publishedAt).toBe("2026-09-01T09:00:00.000Z");

    answer({ publishedAt: null });
    const unpublished = await fetchSavedDay(UUID);
    expect(unpublished.ok && unpublished.value.publishedAt).toBeNull();

    answer({});
    const unknown = await fetchSavedDay(UUID);
    expect(unknown.ok).toBe(true);
    expect(unknown.ok && unknown.value.publishedAt).toBeUndefined();
  });
});

// *Have a look first* (M27 D12): the look screen registers its token for one
// trip, and that trip's READS carry it. The server refuses the header on any
// write and on any other trip regardless (`requireTripAccess`), so this is
// about not sending a credential where it is not needed — a token on a write
// request is one more place it can be logged.
describe("an invite look carries its token on that trip's reads only", () => {
  const OTHER_TRIP = "33333333-3333-4333-8333-333333333333";

  it("attaches the header to a read of the looked-at trip, and nowhere else", async () => {
    const seen: { url: string; token: string | null }[] = [];
    const record = ({ request }: { request: Request }) => {
      seen.push({ url: new URL(request.url).pathname, token: request.headers.get(INVITE_TOKEN_HEADER) });
      return HttpResponse.json({ error: "not-under-test" }, { status: 500 });
    };
    server.use(http.get("*/api/trips/:tripId", record), http.post("*/api/trips/:tripId/commands", record));

    const end = beginInviteLook(TRIP_ID, "tok-123");
    await fetchTripDetail(TRIP_ID);
    await fetchTripDetail(OTHER_TRIP);
    await sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID });
    end();
    await fetchTripDetail(TRIP_ID);

    expect(seen).toEqual([
      { url: `/api/trips/${TRIP_ID}`, token: "tok-123" },
      { url: `/api/trips/${OTHER_TRIP}`, token: null },
      { url: `/api/trips/${TRIP_ID}/commands`, token: null },
      // Ended with the screen: the next read of the trip is an ordinary one.
      { url: `/api/trips/${TRIP_ID}`, token: null },
    ]);
  });
});

describe("apiClient totality — no helper ever rejects", () => {
  // The witness for the suite below: it asserts nothing about behaviour, only
  // that the table is the whole module. Without it a helper added tomorrow
  // (M11 added fourteen at once) is simply absent from the table and the
  // it.each below stays green while covering less.
  it("covers every fetching helper the module exports", () => {
    const exported = Object.entries(apiClientModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    const uncovered = exported.filter(
      (name) => !NON_FETCHING_EXPORTS.has(name) && !(name in FETCHING_HELPERS),
    );
    expect(uncovered).toEqual([]);
    // Guards the other direction too: an import that resolved to an empty
    // module would make `uncovered` trivially empty.
    expect(exported.length).toBe(NON_FETCHING_EXPORTS.size + Object.keys(FETCHING_HELPERS).length);
  });

  // Pins the mechanism the suite below depends on. `HttpResponse.error()` has
  // to make `fetch` REJECT; if it ever degraded to a plain non-ok response,
  // every assertion below would still be green while testing the ordinary
  // HTTP-error path this file already covered — the wedge would be back and
  // nothing would say so.
  it("HttpResponse.error() makes a bare fetch reject, not resolve", async () => {
    server.use(http.all("*", () => HttpResponse.error()));
    await expect(fetch(apiClientModule.apiUrl("/api/trips"))).rejects.toThrow();
  });

  it.each(Object.keys(FETCHING_HELPERS))(
    "%s resolves { ok: false, status: 0 } when the fetch rejects",
    async (name) => {
      server.use(http.all("*", () => HttpResponse.error()));
      const result = await FETCHING_HELPERS[name]!();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // status 0 is this file's shape for "no response at all" — distinct from
      // any HTTP status, so callers can tell a refusal from a network failure.
      expect(result.error.status).toBe(0);
      expect(typeof result.error.message).toBe("string");
    },
  );

  // The second door into the same wedge: the response is a perfectly good 200,
  // and the schema parse is what throws.
  it("returns an error result when a 200 body fails schema validation", async () => {
    server.use(
      http.get("*/api/trips/:tripId", () => HttpResponse.json({ trip: { nonsense: true } })),
    );
    const result = await fetchTripDetail(TRIP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// askAssistant — the streaming half.
//
// Everything here is written against the wire format `handleAskRequest`
// actually emits (task 3's report §3, itself quoted verbatim from an
// integration run), not against a guess: `data: <json>\n\n` frames terminated
// by `data: [DONE]`, tool calls before the answer, and a mid-turn failure as an
// `error` frame on a 200 rather than a non-200.
// ---------------------------------------------------------------------------

function sseResponse(
  frames: string[],
  { split = false, simulated }: { split?: boolean; simulated?: boolean } = {},
) {
  const body = frames.map((f) => `data: ${f}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(body);
      if (!split) {
        controller.enqueue(bytes);
      } else {
        // Deliberately mid-frame: a real connection splits wherever it likes,
        // and a client that parses per read() drops deltas exactly here.
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
      ...(simulated === undefined ? {} : { "x-tc-ai-simulated": String(simulated) }),
    },
  });
}

const ANSWER_FRAMES = [
  '{"type":"start"}',
  '{"type":"start-step"}',
  '{"type":"tool-input-available","toolCallId":"t1","toolName":"read_trip","input":{}}',
  '{"type":"tool-input-available","toolCallId":"t2","toolName":"read_day","input":{"day":3}}',
  '{"type":"tool-output-available","toolCallId":"t1","output":{"name":"Japan"}}',
  '{"type":"finish-step"}',
  '{"type":"text-start","id":"0"}',
  '{"type":"text-delta","id":"0","delta":"Day 3 has 5 stops. "}',
  '{"type":"text-delta","id":"0","delta":"The biggest open stretch is 17:30 to 19:30."}',
  '{"type":"text-end","id":"0"}',
  '{"type":"finish","finishReason":"stop"}',
  "[DONE]",
];

// ---------------------------------------------------------------------------
// The second module invariant (ADR-046): a helper that writes to a trip clears
// that trip's cached reads, in a `finally`, whatever the outcome.
//
// This is the half of a cache that is easy to get right once and then lose. A
// write helper added next year without an `invalidate` does not fail anything
// — it makes the board show a stale trip for five seconds after an edit, which
// nobody reproduces on purpose. So the rule is asserted per helper, and the
// table is the list of helpers that write to a trip.
//
// Asserted against a FAILING write on purpose: "whatever the outcome" is the
// part that is load-bearing and the part a `finally` is for. A response that
// never arrived may still have been applied, so a cache that believes a failed
// write changed nothing is exactly how an edit goes missing.
// ---------------------------------------------------------------------------

const TRIP_WRITERS: Record<string, () => Promise<ApiResult<unknown>>> = {
  sendTripCommand: () => sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID }),
  sendTripCommandBatch: () =>
    sendTripCommandBatch(TRIP_ID, [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }]),
  insertSavedDay: () => insertSavedDay(TRIP_ID, UUID),
  createTripInvite: () => createTripInvite(TRIP_ID, { email: "a@b.com", role: "editor" }),
  revokeTripInvite: () => revokeTripInvite(TRIP_ID, UUID),
  applyAssistantProposal: () =>
    applyAssistantProposal(TRIP_ID, {
      proposalId: "p1",
      changes: [],
      commands: [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }],
      inserts: [],
      skipped: [],
    }),
};

describe("trip writes invalidate the trip's cached reads", () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => clearQueryCache());

  /** Put a known answer in the cache under one of the trip's keys. */
  async function seed(): Promise<void> {
    await cachedRead(tripKeys.detail(TRIP_ID), async () => ({ ok: true, value: "stale" }));
  }

  /** What the cache would serve now, without going near the network. */
  async function cached(): Promise<unknown> {
    const result = await cachedRead(tripKeys.detail(TRIP_ID), async () => ({ ok: true, value: "fresh" }));
    return result.ok ? result.value : null;
  }

  it("the seed really is served from cache — otherwise every case below is vacuous", async () => {
    await seed();
    expect(await cached()).toBe("stale");
  });

  it.each(Object.keys(TRIP_WRITERS))("%s clears the trip's cache even when it fails", async (name) => {
    server.use(http.all("*", () => HttpResponse.error()));
    await seed();

    const result = await TRIP_WRITERS[name]!();

    expect(result.ok).toBe(false);
    expect(await cached()).toBe("fresh");
  });

  // THE RACE THE BROWSER WALK FOUND (PR #175), and the one neither the unit
  // suite nor the review caught — because every case here mocks the transport
  // and none of them put a read BETWEEN a write being sent and its response.
  //
  // Reproduced in a real browser on the preview: add a day, navigate away and
  // back inside the window, and the board comes back missing the day and never
  // self-corrects short of a document reload. `TripProvider` reads once on
  // mount, so a stale answer at that moment is permanent — the `finally`
  // invalidation lands after the consumer has already set its state.
  it("does not serve a pre-write entry to a read that arrives while the write is in flight", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post("*/commands", async () => {
        await held;
        return HttpResponse.error();
      }),
    );
    await cachedRead(tripKeys.detail(TRIP_ID), async () => ({ ok: true, value: "before the command" }));

    const write = sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID });
    // The remount, landing while the POST is still open.
    const duringWrite = await cachedRead(tripKeys.detail(TRIP_ID), async () => ({
      ok: true,
      value: "asked the server",
    }));
    release();
    await write;

    expect(duringWrite).toEqual({ ok: true, value: "asked the server" });
  });

  // The other half: a read taken while the write was outstanding must not be
  // STORED either, or the next mount inherits an answer the write has since
  // falsified.
  it("does not store what a read taken during the write came back with", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post("*/commands", async () => {
        await held;
        return HttpResponse.error();
      }),
    );

    const write = sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID });
    await cachedRead(tripKeys.detail(TRIP_ID), async () => ({ ok: true, value: "mid-write answer" }));
    release();
    await write;

    const after = await cachedRead(tripKeys.detail(TRIP_ID), async () => ({ ok: true, value: "settled truth" }));
    expect(after).toEqual({ ok: true, value: "settled truth" });
  });

  it("leaves another trip's cache alone", async () => {
    server.use(http.all("*", () => HttpResponse.error()));
    const other = "33333333-3333-4333-8333-333333333333";
    await cachedRead(tripKeys.detail(other), async () => ({ ok: true, value: "theirs" }));

    await sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID });

    const still = await cachedRead(tripKeys.detail(other), async () => ({ ok: true, value: "refetched" }));
    expect(still.ok && still.value).toBe("theirs");
  });
});

describe("askAssistant", () => {
  it("posts the whole thread and the scope to /ask", async () => {
    let seen: unknown;
    server.use(
      http.post("*/api/trips/:tripId/ask", async ({ request }) => {
        seen = await request.json();
        return sseResponse(ANSWER_FRAMES);
      }),
    );
    const thread: apiClientModule.AskWireMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "what's planned?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Five stops." }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "what about the next day?" }] },
    ];
    await askAssistant(TRIP_ID, thread, { kind: "day", dayIndex: 2 });
    expect(seen).toEqual({ messages: thread, scope: { kind: "day", dayIndex: 2 } });
  });

  it("streams text deltas in order and concatenates them into one answer", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES)));
    const events: apiClientModule.AskEvent[] = [];
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value.text).toBe("Day 3 has 5 stops. The biggest open stretch is 17:30 to 19:30.");
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual([
      "Day 3 has 5 stops. ",
      "The biggest open stretch is 17:30 to 19:30.",
    ]);
  });

  it("surfaces tool calls, in order, before any answer text", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES)));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("tool")).toBeLessThan(kinds.indexOf("text"));
    expect(events.filter((e) => e.type === "tool").map((e) => e.toolName)).toEqual(["read_trip", "read_day"]);
  });

  // The property the buffering exists for. Without it this test loses deltas
  // and the answer comes back truncated.
  it("reassembles frames split across network reads", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES, { split: true })));
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.text).toBe("Day 3 has 5 stops. The biggest open stretch is 17:30 to 19:30.");
  });

  // The channel a `res.ok` check cannot see: HTTP 200, and the failure inside.
  it("reports a mid-stream error frame as a failure, carrying the server's own message", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        sseResponse([
          '{"type":"start"}',
          '{"type":"text-delta","id":"0","delta":"Day 3 "}',
          '{"type":"error","errorText":"model call failed: upstream 500"}',
        ]),
      ),
    );
    const events: apiClientModule.AskEvent[] = [];
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(200);
    expect(result.error.code).toBe(apiClientModule.ASK_STREAM_ERROR_CODE);
    expect(result.error.message).toBe("model call failed: upstream 500");
    // The partial answer still reached the caller — it is on screen already.
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual(["Day 3 "]);
  });

  it("passes a pre-stream refusal's status, message and code straight through", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        HttpResponse.json(
          { error: "The assistant isn't available on the demo trip.", code: "demo-trip-unsupported" },
          { status: 403 },
        ),
      ),
    );
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(403);
    expect(result.error.code).toBe(apiClientModule.DEMO_TRIP_UNSUPPORTED_CODE);
    expect(result.error.message).toBe("The assistant isn't available on the demo trip.");
  });

  it("reports an aborted turn with its own code, not as a network failure", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES)));
    const controller = new AbortController();
    controller.abort();
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" }, () => {}, controller.signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(apiClientModule.ASK_ABORTED_CODE);
  });
});

describe("askEventFromFrame", () => {
  // The frames it must IGNORE are the contract too: the stream is a superset
  // the server may grow, and an unknown part type must never break a
  // conversation (nor render as raw JSON in the transcript).
  it.each([
    '{"type":"start"}',
    '{"type":"start-step"}',
    '{"type":"finish-step"}',
    '{"type":"text-start","id":"0"}',
    '{"type":"text-end","id":"0"}',
    '{"type":"tool-output-available","toolCallId":"t1","output":{"name":"Japan"}}',
    '{"type":"finish","finishReason":"stop"}',
    '{"type":"something-invented-next-quarter"}',
    "[DONE]",
    "",
    "not json at all",
  ])("ignores %s", (payload) => {
    expect(apiClientModule.askEventFromFrame(`data: ${payload}`)).toBeNull();
  });

  it("reads a multi-line data frame as one payload, per the SSE spec", () => {
    expect(apiClientModule.askEventFromFrame('data: {"type":"text-delta",\ndata: "delta":"hi"}')).toEqual({
      type: "text",
      delta: "hi",
    });
  });

  it("falls back to a readable message when an error frame carries no errorText", () => {
    const event = apiClientModule.askEventFromFrame('data: {"type":"error"}');
    expect(event).toEqual({ type: "error", message: "The assistant stopped mid-answer." });
  });
});

// Ruling B: `simulated` comes from a response HEADER, not from a phrase in the
// model's own answer. The three tests below are what the deleted prose sniff
// could not do.
describe("the simulated verdict", () => {
  it("is read from the header, before the first delta", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES, { simulated: true })));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events[0]).toEqual({ type: "meta", simulated: true });
  });

  it("is false when the header says so, whatever the answer's words are", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        sseResponse(
          [
            '{"type":"start"}',
            // The exact sentence the deleted `answerIsSimulated` matched. A
            // live model quoting it must not badge the answer.
            '{"type":"text-delta","id":"0","delta":"AI is switched off on this deployment, they say."}',
          ],
          { simulated: false },
        ),
      ),
    );
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "meta")).toEqual([{ type: "meta", simulated: false }]);
  });

  it("still badges a turn that dies before it says anything", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        sseResponse(['{"type":"start"}', '{"type":"error","errorText":"upstream 500"}'], { simulated: true }),
      ),
    );
    const events: apiClientModule.AskEvent[] = [];
    const result = await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(result.ok).toBe(false);
    expect(events.filter((e) => e.type === "meta")).toEqual([{ type: "meta", simulated: true }]);
  });

  it("reads a missing header as not simulated", async () => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(ANSWER_FRAMES)));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events[0]).toEqual({ type: "meta", simulated: false });
  });
});

const DETAIL = tripDetailFixture();
const HISTORY = historyFixture(DETAIL.tripId);

const PROPOSAL = {
  proposalId: "p1",
  changes: [{ type: "AddActivity", text: "Add “Coffee” to day 2" }],
  commands: [
    { type: "AddActivity", tripId: TRIP_ID, activityId: UUID, dayId: UUID, title: "Coffee" },
  ],
  inserts: [],
  skipped: [],
};

const FINISH_WITH_PROPOSAL = `{"type":"finish","finishReason":"stop","messageMetadata":${JSON.stringify({ proposal: PROPOSAL })}}`;

describe("the proposal on the wire", () => {
  it("arrives as one event, on the stream's final chunk", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () => sseResponse([...ANSWER_FRAMES, FINISH_WITH_PROPOSAL])),
    );
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    const proposals = events.filter((e) => e.type === "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.proposal.proposalId).toBe("p1");
    expect(proposals[0]!.proposal.commands).toEqual(PROPOSAL.commands);
    // It is the LAST thing the caller hears about, after the whole answer.
    expect(events.at(-1)).toBe(proposals[0]);
  });

  // The commands are posted straight back to /ask/apply, so a malformed
  // proposal has to be dropped here rather than forwarded.
  it.each([
    ['{"type":"finish","finishReason":"stop"}', "no metadata at all"],
    ['{"type":"finish","finishReason":"stop","messageMetadata":{}}', "metadata with no proposal"],
    [
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p1","commands":[]}}}',
      "an empty command list",
    ],
    [
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p1","commands":[{"type":"Nope"}]}}}',
      "a command that is not batchable",
    ],
    [
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"commands":[{"type":"AddDay","tripId":"' +
        TRIP_ID +
        '","dayId":"' +
        UUID +
        '"}]}}}',
      "no proposalId",
    ],
  ])("drops %s (%s)", async (frame) => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });

  // ADR-042 Decision 1: a turn whose only write call was `insert_playbook_day`
  // resolves to zero commands, so "no commands" stopped being the same question
  // as "nothing to review".
  it("keeps a proposal that carries only an insert", async () => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p2","commands":[],' +
      '"inserts":[{"savedDayId":"' +
      UUID +
      '","name":"A day in Kyoto"}],"changes":[],"skipped":[]}}}';
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    const proposals = events.filter((e) => e.type === "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.proposal.inserts).toEqual([{ savedDayId: UUID, name: "A day in Kyoto" }]);
  });

  // Parsed all-or-nothing, the same rule `commands` is under. These go straight
  // back to /ask/apply.
  it.each([
    ['"inserts":[{"name":"nameless"}]', "an entry with no savedDayId"],
    ['"inserts":[{"savedDayId":"","name":"empty"}]', "an empty savedDayId"],
    ['"inserts":["' + UUID + '"]', "a bare string instead of an entry"],
    ['"inserts":"not-a-list"', "inserts that is not a list at all"],
  ])("drops %s (%s), and with it the whole proposal", async (insertsJson) => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p3","commands":[],' +
      insertsJson +
      ',"changes":[],"skipped":[]}}}';
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });

  // The mixed case is the one that made this all-or-nothing rather than a
  // filter. `changes` is a separate server-provided array, so a proposal that
  // kept its good insert and silently dropped the malformed one would still
  // RENDER both sentences: the user approves two library days and commits one.
  it("drops the whole proposal when ONE insert of several is malformed", async () => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p4",' +
      '"commands":[{"type":"AddDay","tripId":"' +
      TRIP_ID +
      '","dayId":"' +
      UUID +
      '"}],"inserts":[{"savedDayId":"' +
      UUID +
      '","name":"A day in Kyoto"},{"name":"nameless"}],' +
      '"changes":[{"type":"AddDay","text":"Add a day"},' +
      '{"type":"AddDay","text":"Add “A day in Kyoto” from the library"},' +
      '{"type":"AddDay","text":"Add “nameless” from the library"}],"skipped":[]}}}';
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });

  // **The cases the `typeof` guards waved through** (P6, KI-22). `changes` and
  // `skipped` were read with a `flatMap`/`filter` that dropped a bad entry and
  // kept the rest, so a proposal reached the card describing FEWER changes than
  // Approve would commit — the same desync the insert rule above exists to
  // prevent, pointed the other way. The envelope is a `@tc/contracts` schema
  // now and the whole payload fails to parse.
  //
  // The "nothing in it at all" row is the `AssistantProposal` refine, reached
  // deliberately: the "an empty command list" row further up omits `changes`
  // entirely, so it is now dropped for a missing field rather than for being
  // empty, and would not exercise this rule.
  it.each([
    [
      '"changes":[{"type":"AddDay","text":"Add a day"},{"type":"AddDay"}]',
      "one change of two missing its sentence",
    ],
    ['"changes":[{"type":"activity.move","text":"Move “Dinner” to day 2"}]', "a change typed as no command"],
    ['"changes":[],"skipped":["could not find “Fuglen”",7]', "a skipped reason that is not a sentence"],
  ])("drops a proposal carrying %s (%s)", async (fieldsJson) => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p5",' +
      '"commands":[{"type":"AddDay","tripId":"' +
      TRIP_ID +
      '","dayId":"' +
      UUID +
      '"}],"inserts":[],"skipped":[],' +
      fieldsJson +
      "}}}";
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });

  it("drops a well-formed proposal with nothing in it to review", async () => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":{"proposal":{"proposalId":"p6",' +
      '"commands":[],"inserts":[],"changes":[],"skipped":[]}}}';
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toEqual([]);
  });

  // Forward compatibility, and it is not free-floating politeness: the same
  // reader ignores stream part types it does not know for exactly this reason.
  // A key a newer deployment adds beside the proposal must cost the user
  // nothing, so the envelope's payload branches strip rather than refuse.
  it("keeps the proposal when a newer server sends a key beside it", async () => {
    const frame =
      '{"type":"finish","finishReason":"stop","messageMetadata":' +
      JSON.stringify({ proposal: PROPOSAL, warning: "from the future" }) +
      "}";
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', frame])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "trip" }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(1);
  });
});

// The composed page rides the SAME final chunk as a proposal, and never beside
// one: the server's tool sets are disjoint (the surface table in
// `assistant/grants.ts`), so the scope that asked decides which arrives.
describe("a page turn's inserts on the wire", () => {
  const INSERTS = { content: { type: "doc", content: [{ type: "paragraph", content: [] }] } };
  const finishWith = (metadata: unknown) =>
    `{"type":"finish","finishReason":"stop","messageMetadata":${JSON.stringify(metadata)}}`;

  it("arrives as one event, on the stream's final chunk", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        sseResponse([...ANSWER_FRAMES, finishWith({ pageInserts: INSERTS })]),
      ),
    );
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "page", pageId: UUID }, (e) => events.push(e));
    const pages = events.filter((e) => e.type === "page-inserts");
    expect(pages).toHaveLength(1);
    // `PAGE.content` goes over the wire with no `v` — the shape every document
    // written before ADR-038 has — and arrives carrying one, because the client
    // parses it as a `PageDoc` now. That default is decision 2's single
    // permitted inference: v1 is the only version that has ever existed.
    expect(pages[0]).toEqual({
      type: "page-inserts",
      content: { ...INSERTS.content, v: CURRENT_PAGE_DOC_VERSION },
    });
    expect(events.at(-1)).toBe(pages[0]);
  });

  // The server's own refusal reason — a macro whose params its registry schema
  // rejects, or a turn that never composed. It has to reach the panel: silently
  // doing nothing after "Generate" is a dead end.
  it("passes the server's compose refusal through as page-error", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask", () =>
        sseResponse(['{"type":"start"}', finishWith({ composeError: 'Macro "cost.day" params failed validation.' })]),
      ),
    );
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "page", pageId: UUID }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "page-error")).toEqual([
      { type: "page-error", message: 'Macro "cost.day" params failed validation.' },
    ]);
  });

  // The content goes straight into the editor and then into `updatePage`, so a
  // doc that would not survive a save must not reach the editor either.
  const MALFORMED: [unknown, string][] = [
    [{ composedPage: { title: "T" } }, "no content"],
    [{ composedPage: { title: "T", content: { type: "not-a-doc" } } }, "content that is not a doc"],
    [{ pageInserts: { content: { type: "notADoc" } } }, "content that is not a doc"],
    [{ pageInserts: {} }, "no content at all"],
    [{ composeError: "" }, "an empty refusal"],
    [{}, "metadata with neither"],
  ];

  it.each(MALFORMED)("drops %j (%s)", async (metadata) => {
    server.use(http.post("*/api/trips/:tripId/ask", () => sseResponse(['{"type":"start"}', finishWith(metadata)])));
    const events: apiClientModule.AskEvent[] = [];
    await askAssistant(TRIP_ID, [], { kind: "page", pageId: UUID }, (e) => events.push(e));
    expect(events.filter((e) => e.type === "page-inserts" || e.type === "page-error")).toEqual([]);
  });
});

describe("applyAssistantProposal", () => {
  it("posts the reviewed commands to /ask/apply and returns the server's receipt", async () => {
    let seen: unknown;
    server.use(
      http.post("*/api/trips/:tripId/ask/apply", async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ detail: DETAIL, history: HISTORY, message: "Done — added “Coffee” to day 2." });
      }),
    );
    const result = await applyAssistantProposal(TRIP_ID, PROPOSAL as never);
    // `inserts` rides along even when empty: the server reads it as the other
    // half of "at least one change", so omitting it would be a different body.
    expect(seen).toEqual({ proposalId: "p1", commands: PROPOSAL.commands, inserts: [] });
    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value.message).toBe("Done — added “Coffee” to day 2.");
    expect(result.value.detail.tripId).toBe(DETAIL.tripId);
    // Approving calls no model, so it claims no authorship of its own.
    expect(result.value.simulated).toBe(false);
  });

  it("passes a refusal's status and code through, so the card can say why", async () => {
    server.use(
      http.post("*/api/trips/:tripId/ask/apply", () =>
        HttpResponse.json({ error: "someone else changed this trip", code: "concurrency-conflict" }, { status: 409 }),
      ),
    );
    const result = await applyAssistantProposal(TRIP_ID, PROPOSAL as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(409);
    expect(result.error.code).toBe("concurrency-conflict");
  });
});
