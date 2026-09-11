// Every tool the assistant has, in one array, plus the adapters that turn a
// definition into an AI SDK `Tool`.
//
// The registry is the point of ADR-043 decision 2: the three hand-written name
// manifests and `offeredToolNamesFor`'s switch existed only because there was
// nowhere to ask "which tools are there, and what is each one for?". There is
// now, and `toolsFor(grant)` (grants.ts) is the filter over it that replaced
// them. The tags stay recorded HERE and read THERE — building the filter in
// this file would be building it twice.
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
//     object with identity that only the turn can mint, and a library port is a
//     function only the app's edge can supply; neither is something a schema
//     can validate. They are closed over, and `needs` is still the whole of
//     what a tool may reach.
//
// P3 collapses this distinction — one `AssistantDeps` built by the admission
// pipeline — and the adapters below are the seam it will replace.
import { tool, type Tool } from "ai";
import {
  AMBIENT_DEP_KEYS,
  AssistantContextSchema,
  ambientDepsFrom,
  isTurnDepKey,
  type AssistantContext,
  type AssistantDeps,
  type TurnDeps,
} from "./deps";
import type { AnyAssistantTool } from "./defineTool";
import { NO_METER, type TurnMeter } from "./ledger";
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

/**
 * Whether a definition reads anything off the context channel, read from its
 * `needs`. It decides which of the two adapters builds the tool, and which
 * tools get an entry in `ambientContextFor`.
 */
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
export function contextTool(
  definition: AnyAssistantTool,
  turn: Partial<TurnDeps> = {},
  meter: TurnMeter = NO_METER,
) {
  const supplied = turnDepsFor(definition, turn);
  return tool({
    description: definition.description,
    inputSchema: definition.input,
    contextSchema: AssistantContextSchema,
    execute: async (input: unknown, { context }) =>
      measured(definition, meter, () =>
        definition.invoke(input, asDeps({ ...ambientDepsFrom(context), ...supplied })),
      ),
  });
}

/** One definition as an AI SDK tool with no context channel — it needs none. */
function plainTool(definition: AnyAssistantTool, turn: Partial<TurnDeps>, meter: TurnMeter): Tool {
  const supplied = turnDepsFor(definition, turn);
  return tool({
    description: definition.description,
    inputSchema: definition.input,
    execute: async (input: unknown) =>
      measured(definition, meter, () => definition.invoke(input, asDeps(supplied))),
  });
}

/**
 * The ledger's `toolCalls` half, measured at the one place a tool actually runs
 * (spec §7b — *"neither cost nor capacity: efficiency"*).
 *
 * It has to be here rather than in the recorder: `onStepEnd` sees a tool's NAME
 * and its input, because that is what the model emitted, and it cannot see how
 * long the call took or whether it threw. Both of those are the difference
 * between "the model asked for this tool" and "this tool earned its schema".
 *
 * **A failure is recorded and then re-thrown, unchanged.** The SDK turns a
 * throwing tool into a tool-error result the model can react to, and swallowing
 * one here to keep the ledger tidy would be telemetry changing behaviour — the
 * one thing every sink in this codebase is written not to do. `ok: false` is a
 * measurement of that failure, not a handling of it.
 */
async function measured<T>(
  definition: AnyAssistantTool,
  meter: TurnMeter,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    meter.toolCall(definition.name, Date.now() - startedAt, true);
    return result;
  } catch (err) {
    meter.toolCall(definition.name, Date.now() - startedAt, false);
    throw err;
  }
}

/**
 * A built tool set, with the CONTEXT parameter pinned.
 *
 * A bare `Record<string, Tool>` leaves it untyped, and `InferToolSetContext`
 * then resolves the whole set's context to nothing — which types
 * `ToolLoopAgent`'s `toolsContext` as `undefined` and turns the one channel
 * ADR-022 §3's guarantee rides on into a cast at the call site. Naming the
 * context here keeps it checked instead. A tool built by `plainTool` simply has
 * no entry in `ambientContextFor`'s result, which an index signature permits.
 */
// The SDK's own `ToolSet` is `Record<string, Tool<any, any, any>>`; the third
// parameter is the one this alias exists to pin, and the first two cannot be
// narrowed without making every concrete tool unassignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssistantToolSet = Record<string, Tool<any, any, AssistantContext | undefined>>;

/**
 * A set of definitions as the AI SDK tool object an agent is handed, keyed by
 * name and in the order given — so `Object.keys()` over the result is the
 * offered set, in registry order, and is a MEASUREMENT rather than a manifest.
 */
export function aiToolsFor(
  definitions: readonly AnyAssistantTool[],
  turn: Partial<TurnDeps> = {},
  // Optional, and defaulting to a meter that records nothing: a caller that is
  // not measuring a turn — every test that builds a tool set to inspect its
  // schemas — should not have to mint one.
  meter: TurnMeter = NO_METER,
): AssistantToolSet {
  const tools: AssistantToolSet = {};
  for (const definition of definitions) {
    tools[definition.name] = needsAmbient(definition)
      ? (contextTool(definition, turn, meter) as Tool)
      : plainTool(definition, turn, meter);
  }
  return tools;
}

/**
 * The context channel's payload, under the name of every definition that reads
 * it — `toolsContext` is keyed by tool.
 *
 * Only the definitions that declare an ambient key get an entry: a tool with no
 * `contextSchema` has nothing to validate one against. Which tools those are is
 * read off `needs` rather than listed, which is what `readToolsContext` and
 * `writeToolsContext` were two hand-written halves of.
 */
export function ambientContextFor(
  definitions: readonly AnyAssistantTool[],
  context: AssistantContext,
): Record<string, AssistantContext> {
  const byName: Record<string, AssistantContext> = {};
  for (const definition of definitions) {
    if (needsAmbient(definition)) byName[definition.name] = context;
  }
  return byName;
}
