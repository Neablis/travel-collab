// The registry, and the two things it has to keep true in P1.
//
// **Derivation is unchanged.** ADR-015 invariant 5 says tool schemas are
// derived, never hand-written twice, and `defineTool` is the envelope rather
// than an escape from it. The two assertions that matter are measured against
// the registries themselves — a thirteenth `BatchableCommand` and a new macro
// each have to arrive here with no edit to any file.
//
// **`needs` is legible and closed.** Every definition's declared dependencies
// are keys of `AssistantDeps` and nothing else, so "what can this tool touch?"
// is answerable by reading the registry rather than by tracing which builder
// constructed it.
//
// The tags themselves — `domain`, `effect`, `spend` — are RECORDED in P1 and
// read by nothing. What is asserted here is that every tool carries them, so
// P2's filter is a filter over complete data rather than one with holes.
import { describe, expect, it } from "vitest";
import { BatchableCommand } from "@tc/contracts";
import { COMPOSABLE_MACRO_NAMES, MACRO_NAMES } from "@tc/pages";
import { ASSISTANT_TOOLS, aiToolsFor } from "./registry";
import { newTurnMeter } from "./ledger";
import { defineTool } from "./defineTool";
import { z } from "zod";
import {
  AMBIENT_DEP_KEYS,
  TURN_DEP_KEYS,
  newEscalationBuffer,
  newNotebookRefs,
  newPageBuffer,
  newPlaceCache,
  newProposalBuffer,
} from "./deps";
import { PLANNING_TOOLS } from "./tools/planning";
import { PAGE_TOOLS } from "./tools/page";
import { WIDGET_TOOLS } from "./tools/widgets";
import { typedAddressesIn } from "./typedAddresses";
import { PLACE_TOOLS } from "./tools/places";
import { ESCALATION_TOOLS } from "./tools/escalate";
import { READ_TOOLS } from "./tools/read";
import { insertPlaybookDayTool } from "./tools/insertPlaybookDay";

// **Derived from the two runtime lists, not written out.** This was a
// hand-typed array of seven strings, which is the manifest shape ADR-043
// decision 2 deleted everywhere else — and it behaved like one: M9's grounding
// added two keys to `AssistantDeps` and the assertion below failed for the
// definition that used them rather than for the list that was stale.
// `AMBIENT_DEP_KEYS` and `TURN_DEP_KEYS` together ARE `DepKey`, and
// `TURN_DEP_KEY_SET`'s `Record<TurnDepKey, true>` is what makes the second half
// exhaustive at compile time.
const DEP_KEYS: readonly string[] = [...AMBIENT_DEP_KEYS, ...TURN_DEP_KEYS];

/** Everything a turn supplies, for the adapter tests that build the whole registry. */
const TURN_DEPS = {
  proposalBuffer: newProposalBuffer(),
  pageBuffer: newPageBuffer(),
  playbooks: { discover: async () => [] },
  savedDays: { readable: async () => null },
  placeSearch: { search: async () => [] },
  placeCache: newPlaceCache(),
  escalation: newEscalationBuffer(),
  notebooks: newNotebookRefs(async () => [], null),
  typedAddresses: typedAddressesIn(""),
};

/** The widget names `insert_widget`'s schema will accept, read off the schema. */
function insertWidgetNameOptions(): readonly string[] | undefined {
  const widget = PAGE_TOOLS.find((t) => t.name === "insert_widget");
  if (!widget) throw new Error("insert_widget is missing from PAGE_TOOLS");
  const shape = (widget.input as unknown as { shape: { name: { options?: readonly string[] } } }).shape;
  return shape.name.options;
}

describe("the registry", () => {
  it("holds every tool once, under the name the model calls", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        ...READ_TOOLS.map((t) => t.name),
        ...PLACE_TOOLS.map((t) => t.name),
        ...PLANNING_TOOLS.map((t) => t.name),
        insertPlaybookDayTool.name,
        ...WIDGET_TOOLS.map((t) => t.name),
        ...PAGE_TOOLS.map((t) => t.name),
        ...ESCALATION_TOOLS.map((t) => t.name),
      ].sort(),
    );
  });

  // MEASURED against the contract, not listed: this is what makes a thirteenth
  // command a thirteenth tool for free, and it is the assertion that fails if
  // someone ever replaces the generator with a hand-written manifest.
  it("derives one planning tool per BatchableCommand member", () => {
    expect(PLANNING_TOOLS.map((t) => t.name).sort()).toEqual(
      BatchableCommand.innerType().options.map((o) => o.shape.type.value as string).sort(),
    );
  });

  // The page half of the same rule (@tc/pages macro registry). The tools are
  // two, but the vocabulary they can insert is the registry's, so the check is
  // that `insert_widget` still enumerates it rather than a copy of it.
  it("derives insert_widget's widget names from the live macro registry, less what it may not compose", () => {
    // `COMPOSABLE_MACRO_NAMES` is the registry filtered by `composable`, not a
    // copy. The two link widgets were the whole difference (ADR-056) until
    // ADR-057 guarded them in `insert_widget` instead, so today it is none —
    // every widget a person can insert, the assistant can too.
    expect([...(insertWidgetNameOptions() ?? [])].sort()).toEqual([...COMPOSABLE_MACRO_NAMES].sort());
    expect(MACRO_NAMES.filter((name) => !COMPOSABLE_MACRO_NAMES.includes(name))).toEqual([]);
  });

  it("declares only real AssistantDeps keys, on every tool", () => {
    for (const tool of ASSISTANT_TOOLS) {
      for (const key of tool.needs) {
        expect(DEP_KEYS, `${tool.name} needs`).toContain(key);
      }
    }
  });

  it("tags every tool for the grant filter, with no holes", () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(["itinerary", "library", "pages", "places", "account", "system"], tool.name).toContain(tool.domain);
      expect(["read", "propose"], tool.name).toContain(tool.effect);
      expect(["none", "vendor"], tool.name).toContain(tool.spend);
      expect(["viewer", "editor", "owner"], tool.name).toContain(tool.minimumRole);
    }
  });
});

describe("the AI SDK adapter", () => {
  // A builder that offers a write tool without minting a buffer is a wiring
  // mistake, and it must not surface as a tool call that throws mid-turn on
  // the operator's key several steps in. Failing when the set is BUILT makes it
  // a test failure instead.
  it("refuses to build a tool whose declared collector the turn did not supply", () => {
    expect(() => aiToolsFor(PLANNING_TOOLS, {})).toThrow(/proposalBuffer/);
    expect(() => aiToolsFor(PAGE_TOOLS, {})).toThrow(/pageBuffer/);
    // The same rule over M9's grounding pair: `search_places` cannot be built
    // without the port it spends through OR the cache that numbers what it
    // found, and a turn that minted one and forgot the other is the wiring
    // mistake this check is for.
    expect(() => aiToolsFor(PLACE_TOOLS, {})).toThrow(/placeSearch/);
    expect(() => aiToolsFor(PLACE_TOOLS, { placeSearch: { search: async () => [] } })).toThrow(/placeCache/);
  });

  // Identity arrives on the context channel and nowhere else (ADR-022 §3), so
  // a tool that declares an ambient dep must carry a `contextSchema` — and one
  // that declares none must not, or the turn would have to supply a context
  // for a tool that reads nothing from it.
  it("attaches the context channel to exactly the tools that need it", () => {
    const built = aiToolsFor(ASSISTANT_TOOLS, TURN_DEPS);
    for (const definition of ASSISTANT_TOOLS) {
      const wantsContext = definition.needs.some((key) => key === "trip" || key === "actor" || key === "scope");
      const attached = (built[definition.name] as { contextSchema?: unknown }).contextSchema !== undefined;
      expect(attached, `${definition.name} contextSchema`).toBe(wantsContext);
    }
  });

  // **The ledger's efficiency half is measured where the tool actually runs.**
  // `onStepEnd` sees a tool's NAME and its input, because that is what the
  // model emitted; it cannot see how long the call took or whether it threw,
  // and those are the whole difference between "the model asked for this tool"
  // and "this tool earned its schema".
  describe("the turn meter", () => {
    const okTool = defineTool({
      name: "meter_ok",
      domain: "system",
      effect: "read",
      spend: "none",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      needs: [] as const,
      minimumRole: "viewer",
      description: "A tool that returns.",
      run: async () => ({ ok: true }),
    });

    const throwingTool = defineTool({
      name: "meter_throws",
      domain: "system",
      effect: "read",
      spend: "none",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      needs: [] as const,
      minimumRole: "viewer",
      description: "A tool that throws.",
      run: async () => {
        throw new Error("tool exploded");
      },
    });

    async function execute(tool: unknown): Promise<unknown> {
      return (tool as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute({}, {});
    }

    it("records a successful call with its name and outcome", async () => {
      const meter = newTurnMeter();
      const built = aiToolsFor([okTool], {}, meter);
      await execute(built.meter_ok);

      expect(meter.toolCalls()).toHaveLength(1);
      expect(meter.toolCalls()[0]).toMatchObject({ name: "meter_ok", ok: true });
      expect(meter.toolCalls()[0]!.ms).toBeGreaterThanOrEqual(0);
    });

    // **Recorded, then re-thrown unchanged.** The SDK turns a throwing tool
    // into a tool-error result the model can react to; swallowing one here to
    // keep the ledger tidy would be telemetry changing behaviour, which is the
    // one thing every sink in this codebase is written not to do.
    it("records a failed call as ok: false and re-throws it", async () => {
      const meter = newTurnMeter();
      const built = aiToolsFor([throwingTool], {}, meter);

      await expect(execute(built.meter_throws)).rejects.toThrow("tool exploded");
      expect(meter.toolCalls()).toEqual([{ name: "meter_throws", ms: expect.any(Number), ok: false }]);
    });

    // A caller that is not measuring a turn — every test that builds a tool set
    // to inspect its schemas — must not have to mint a meter.
    it("runs unmeasured when no meter is supplied", async () => {
      const built = aiToolsFor([okTool], {});
      await expect(execute(built.meter_ok)).resolves.toBeDefined();
    });
  });
});
