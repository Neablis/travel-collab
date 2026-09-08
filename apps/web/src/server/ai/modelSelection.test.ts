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
const aiModel = vi.fn(() => "gateway/fake-model");
const aiClassifierModel = vi.fn(() => "gateway/fake-classifier");
vi.mock("@/server/ai/gateway", () => ({
  aiModel: () => aiModel(),
  aiClassifierModel: () => aiClassifierModel(),
}));

const { aiLive, aiLiveMode, selectAiModel, deniedResponse } = await import(
  "@/server/ai/modelSelection"
);
const { SIMULATED_MODEL_ID } = await import("@/server/ai/simulatedModel");

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
  it("returns the gateway model, and its own classifier model, when the flag is on", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel(ACTOR);
    expect(selected).toEqual({
      outcome: "live",
      model: "gateway/fake-model",
      classifierModel: "gateway/fake-classifier",
    });
    expect(aiModel).toHaveBeenCalledOnce();
    expect(aiClassifierModel).toHaveBeenCalledOnce();
  });

  it("returns the simulated model when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    const selected = await selectAiModel(ACTOR);
    expect(selected.outcome).toBe("simulated");
    expect(selected).toMatchObject({
      model: { modelId: SIMULATED_MODEL_ID },
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
    const selected = await selectAiModel(ACTOR, () => false);
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
    const isEntitled = vi.fn(() => true);
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
