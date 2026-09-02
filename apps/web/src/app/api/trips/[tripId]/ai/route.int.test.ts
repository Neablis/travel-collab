import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";
import { validateComposedPage } from "@/server/ai/pageTools";
import { getGeocoder } from "@/server/geocoding";
import { simulatedModel } from "@/server/ai/simulatedModel";
import { aiStepQuotas } from "@/server/quota";

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

// The page the model composes when a test only needs the request to succeed.
// `modelWithToolCalls` supplies the "stop" tail, so this is two steps: one
// carrying the tool call, one ending the run.
function composingModel() {
  return modelWithToolCalls([
    toolCall("compose_page", {
      title: "Trip Notes",
      blocks: [{ type: "paragraph", text: "Some notes." }],
    }),
  ]);
}

// No DB truncation: every test seeds its own randomUUID() tripId and every
// assertion reads back through that trip's response body — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6). currentUserId still resets every test — that's mock auth state,
// not DB state.
//
// `rate_limit_counters` is the one exception, and it has to be: it is keyed by
// ACTOR, not by trip, so unlike every other row here it is state this file's
// tests genuinely share. Twenty-odd requests as ACTOR_ID would otherwise walk
// into the hourly ceiling partway through the file, and the failure would land
// on whichever test happened to be ~30th that day. Nothing else is deleted, so
// other int suites running against the same database are untouched.
describe("POST /api/trips/:id/ai", () => {
  beforeEach(async () => {
    currentUserId = ACTOR_ID;
    await db.delete(rateLimitCounters);
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

  // Regression test, kept after ADR-033 retired the surfaces that geocoded.
  // `geocoder` used to be a `Geocoder = getGeocoder()` default parameter,
  // evaluated at call time whenever omitted — which is every real request,
  // since route.ts's `POST` calls `handleAiRequest(request, tripId)` with no
  // further arguments. `getGeocoder()` throws if LOCATIONIQ_API_KEY is unset,
  // so that broke page-surface requests over data they never touch. The
  // enrichment step and the parameter are both gone now, which makes this
  // structural rather than behavioural — and that is the reason to keep it:
  // it is what fails if enrichment is ever wired back onto page authoring.
  // The lazy-resolution rule itself lives on in writeTools.ts, which is where
  // /ask still enriches.
  it("page surface: succeeds with no geocoder argument, and never constructs one", async () => {
    const tripId = await seedTrip();
    const res = await handleAiRequest(
      // Exactly how route.ts's POST calls handleAiRequest for a real request.
      req(tripId, { prompt: "compose a notes page", surface: "page", pageContext: { tripId } }),
      tripId,
      composingModel(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content.type).toBe("doc");
    expect(getGeocoder).not.toHaveBeenCalled();
  });

  describe("simulated mode", () => {
    it("composes a real page and marks it simulated", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
        tripId,
        simulatedModel("page"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        simulated: boolean;
        content: unknown;
        meta: { simulated: boolean; model: { requested: string } };
      };

      // Simulated, and saying so in both channels.
      expect(body.simulated).toBe(true);
      expect(body.meta.simulated).toBe(true);
      expect(body.meta.model.requested).toBe("simulated/no-op");

      // And a genuinely usable draft — this is what separates it from a canned
      // refusal. `ai-live` is off in every Vercel environment, so this branch IS
      // Notebook AI-authoring on a deployment (ADR-033's consequences).
      expect(validateComposedPage(body.content as never)).not.toHaveProperty("error");
    });

    // The step budget is the hazard: a model that re-emits on every step
    // composes once per remaining step, and every one of those round-trips is
    // settled against the actor's quota (KI-67). One compose, two steps — the
    // tool call and the stop that follows it.
    it("composes exactly once despite the 3-step budget", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
        tripId,
        simulatedModel("page"),
      );
      const body = (await res.json()) as { meta: { steps: number; truncated: boolean } };
      expect(body.meta.steps).toBe(2);
      expect(body.meta.truncated).toBe(false);
    });

    it("marks an injected model as not simulated", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
        tripId,
        composingModel(),
      );
      const body = (await res.json()) as { simulated: boolean; meta: { simulated: boolean } };
      expect(body.simulated).toBe(false);
      expect(body.meta.simulated).toBe(false);
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
        const res = await handleAiRequest(
          req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
          tripId,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { simulated: boolean; content: unknown };
        expect(body.simulated).toBe(true);
        expect(validateComposedPage(body.content as never)).not.toHaveProperty("error");
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
        const res = await handleAiRequest(
          req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
          tripId,
        );
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
  // Security review 2026-08-28, H1: the endpoint had no prompt cap and no rate
  // limit, so any signed-in account could loop near-body-limit prompts through
  // a 32-round-trip handler on the operator's gateway key.
  describe("spend controls", () => {
    // A model that fails the test if it is ever reached — a request refused by
    // the cap or the limiter must cost nothing at the provider.
    const modelThatMustNotRun = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("the model was called for a request that should have been refused");
        },
      });

    it("rejects an over-long prompt with a 400 that names the rule, never reaching a model", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "x".repeat(4001), surface: "page", pageContext: { tripId } }),
        tripId,
        modelThatMustNotRun(),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("prompt must be 4000 characters or fewer");
    });

    it("accepts a prompt exactly at the cap", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "x".repeat(4000), surface: "page", pageContext: { tripId } }),
        tripId,
        composingModel(),
      );
      expect(res.status).toBe(200);
    });

    it("does not refuse a normal single request", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "draft this page", surface: "page", pageContext: { tripId } }),
        tripId,
        composingModel(),
      );
      expect(res.status).toBe(200);
    });

    // The other half of KI-67's fix, end to end through the handler and the
    // real counter table: admission pre-authorises ONE round-trip and
    // `settleAiSteps` charges the rest once `generateText` returns. Two steps
    // (the compose, then the stop) must therefore leave 2 on the step bucket
    // while the request bucket sees exactly 1 — the whole point of metering
    // what a request COSTS separately from how often it may be made.
    it("charges the step bucket what the answer really cost, not one per request", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "draft this page", surface: "page", pageContext: { tripId } }),
        tripId,
        composingModel(),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { meta: { steps: number } }).meta.steps).toBe(2);

      const hitsByBucket = new Map(
        (await db.select().from(rateLimitCounters)).map((row) => [row.bucket, row.hits] as const),
      );
      const stepPolicy = aiStepQuotas()[0]!.name;
      expect(hitsByBucket.get(`${stepPolicy}:user:${ACTOR_ID}`)).toBe(2);
      expect(hitsByBucket.get(`${stepPolicy}:global`)).toBe(2);
      expect(hitsByBucket.get(`ai-hourly:user:${ACTOR_ID}`)).toBe(1);
    });

    it("refuses the request after the per-user ceiling with a 429, and never calls the model", async () => {
      vi.stubEnv("AI_RATE_LIMIT_PER_USER_HOURLY", "2");
      try {
        const tripId = await seedTrip();
        const ok = (prompt: string) =>
          handleAiRequest(
            req(tripId, { prompt, surface: "page", pageContext: { tripId } }),
            tripId,
            composingModel(),
          );
        expect((await ok("one")).status).toBe(200);
        expect((await ok("two")).status).toBe(200);

        const refused = await handleAiRequest(
          req(tripId, { prompt: "three", surface: "page", pageContext: { tripId } }),
          tripId,
          modelThatMustNotRun(),
        );
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
        const body = (await refused.json()) as { reason: string };
        expect(body.reason).toBe("user");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // The ceiling is a property of the actor, not of the deployment or the trip
    // — one abusive account must not lock everyone else out (that is what the
    // separate, much higher global ceiling is for).
    it("meters each actor separately", async () => {
      vi.stubEnv("AI_RATE_LIMIT_PER_USER_HOURLY", "1");
      try {
        const tripId = await seedTrip();
        expect(
          (
            await handleAiRequest(
              req(tripId, { prompt: "one", surface: "page", pageContext: { tripId } }),
              tripId,
              composingModel(),
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await handleAiRequest(
              req(tripId, { prompt: "two", surface: "page", pageContext: { tripId } }),
              tripId,
              composingModel(),
            )
          ).status,
        ).toBe(429);

        // A second member of the same trip, with their own untouched allowance.
        currentUserId = OUTSIDER_ID;
        const otherTrip = await executeTripCommand(
          { type: "CreateTrip", tripId: randomUUID(), name: "Lisbon" },
          OUTSIDER_ID,
        );
        expect(otherTrip.ok).toBe(true);
        const otherTripId = otherTrip.ok ? otherTrip.detail.tripId : "";
        expect(
          (
            await handleAiRequest(
              req(otherTripId, { prompt: "one", surface: "page", pageContext: { tripId: otherTripId } }),
              otherTripId,
              composingModel(),
            )
          ).status,
        ).toBe(200);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("charges nothing for a request rejected before validation passes", async () => {
      const tripId = await seedTrip();
      const res = await handleAiRequest(
        req(tripId, { prompt: "", surface: "page", pageContext: { tripId } }),
        tripId,
        modelThatMustNotRun(),
      );
      expect(res.status).toBe(400);
      expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
    });
  });
});
