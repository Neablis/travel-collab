import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { TurnTrace } from "@/lib/askDebug";
import { db } from "@/server/db/client";
import { aiCapabilityGaps, aiTurnOutcomes, users } from "@/server/db/schema";
import type { TurnLedger } from "@/server/assistant/ledger";
import { recordTurnLedger } from "@/server/entitlements/usage";
import { upsertUser } from "@/server/users";

// The breakdown row's trace (M57 part 5): operators only, and the ledger's one
// content-bearing column (`ai_capability_gaps.task`) never reaches anyone else.
const RUN = randomUUID().slice(0, 8);
const ADMIN = `tt-admin-${RUN}`;
const MEMBER = `tt-member-${RUN}`;
const TURN = randomUUID();

let currentUserId: string | null = ADMIN;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

await upsertUser({ id: ADMIN, email: `${ADMIN}@example.test`, name: null, image: null });
await upsertUser({ id: MEMBER, email: `${MEMBER}@example.test`, name: null, image: null });
await db.update(users).set({ isAdmin: true }).where(eq(users.id, ADMIN));

const MODEL = "deepseek/deepseek-v4-flash-0731";
// A second model on the later step, as an escalated or switched turn has: the
// turn is priced step by step at the model each ran on, not at `turn_model`.
const OTHER_MODEL = "zai/glm-4.7-flashx";
const ledger: TurnLedger = {
  cost: {
    userId: MEMBER,
    endpoint: "ask",
    outcome: "completed",
    taskClass: "plan",
    classifierCertainty: null,
    turn: { model: MODEL, tokensIn: 100, tokensOut: 20 },
    classifier: null,
    steps: 2,
    planVersionRef: null,
    turnId: TURN,
    latencyMs: 1500,
    planExamples: null,
    entryPersona: "schedule",
  },
  capacity: [],
  toolCalls: [
    { callId: "c1", name: "switch_persona", ms: 2, ok: true, outcome: "ok", stepIndex: 0, inputBytes: 5, outputBytes: 5, reachedProposal: null },
    { callId: "c2", name: "search_places", ms: 300, ok: true, outcome: "ok", stepIndex: 1, inputBytes: 5, outputBytes: 50, reachedProposal: null },
  ],
  stepSpend: [
    { index: 0, model: MODEL, tier: "low", tokensIn: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, tokensOut: 1_000_000, finishReason: "tool-calls", escalated: false, pivoted: false, durationMs: 800, provider: null, gatewayGenerationId: null, persona: "schedule" },
    { index: 1, model: OTHER_MODEL, tier: "low", tokensIn: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 0, tokensOut: 1_000_000, finishReason: "stop", escalated: false, pivoted: false, durationMs: 700, provider: null, gatewayGenerationId: null, persona: "discover", fromPersona: "schedule", edgeKind: "switch" },
  ],
};
await recordTurnLedger(ledger);
await db.insert(aiTurnOutcomes).values({ id: randomUUID(), turnId: TURN, kind: "proposal_applied", at: new Date(), actor: MEMBER });
await db.insert(aiCapabilityGaps).values({ id: randomUUID(), turnId: TURN, persona: "discover", target: "nowhere", task: "book a flight", createdAt: new Date() });

const get = (turnId: string) => GET(new Request("http://test.local/x"), { params: Promise.resolve({ turnId }) });

describe("GET /api/admin/assistant/turns/[turnId]", () => {
  it("is a 404 to a member who is not an operator, even for the turn they asked", async () => {
    currentUserId = MEMBER;
    expect((await get(TURN)).status).toBe(404);
  });

  it("gives an operator the turn's steps, calls and outcomes", async () => {
    currentUserId = ADMIN;
    const res = await get(TURN);
    expect(res.status).toBe(200);
    const { trace } = (await res.json()) as { trace: TurnTrace };
    expect(trace.entryPersona).toBe("schedule");
    // Priced per step at each step's own model (modelRates.ts): step 0 is 1M in
    // at 130000 plus 1M out at 260000 = 390000; step 1 is 500k fresh in at 60000,
    // 500k cached at 10000 and 1M out at 400000 = 435000. Pricing both at
    // `turn_model`, or dropping the cached rate, gives a different figure.
    expect(trace.costMicroUsd).toBe(825_000);
    expect(trace.steps.map((s) => [s.persona, s.crossed?.kind ?? null, s.calls.map((c) => c.tool)])).toEqual([
      ["schedule", null, ["switch_persona"]],
      ["discover", "switch", ["search_places"]],
    ]);
    expect(trace.outcomes.map((o) => o.kind)).toEqual(["proposal_applied"]);
    expect(trace.gaps).toEqual([{ persona: "discover", target: "nowhere", task: "book a flight" }]);
  });

  it("is a 404 for a turn that has no ledger row, and for an id that is not one", async () => {
    currentUserId = ADMIN;
    expect((await get(randomUUID())).status).toBe(404);
    expect((await get("not-a-turn")).status).toBe(404);
  });
});
