// Every tool the assistant has, in one array, plus the adapters that turn a
// definition into an AI SDK `Tool`.
//
// The registry is the point of ADR-043 decision 2, which P2 builds: the three
// hand-written name manifests and `offeredToolNamesFor`'s switch exist only
// because there was nowhere to ask "which tools are there, and what is each
// one for?". There is now. **P1 records the tags and reads none of them** —
// `toolsFor(grant)` is P2's, and building it here would be building the filter
// twice.
//
// The adapters are here rather than beside each family because the mapping is
// one fact about the SDK, not four: where a definition's declared `needs` come
// from at call time.
//
//   * **Ambient keys ride the SDK's per-tool-call context channel.** `trip`,
//     `actor` and `scope` are the request's own facts, and `contextSchema` is
//     re-validated on every call (ai/dist: validateToolContext) — the same
//     channel `toolsContext` has always used, and the reason "read a different
//     trip" is not expressible (ADR-022 §3).
//   * **Turn keys are supplied when the tool set is built.** A collector is an
//     object with identity; only the turn can mint one, and there is nothing
//     for a schema to validate. It is closed over, and `needs` is still the
//     whole of what a tool may reach.
//
// P3 collapses this distinction — one `AssistantDeps` built by the admission
// pipeline — and the adapters below are the seam it will replace.
import { tool, type Tool } from "ai";
import {
  AMBIENT_DEP_KEYS,
  AssistantContextSchema,
  ambientDepsFrom,
  isTurnDepKey,
  type AssistantDeps,
  type TurnDeps,
} from "./deps";
import type { AnyAssistantTool } from "./defineTool";
import { READ_TOOLS } from "./tools/read";
import { PLANNING_TOOLS } from "./tools/planning";
import { insertPlaybookDayTool } from "./tools/insertPlaybookDay";
import { PAGE_TOOLS } from "./tools/page";

/**
 * Every definition this build has. Derived families are spread, so a
 * thirteenth `BatchableCommand` and a new macro each arrive here without an
 * edit to this file (ADR-015 invariant 5).
 */
export const ASSISTANT_TOOLS: readonly AnyAssistantTool[] = [
  ...READ_TOOLS,
  ...PLANNING_TOOLS,
  insertPlaybookDayTool,
  ...PAGE_TOOLS,
];

function needsAmbient(definition: AnyAssistantTool): boolean {
  return definition.needs.some((key) => (AMBIENT_DEP_KEYS as readonly string[]).includes(key));
}

/**
 * The turn half of a definition's `needs`, checked before a tool is built
 * rather than when the model first calls it.
 *
 * A missing collector is a wiring mistake — a builder that offered a write tool
 * without minting a buffer — and it must not surface as a tool call that
 * throws mid-turn, on the operator's key, several steps in. Failing at build
 * time makes it a test failure instead.
 */
function turnDepsFor(definition: AnyAssistantTool, turn: Partial<TurnDeps>): Partial<TurnDeps> {
  const supplied: Partial<TurnDeps> = {};
  for (const key of definition.needs) {
    if (!isTurnDepKey(key)) continue;
    const value = turn[key];
    if (value === undefined) {
      throw new Error(`${definition.name} declares needs: ["${key}"], but the turn supplied none.`);
    }
    // `as never` narrows the write to the one key being copied — the loop is
    // over a union of keys, which TypeScript cannot correlate with the union
    // of value types on its own.
    supplied[key] = value as never;
  }
  return supplied;
}

// The cast is what the runtime checks above earn. `AnyAssistantTool` has
// erased `needs` to `readonly DepKey[]`, so `invoke` asks for every key; what
// is actually passed is every key the definition DECLARED, which is all its
// `run` can reach. A tool still cannot read an undeclared dep — that is closed
// at the definition site by `run`'s parameter type, which is where the
// guarantee belongs and where the type test pins it.
function asDeps(partial: Partial<AssistantDeps>): AssistantDeps {
  return partial as AssistantDeps;
}

/**
 * One definition as an AI SDK tool, WITH the context channel attached.
 *
 * The return type is INFERRED, not annotated `Tool`: `Tool`'s context
 * parameter widens to `any` there, and `InferToolSetContext` then resolves the
 * whole tool set's context to `{}` — which makes `toolsContext` typed `never`
 * at the call site and silently deletes the one guarantee ADR-022 §3 is about.
 */
export function contextTool(definition: AnyAssistantTool, turn: Partial<TurnDeps> = {}) {
  const supplied = turnDepsFor(definition, turn);
  return tool({
    description: definition.description,
    inputSchema: definition.input,
    contextSchema: AssistantContextSchema,
    execute: async (input: unknown, { context }) =>
      definition.invoke(input, asDeps({ ...ambientDepsFrom(context), ...supplied })),
  });
}

/** One definition as an AI SDK tool with no context channel — it needs none. */
function plainTool(definition: AnyAssistantTool, turn: Partial<TurnDeps>): Tool {
  const supplied = turnDepsFor(definition, turn);
  return tool({
    description: definition.description,
    inputSchema: definition.input,
    execute: async (input: unknown) => definition.invoke(input, asDeps(supplied)),
  });
}

/**
 * A set of definitions as the AI SDK tool object an agent is handed, keyed by
 * name and in the order given — which is what `PAGE_TOOL_NAMES` and
 * `WRITE_TOOL_NAMES` measure.
 */
export function aiToolsFor(
  definitions: readonly AnyAssistantTool[],
  turn: Partial<TurnDeps> = {},
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const definition of definitions) {
    tools[definition.name] = needsAmbient(definition)
      ? (contextTool(definition, turn) as Tool)
      : plainTool(definition, turn);
  }
  return tools;
}
