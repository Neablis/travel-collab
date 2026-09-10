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
import { MACRO_NAMES } from "@tc/pages";
import { ASSISTANT_TOOLS, aiToolsFor } from "./registry";
import { newPageBuffer, newProposalBuffer } from "./deps";
import { PLANNING_TOOLS } from "./tools/planning";
import { PAGE_TOOLS } from "./tools/page";
import { READ_TOOLS } from "./tools/read";
import { insertPlaybookDayTool } from "./tools/insertPlaybookDay";

const DEP_KEYS = ["trip", "actor", "scope", "proposalBuffer", "pageBuffer", "playbooks", "savedDays"];

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
        ...PLANNING_TOOLS.map((t) => t.name),
        insertPlaybookDayTool.name,
        ...PAGE_TOOLS.map((t) => t.name),
      ].sort(),
    );
  });

  // MEASURED against the contract, not listed: this is what makes a thirteenth
  // command a thirteenth tool for free, and it is the assertion that fails if
  // someone ever replaces the generator with a hand-written manifest.
  it("derives one planning tool per BatchableCommand member", () => {
    expect(PLANNING_TOOLS.map((t) => t.name).sort()).toEqual(
      BatchableCommand.options.map((o) => o.shape.type.value as string).sort(),
    );
  });

  // The page half of the same rule (@tc/pages macro registry). The tools are
  // two, but the vocabulary they can insert is the registry's, so the check is
  // that `insert_widget` still enumerates it rather than a copy of it.
  it("derives insert_widget's widget names from the live macro registry", () => {
    expect([...(insertWidgetNameOptions() ?? [])].sort()).toEqual([...MACRO_NAMES].sort());
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
  });

  // Identity arrives on the context channel and nowhere else (ADR-022 §3), so
  // a tool that declares an ambient dep must carry a `contextSchema` — and one
  // that declares none must not, or the turn would have to supply a context
  // for a tool that reads nothing from it.
  it("attaches the context channel to exactly the tools that need it", () => {
    const built = aiToolsFor(ASSISTANT_TOOLS, {
      proposalBuffer: newProposalBuffer(),
      pageBuffer: newPageBuffer(),
      playbooks: { discover: async () => [] },
      savedDays: { readable: async () => null },
    });
    for (const definition of ASSISTANT_TOOLS) {
      const wantsContext = definition.needs.some((key) => key === "trip" || key === "actor" || key === "scope");
      const attached = (built[definition.name] as { contextSchema?: unknown }).contextSchema !== undefined;
      expect(attached, `${definition.name} contextSchema`).toBe(wantsContext);
    }
  });
});
