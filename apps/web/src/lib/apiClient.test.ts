import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  fetchInvitePreview,
  fetchPreferences,
  fetchSavedDay,
  fetchSavedDays,
  fetchSharedTrip,
  fetchTripAccess,
  fetchTripDetail,
  fetchTripGlobals,
  fetchTrips,
  fetchTripDetailAt,
  fetchTripHistory,
  fetchTripShares,
  insertSavedDay,
  publishSavedDay,
  resetDemoData,
  revokeTripInvite,
  revokeTripShare,
  searchCities,
  searchPlaybooks,
  fetchLeaderboard,
  fetchPublicProfile,
  sendTripCommand,
  sendTripCommandBatch,
  unpublishSavedDay,
  updatePreferences,
  type ApiResult,
} from "@/lib/apiClient";
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
  fetchTrips: () => fetchTrips(),
  fetchTripHistory: () => fetchTripHistory(TRIP_ID),
  fetchTripDetailAt: () => fetchTripDetailAt(TRIP_ID, 1),
  sendTripCommand: () => sendTripCommand({ type: "AddDay", tripId: TRIP_ID, dayId: UUID }),
  sendTripCommandBatch: () =>
    sendTripCommandBatch(TRIP_ID, [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }]),
  duplicateTrip: () => duplicateTrip(TRIP_ID),
  resetDemoData: () => resetDemoData(),
  fetchTripAccess: () => fetchTripAccess(TRIP_ID),
  createTripInvite: () => createTripInvite(TRIP_ID, { email: "a@b.com", role: "editor" }),
  revokeTripInvite: () => revokeTripInvite(TRIP_ID, UUID),
  fetchInvitePreview: () => fetchInvitePreview("tok"),
  acceptInvite: () => acceptInvite("tok"),
  fetchTripShares: () => fetchTripShares(TRIP_ID),
  createTripShare: () => createTripShare(TRIP_ID),
  revokeTripShare: () => revokeTripShare(TRIP_ID, UUID),
  fetchSharedTrip: () => fetchSharedTrip("tok"),
  cloneSharedTrip: () => cloneSharedTrip("tok"),
  fetchPreferences: () => fetchPreferences(),
  updatePreferences: () => updatePreferences({ distanceUnit: "mi" }),
  fetchSavedDays: () => fetchSavedDays(),
  createSavedDay: () => createSavedDay({ name: "Day", tripId: TRIP_ID, dayId: UUID }),
  deleteSavedDay: () => deleteSavedDay(UUID),
  insertSavedDay: () => insertSavedDay(TRIP_ID, UUID),
  fetchSavedDay: () => fetchSavedDay(UUID),
  publishSavedDay: () => publishSavedDay(UUID),
  unpublishSavedDay: () => unpublishSavedDay(UUID),
  searchCities: () => searchCities("Kyo"),
  searchPlaybooks: () => searchPlaybooks({ cities: ["Kyoto"] }),
  fetchLeaderboard: () => fetchLeaderboard(),
  fetchPublicProfile: () => fetchPublicProfile("dev-alice"),
  askAssistant: () =>
    askAssistant(TRIP_ID, [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }], { kind: "trip" }),
  applyAssistantProposal: () =>
    applyAssistantProposal(TRIP_ID, {
      proposalId: "p1",
      changes: [],
      commands: [{ type: "AddDay", tripId: TRIP_ID, dayId: UUID }],
      skipped: [],
    }),
};

// Pure URL builders — they touch no network, so totality is not a claim about
// them. Anything else exported as a function has to be in the table above.
const NON_FETCHING_EXPORTS = new Set(["apiUrl", "inviteLink", "shareLink", "askEventFromFrame"]);

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
});

// The composed page rides the SAME final chunk as a proposal, and never beside
// one: the server's tool sets are disjoint (`offeredToolNamesFor`), so the scope
// that asked decides which arrives.
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
    expect(seen).toEqual({ proposalId: "p1", commands: PROPOSAL.commands });
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
