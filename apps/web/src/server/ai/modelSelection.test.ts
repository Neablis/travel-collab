import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// `resolvedTierMap` is not destructured here: both cases that assert it need
// the isolated-import treatment (KI-2026-09-11-c), so every call site reads
// it off a freshly imported module instead of this one.
const { aiLive, aiLiveMode, selectAiModel, deniedResponse, AI_NOT_ENTITLED_REASON } = await import(
  "@/server/ai/modelSelection"
);
const { SIMULATED_MODEL_ID } = await import("@/server/ai/simulatedModel");
const { PERMITS_EVERYTHING, NO_CEILINGS, permitEverything } = await import(
  "@/server/assistant/entitlements"
);
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

// KI-24: AI_LIVE overriding the ai-live flag on Vercel is a deliberately kept
// escape hatch (see modelSelection.ts's module doc) — this only guards the
// EVIDENCE trail for it, not the override itself. The bug this closes: the
// warning used to live at module load, so it fired at most once per cold
// start and then said nothing for however long that container stayed warm,
// even while every request through it kept using the override. Moved into
// `aiLiveMode()`, it now fires on every resolution the override decides.
describe("Vercel AI_LIVE override warning (KI-24)", () => {
  it("warns on every resolution AI_LIVE decides on Vercel, not just the first", async () => {
    vi.stubEnv("VERCEL", "1");
    process.env.AI_LIVE = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await aiLiveMode();
      await aiLiveMode();
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/AI_LIVE is set in a Vercel environment/);
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  // The escape hatch is LOCAL/CI ONLY by design (see aiLiveMode()'s own doc
  // comment) — outside a Vercel environment, AI_LIVE deciding the outcome is
  // the expected, documented path and must not itself be noisy.
  it("does not warn when AI_LIVE is set outside a Vercel environment", async () => {
    process.env.AI_LIVE = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await aiLiveMode();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

const ACTOR = { surface: "ask" as const, userId: "user-1" };

describe("selectAiModel", () => {
  // Isolated rather than asserted against the module imported at the top of
  // this file: `serverConfig` is read at module load, so an ambient
  // AI_MODEL/AI_MODEL_* in the shell is already baked into that import by the
  // time a `vi.stubEnv` here would run. A fresh module graph, imported after
  // the stubs are in place, is the only way this assertion is actually about
  // the compiled default rather than about whatever happened to be exported
  // when this developer's shell set the tests up to run (KI-2026-09-11-c).
  it("returns a model for every tier, and its own classifier model, when the flag is on", async () => {
    aiLiveFlag.mockResolvedValue(true);
    vi.resetModules();
    vi.stubEnv("AI_MODEL", undefined);
    vi.stubEnv("AI_MODEL_CHEAP", undefined);
    vi.stubEnv("AI_MODEL_MID", undefined);
    vi.stubEnv("AI_MODEL_STRONG", undefined);
    try {
      const isolated = await import("@/server/ai/modelSelection");
      // The seam, because the default resolver now reads `users` and
      // `entitlement_grants` and this test is about which MODEL a live turn
      // gets, not about who may have one. Passing the top-level
      // `permitEverything` across the isolated module graph is fine — the port
      // is structural, so a second instance of the same shape satisfies it.
      const selected = await isolated.selectAiModel(ACTOR, permitEverything);
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
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
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
    // Cleared, not merely left alone: `mid` is the slot this case is ABOUT,
    // and an environment that happens to set it decides the assertion instead
    // of the code under test. Asserting a fall-through means owning the
    // variable it falls through from.
    vi.stubEnv("AI_MODEL_MID", undefined);
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
  // Isolated for the same reason as the case above: `resolvedTierMap()` reads
  // `serverConfig`, which is read at module load, so this has to resolve a
  // fresh module graph after the stubs rather than the one already imported
  // at the top of this file (KI-2026-09-11-c).
  it("reports the resolved tier map, ids and all, without consulting the flag", async () => {
    vi.resetModules();
    vi.stubEnv("AI_MODEL", undefined);
    vi.stubEnv("AI_MODEL_CHEAP", undefined);
    vi.stubEnv("AI_MODEL_MID", undefined);
    vi.stubEnv("AI_MODEL_STRONG", undefined);
    vi.stubEnv("AI_CLASSIFIER_MODEL", undefined);
    try {
      const isolated = await import("@/server/ai/modelSelection");
      expect(isolated.resolvedTierMap()).toEqual({
        cheap: "anthropic/claude-haiku-4-5",
        mid: "anthropic/claude-haiku-4-5",
        strong: "anthropic/claude-haiku-4-5",
        classifier: "anthropic/claude-haiku-4-5",
      });
      expect(aiLiveFlag).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("returns the simulated model when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    const selected = await selectAiModel(ACTOR, permitEverything);
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
    await selectAiModel(ACTOR, permitEverything);
    await selectAiModel({ surface: "ask", userId: "user-1" }, permitEverything);
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

  // **The default is no longer everyone-is-entitled** (M20 link 4). It reads
  // the account's plan and grants from the database, so what this asserts is
  // the thing that survived the change: an entitled actor reaches `live`, and
  // the injection seam is what a test without a database uses to say so.
  // `entitlementsFor`'s own behaviour is covered by `resolver.int.test.ts`
  // against a real one.
  it("reaches live for an entitled actor", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel(ACTOR, permitEverything);
    expect(selected.outcome).toBe("live");
  });

  // The default is wired to the real resolver rather than to a stub, and this
  // is the cheap proof: the parameter's default is a function this module did
  // not define. Without it, replacing the wiring with `permitEverything` during
  // a debugging session would leave every account entitled in production and no
  // test would notice.
  it("defaults to the account resolver rather than to a permissive stub", async () => {
    const source = readFileSync(
      fileURLToPath(new URL("./modelSelection.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/isEntitled: AiEntitlementCheck = resolveAiEntitlements/);
    expect(source).not.toMatch(/isEntitled: AiEntitlementCheck = permitEverything/);
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
  // **402 Payment Required since M20 link 4, and the change is the point.**
  // This read 403 and said so in its name, against a comment in the module that
  // gave the reason: *"403, not 402: 402 asserts a payment relationship that
  // does not exist yet."* M20 creates one. Recorded as a breaking wire change
  // in `docs/contracts/CHANGELOG.md`; the `code` is unchanged, which is what a
  // correctly written client branches on.
  it("returns the documented 402 contract", async () => {
    const res = deniedResponse(AI_NOT_ENTITLED_REASON);
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toEqual({
      error: AI_NOT_ENTITLED_REASON,
      code: "ai-not-entitled",
    });
  });

  // The refusal names the TIER rather than reading as a permission error. One
  // exported string, so the endpoint, the rail and this test cannot tell three
  // different stories about the same refusal — and no price, because M20 never
  // learns what a plan costs.
  it("names the tier and carries no price", () => {
    expect(AI_NOT_ENTITLED_REASON).toContain("Plus");
    expect(AI_NOT_ENTITLED_REASON).not.toMatch(/\$|\bUSD\b|per month|\d/i);
  });
});
