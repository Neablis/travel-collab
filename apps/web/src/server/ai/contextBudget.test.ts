// **The context budget: what every step of a turn pays before the model has
// read anything, held in a committed baseline so growth is a reviewed diff.**
//
// A turn re-sends its system instruction and every offered tool's schema on
// every step. That fixed cost was cut hard in August (askIntent.ts records
// 4,911 → 1,332 input tokens for a question turn) and then grew back unseen:
// the first live production turns on 2026-10-03 paid ~8,700 input tokens per
// step on an `edit` turn, and AddActivity plus UpdateActivity alone were over
// half of it. Nothing measured it, so nothing complained.
//
// This test measures it the way the SDK sends it, not the way a reader would
// estimate it: each tool goes through `aiToolsFor` (the registry's real
// adapter) and is serialized as `ai`'s `prepareToolsAndToolChoice` does —
// `{ type, name, inputSchema: await asSchema(tool.inputSchema).jsonSchema,
// description }` — and the instruction comes from `instructionsFor` itself.
// The tool sets are `toolsFor` over the same caps `admission.ts`'s
// `grantTools` resolves for each turn shape.
//
// **Any change fails until the baseline is regenerated**, in either direction:
//
//   UPDATE_CONTEXT_BUDGET=1 pnpm --filter web exec vitest run \
//     --config vitest.unit.config.ts src/server/ai/contextBudget.test.ts
//
// Growth is allowed — a new tool may well earn its tokens — but it lands as a
// visible change to `contextBudget.baseline.json` that review has to accept.
// A saving fails too, so it is locked in rather than quietly given back by the
// next change. The unit is serialized characters, which are exact and
// deterministic; tokens are shown beside them for reading, converted at the
// ratio measured against production (below), and are approximate.
import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { readFileSync, writeFileSync } from "node:fs";
import { instructionsFor } from "@/server/ai/handleAskRequest";
import type { TaskClass } from "@/server/assistant/taskClass";
import { TURN_DEP_KEYS, type TurnDeps } from "@/server/assistant/deps";
import { grantFor, postureFor, toolsFor, type EffectCaps } from "@/server/assistant/grants";
import { ASSISTANT_TOOLS, aiToolsFor } from "@/server/assistant/registry";
import { SWITCH_INTENT_TOOL_NAME } from "@/server/assistant/tools/intent";

const BASELINE = new URL("./contextBudget.baseline.json", import.meta.url);

/**
 * Characters of serialized request per input token, measured 2026-10-03: the
 * `trip · edit` shape below, as it stood that day, against the 8,738 input
 * tokens production's `zai/glm-5.3-flash` reported for that turn's first step
 * (a one-sentence opening question). Another tokenizer will differ; re-measure
 * against a real `usageByStep[0]` rather than trusting this blind.
 */
const CHARS_PER_TOKEN = 3.31;

/** A turn shape: the caps admission resolves, and the class it narrows by. */
interface Shape {
  caps: EffectCaps;
  /** `undefined` = not narrowed (a viewer, or a class resolved upward). */
  narrowBy: TaskClass | undefined;
  /** Board shapes are measured with their instruction; a page's needs a page. */
  board: boolean;
}

const editor = { role: "propose", plan: "propose" } as const;

const SHAPES: Record<string, Shape> = {
  "trip · viewer": { caps: { surface: "trip", role: "read", plan: "propose", classifier: "read" }, narrowBy: undefined, board: true },
  "trip · question": { caps: { surface: "trip", ...editor, classifier: "read" }, narrowBy: "question", board: true },
  "trip · edit": { caps: { surface: "trip", ...editor, classifier: "propose" }, narrowBy: "edit", board: true },
  "trip · plan": { caps: { surface: "trip", ...editor, classifier: "propose" }, narrowBy: "plan", board: true },
  "trip · unsure": { caps: { surface: "trip", ...editor, classifier: "propose" }, narrowBy: undefined, board: true },
  "page · compose": { caps: { surface: "page", ...editor, classifier: "propose" }, narrowBy: "compose", board: false },
  "page · question": { caps: { surface: "page", ...editor, classifier: "propose" }, narrowBy: "question", board: false },
};

// Schemas are all this test reads, so every turn dependency is an empty stub:
// `aiToolsFor` checks a declared dep was supplied, and nothing here executes.
const STUB_TURN = Object.fromEntries(TURN_DEP_KEYS.map((key) => [key, {}])) as unknown as TurnDeps;

/** One tool exactly as the SDK hands it to the provider, serialized. */
async function wireCharsOf(names: readonly string[]): Promise<Record<string, number>> {
  const definitions = names.map((name) => ASSISTANT_TOOLS.find((tool) => tool.name === name)!);
  const tools = aiToolsFor(definitions, STUB_TURN);
  const out: Record<string, number> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const wire = {
      type: "function",
      name,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
      ...(tool.description != null ? { description: tool.description } : {}),
    };
    out[name] = JSON.stringify(wire).length;
  }
  return out;
}

const approxTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

async function measure() {
  const toolChars = await wireCharsOf(ASSISTANT_TOOLS.map((tool) => tool.name));
  const shapes: Record<string, { tools: string[]; toolChars: number; instructionChars: number | null; totalChars: number; approxTokens: number }> = {};
  for (const [label, shape] of Object.entries(SHAPES)) {
    const grants = grantFor(shape.caps);
    const posture = postureFor(shape.caps);
    const offerable = toolsFor(grants, undefined, posture);
    const tools = toolsFor(grants, shape.narrowBy, posture)
      // admission drops the pivot when a page has nowhere to pivot to; every
      // page here can pivot (compose ↔ question), so it is kept.
      .filter((tool) => !shape.board || tool.name !== SWITCH_INTENT_TOOL_NAME)
      .map((tool) => tool.name);
    const toolsTotal = tools.reduce((sum, name) => sum + toolChars[name]!, 0);
    const instructionChars = shape.board
      ? instructionsFor({ kind: "trip" }, 10, posture, null, tools.length < offerable.length).length
      : null;
    const totalChars = toolsTotal + (instructionChars ?? 0);
    shapes[label] = { tools, toolChars: toolsTotal, instructionChars, totalChars, approxTokens: approxTokens(totalChars) };
  }
  const perTool = Object.fromEntries(
    Object.entries(toolChars)
      .sort(([, a], [, b]) => b - a)
      .map(([name, chars]) => [name, { chars, approxTokens: approxTokens(chars) }]),
  );
  return { charsPerToken: CHARS_PER_TOKEN, shapes, tools: perTool };
}

type Budget = Awaited<ReturnType<typeof measure>>;

/** Every number that moved, as a line a reviewer can read without the JSON. */
function changesBetween(baseline: Budget, current: Budget): string[] {
  const lines: string[] = [];
  const delta = (what: string, before: number | undefined, after: number | undefined) => {
    if (before === after) return;
    if (before === undefined) return lines.push(`${what}: new, ${after} chars (~${approxTokens(after!)} tokens)`);
    if (after === undefined) return lines.push(`${what}: gone (was ${before} chars)`);
    const d = after - before;
    lines.push(`${what}: ${before} → ${after} chars (${d > 0 ? "+" : ""}${d}, ~${d > 0 ? "+" : ""}${approxTokens(d)} tokens)`);
  };
  for (const label of new Set([...Object.keys(baseline.shapes), ...Object.keys(current.shapes)])) {
    const before = baseline.shapes[label];
    const after = current.shapes[label];
    delta(`shape "${label}"`, before?.totalChars, after?.totalChars);
    if (before && after && before.tools.join() !== after.tools.join()) {
      lines.push(`shape "${label}" tools: [${before.tools.join(", ")}] → [${after.tools.join(", ")}]`);
    }
  }
  for (const name of new Set([...Object.keys(baseline.tools), ...Object.keys(current.tools)])) {
    delta(`tool ${name}`, baseline.tools[name]?.chars, current.tools[name]?.chars);
  }
  return lines;
}

describe("the context budget", () => {
  it("matches the committed baseline, so any growth or saving is a reviewed diff", async () => {
    const current = await measure();
    if (process.env.UPDATE_CONTEXT_BUDGET === "1") {
      writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Budget;
    expect(
      changesBetween(baseline, current),
      "The context a turn pays on every step moved. If that is intended, regenerate " +
        "contextBudget.baseline.json (UPDATE_CONTEXT_BUDGET=1, see this file's header) and " +
        "let review see the numbers; if it is not, find what grew.",
    ).toEqual([]);
  });
});
