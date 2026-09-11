import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked so the real module — and therefore `flags/next`, which reaches for
// next/headers and a request scope — never loads in a unit test.
const aiLiveFlag = vi.fn<() => Promise<boolean>>();
vi.mock("@/server/flags", () => ({ aiLiveFlag: () => aiLiveFlag() }));

// aiModel() throws without AI_GATEWAY_API_KEY; stub both so the live branch is
// testable without a key, and so a stray call is visible. They are separate
// spies on purpose: the whole risk of a second model id is that it becomes a
// second way to reach a provider, and "the classifier was not constructed
// either" is only assertable if it can be counted on its own.
// `aiModel` echoes the id it was handed, because the tier map is the thing
// under test: a stub that returned one constant for every tier would make
// "each slot resolved to its own configured id" unassertable.
const aiModel = vi.fn((modelId?: string) => `gateway/${modelId ?? "default"}`);
const aiClassifierModel = vi.fn(() => "gateway/fake-classifier");
vi.mock("@/server/ai/gateway", () => ({
  aiModel: (modelId?: string) => aiModel(modelId),
  aiClassifierModel: () => aiClassifierModel(),
}));

const { aiLive, aiLiveMode, selectAiModel, deniedResponse, resolvedTierMap } = await import(
  "@/server/ai/modelSelection"
);
const { SIMULATED_MODEL_ID } = await import("@/server/ai/simulatedModel");
const { PERMITS_EVERYTHING, NO_CEILINGS } = await import("@/server/assistant/entitlements");
const { MODEL_TIERS } = await import("@/server/assistant/taskClass");

// An account entitled to nothing. The `denied` branch has no production trigger
// — there is no account tier in the product — so this is the only thing that
// reaches it, exactly as the boolean `() => false` was before P5 widened the
// port.
const REFUSES_EVERYTHING = { has: () => false, ceilings: NO_CEILINGS, planVersionRef: null };

const ORIGINAL = process.env.AI_LIVE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_LIVE;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AI_LIVE;
  else process.env.AI_LIVE = ORIGINAL;
});

describe("aiLive", () => {
  it("consults the flag when AI_LIVE is unset", async () => {
    aiLiveFlag.mockResolvedValue(true);
    await expect(aiLive()).resolves.toBe(true);
    expect(aiLiveFlag).toHaveBeenCalledOnce();
  });

  it('treats AI_LIVE="true" as live without consulting the flag', async () => {
    process.env.AI_LIVE = "true";
    await expect(aiLive()).resolves.toBe(true);
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  it('treats AI_LIVE="false" as simulated without consulting the flag', async () => {
    process.env.AI_LIVE = "false";
    aiLiveFlag.mockResolvedValue(true);
    await expect(aiLive()).resolves.toBe(false);
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  // Anything that isn't exactly "true" is off. A typo must not spend money.
  it("treats any other AI_LIVE value as simulated", async () => {
    for (const value of ["", "1", "yes", "TRUE", "live"]) {
      process.env.AI_LIVE = value;
      await expect(aiLive()).resolves.toBe(false);
    }
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  // aiLiveFlag()'s own `defaultValue: false` only covers a throw/undefined
  // from inside the SDK's `decide` — it does NOT cover readOverrides /
  // decryptOverrides throwing earlier in getRun(), which happens when
  // FLAGS_SECRET is unset/malformed and a stray override cookie is present.
  // aiLive() must fail closed (simulated) rather than let that throw become
  // an unhandled rejection out of the AI handler.
  it("resolves to false, not rejects, when the flag throws", async () => {
    aiLiveFlag.mockRejectedValue(new Error("readOverrides: invalid FLAGS_SECRET"));
    await expect(aiLive()).resolves.toBe(false);
  });
});

// `source` is the half of the answer that says how far it generalises, and it
// exists because the `ai-live` flag is per-user targetable (ADR-019 amendment
// 2026-09-08). e2e's global setup clears a whole suite on it, so getting it
// backwards would let a run that could bill a real model proceed.
describe("aiLiveMode", () => {
  it('reports source "env" when AI_LIVE decided it, for both values', async () => {
    process.env.AI_LIVE = "false";
    await expect(aiLiveMode()).resolves.toEqual({ live: false, source: "env" });
    process.env.AI_LIVE = "true";
    await expect(aiLiveMode()).resolves.toEqual({ live: true, source: "env" });
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  it('reports source "flag" when the flag decided it', async () => {
    aiLiveFlag.mockResolvedValue(true);
    await expect(aiLiveMode()).resolves.toEqual({ live: true, source: "flag" });
  });

  // The degrade path still says where it came from. Reporting `"env"` here
  // would claim a server-wide guarantee on the strength of a failed lookup.
  it('reports a failed flag read as not live, and still as source "flag"', async () => {
    aiLiveFlag.mockRejectedValue(new Error("identify: JWT decryption failed"));
    await expect(aiLiveMode()).resolves.toEqual({ live: false, source: "flag" });
  });
});

const ACTOR = { surface: "ask" as const, userId: "user-1" };

describe("selectAiModel", () => {
  it("returns a model for every tier, and its own classifier model, when the flag is on", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel(ACTOR);
    expect(selected).toMatchObject({
      outcome: "live",
      // Nothing sets AI_MODEL_* here, so all three slots fall through to the
      // same configured id — which is the property that makes tiering a
      // no-behaviour-change default rather than a routing change.
      models: {
        cheap: "gateway/anthropic/claude-haiku-4-5",
        mid: "gateway/anthropic/claude-haiku-4-5",
        strong: "gateway/anthropic/claude-haiku-4-5",
      },
      classifierModel: "gateway/fake-classifier",
    });
    // One gateway client per slot, eagerly. Three rather than one is the cost
    // of not making the "never constructs a client when the flag is off"
    // promise vacuous by deferring construction on both branches.
    expect(aiModel).toHaveBeenCalledTimes(MODEL_TIERS.length);
    expect(aiClassifierModel).toHaveBeenCalledOnce();
  });

  // **Each slot reads its OWN variable.** Without this the three defaults are
  // identical and every other assertion in this file passes against an
  // implementation that ignored the tier map entirely and returned `AI_MODEL`
  // three times — which is the shape a "no behaviour change" default is most
  // likely to hide.
  //
  // Isolated rather than stubbed in place: `serverConfig` is read at module
  // load, as it has always been, so moving a variable needs a fresh module
  // graph rather than a `vi.stubEnv` the already-loaded object cannot see.
  it("resolves each slot from its own variable", async () => {
    vi.resetModules();
    vi.stubEnv("AI_MODEL", "vendor/base");
    vi.stubEnv("AI_MODEL_CHEAP", "vendor/tiny");
    vi.stubEnv("AI_MODEL_STRONG", "vendor/huge");
    try {
      const isolated = await import("@/server/ai/modelSelection");
      expect(isolated.resolvedTierMap()).toMatchObject({
        cheap: "vendor/tiny",
        // Unset, so it falls through to AI_MODEL — not to the compiled default,
        // which is the fall-through `AI_CLASSIFIER_MODEL` already follows.
        mid: "vendor/base",
        strong: "vendor/huge",
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  // **No model id is a literal in kernel code** (spec §5b). The whole of this
  // deployment's routing is one object of configured strings, and it is
  // reportable — which is what closes the gap M20 link 5 records, where a
  // compiled default and a configured model disagreed and one cost estimate
  // came out an order of magnitude high.
  it("reports the resolved tier map, ids and all, without consulting the flag", () => {
    expect(resolvedTierMap()).toEqual({
      cheap: "anthropic/claude-haiku-4-5",
      mid: "anthropic/claude-haiku-4-5",
      strong: "anthropic/claude-haiku-4-5",
      classifier: "anthropic/claude-haiku-4-5",
    });
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  it("returns the simulated model when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    const selected = await selectAiModel(ACTOR);
    expect(selected.outcome).toBe("simulated");
    expect(selected).toMatchObject({
      // Every slot, not just the one a default turn would use: a tier that
      // resolved live while the others were simulated would spend on exactly
      // the turns the badge says are free.
      models: {
        cheap: { modelId: SIMULATED_MODEL_ID },
        mid: { modelId: SIMULATED_MODEL_ID },
        strong: { modelId: SIMULATED_MODEL_ID },
      },
      classifierModel: { modelId: SIMULATED_MODEL_ID },
    });
  });

  // The whole point of the kill switch: the flag-off path must not construct a
  // gateway client, which is what would carry the API key and the spend.
  //
  // Asserted for the CLASSIFIER too, and that is the point of it existing as a
  // second spy. A second model id is a second way to reach a provider, and the
  // failure this rules out — a classifier that resolves live while the answer
  // model is simulated — would spend on every editor turn of every deployment
  // while the Simulated badge kept saying nothing was being spent.
  it("never constructs a gateway client, of either kind, when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    await selectAiModel(ACTOR);
    await selectAiModel({ surface: "ask", userId: "user-1" });
    expect(aiModel).not.toHaveBeenCalled();
    expect(aiClassifierModel).not.toHaveBeenCalled();
  });

  // `denied` is unreachable in production today — no entitlement source
  // exists (ADR-019 amendment §3) — but the type and the branch must still be
  // exercised. `isEntitled` is the test seam for that.
  it("returns denied, without consulting the flag, when the injected entitlement check refuses", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel(ACTOR, async () => REFUSES_EVERYTHING);
    expect(selected.outcome).toBe("denied");
    expect(selected).toMatchObject({ reason: expect.any(String) });
    expect(aiLiveFlag).not.toHaveBeenCalled();
    expect(aiModel).not.toHaveBeenCalled();
    // `denied` means no model answers — including no classifier. A refused
    // actor whose turn still paid for a classification would be spending on
    // exactly the account that was told it may not.
    expect(aiClassifierModel).not.toHaveBeenCalled();
  });

  // Everyone-is-entitled is the default until an entitlement source exists —
  // no caller passes `isEntitled` today, so this is the path production runs.
  it("is entitled by default, with no isEntitled argument passed", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel(ACTOR);
    expect(selected.outcome).toBe("live");
  });

  // The entitlement check receives the actor, not just a boolean flag —
  // that's the whole point of widening the signature (ADR-019 amendment §3).
  it("passes the actor through to the entitlement check", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const isEntitled = vi.fn(async () => PERMITS_EVERYTHING);
    await selectAiModel(ACTOR, isEntitled);
    expect(isEntitled).toHaveBeenCalledWith(ACTOR);
  });
});

describe("deniedResponse", () => {
  it("returns the documented 403 contract", async () => {
    const res = deniedResponse("AI is not available for this account.");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "AI is not available for this account.",
      code: "ai-not-entitled",
    });
  });
});
