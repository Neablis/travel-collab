import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked so the real module — and therefore `flags/next`, which reaches for
// next/headers and a request scope — never loads in a unit test.
const aiLiveFlag = vi.fn<() => Promise<boolean>>();
vi.mock("@/server/flags", () => ({ aiLiveFlag: () => aiLiveFlag() }));

// aiModel() throws without AI_GATEWAY_API_KEY; stub it so the live branch is
// testable without a key, and so a stray call is visible.
const aiModel = vi.fn(() => "gateway/fake-model");
vi.mock("@/server/ai/gateway", () => ({ aiModel: () => aiModel() }));

const { aiLive, selectAiModel } = await import("@/server/ai/modelSelection");
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
  // an unhandled rejection out of handleAiRequest.
  it("resolves to false, not rejects, when the flag throws", async () => {
    aiLiveFlag.mockRejectedValue(new Error("readOverrides: invalid FLAGS_SECRET"));
    await expect(aiLive()).resolves.toBe(false);
  });
});

describe("selectAiModel", () => {
  it("returns the gateway model when the flag is on", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel("board");
    expect(selected).toEqual({ model: "gateway/fake-model", simulated: false });
    expect(aiModel).toHaveBeenCalledOnce();
  });

  it("returns the simulated model when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    const selected = await selectAiModel("board");
    expect(selected.simulated).toBe(true);
    expect(selected.model).toMatchObject({ modelId: SIMULATED_MODEL_ID });
  });

  // The whole point of the kill switch: the flag-off path must not construct a
  // gateway client, which is what would carry the API key and the spend.
  it("never constructs a gateway client when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    await selectAiModel("board");
    await selectAiModel("page");
    expect(aiModel).not.toHaveBeenCalled();
  });
});
