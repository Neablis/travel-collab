// Repairing a tool call the model got slightly wrong, instead of ending the turn.
//
// **Why this exists, with the two turns that caused it.** On 2026-09-12, the
// first two live turns after the tier map was set both died with
// `AI_InvalidToolInputError`, and the user got nothing:
//
//   * `search_playbooks` with EIGHT cities against a schema maximum of five
//     ("Name at most 5 cities per call.")
//   * `read_day` with `{"days":"[3]"}` — the array JSON-encoded as a string,
//     where the schema wants `number[]`
//
// Neither is a model that cannot do the job. Both are a model that got an
// argument slightly wrong and was never told: the AI SDK throws and
// `ToolLoopAgent` aborts the whole run. **One malformed argument should not be
// the end of a turn**, and which models make which slips is not something the
// kernel should be tuned around — that is the same "model identity is an
// input" rule the tier map follows.
//
// **The rule this file keeps: a repair may not change what was asked for.**
// Repair is allowed to fix how an argument was SPELLED. It is not allowed to
// decide what the argument should have been. Each case below says which side of
// that line it sits on, because the temptation to add a clever coercion here
// will come back, and a repair that quietly means something else is worse than
// the error it replaced — this codebase has already paid for confidently wrong
// data once (KI-39, six real venues pinned in the wrong places).
import { z } from "zod";
import { ASSISTANT_TOOLS } from "./registry";

/** The tool's own input schema, by name. Null for a name the registry does not have. */
function schemaFor(toolName: string): z.ZodTypeAny | null {
  return ASSISTANT_TOOLS.find((tool) => tool.name === toolName)?.input ?? null;
}

/**
 * A string that is really a JSON array or object, unwrapped.
 *
 * **Lossless, and that is why it is allowed.** `"[3]"` and `[3]` are the same
 * request written two ways; picking the second changes no intent. Guarded on
 * the first character so an ordinary string that happens to be parseable JSON
 * — a title of `"null"`, a note of `"123"` — is left alone: those are values,
 * not encodings.
 */
function unwrapJsonStrings(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  let changed = false;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    try {
      out[key] = JSON.parse(trimmed) as unknown;
      changed = true;
    } catch {
      // Not JSON after all. The string stays exactly as the model wrote it.
    }
  }
  return changed ? out : input;
}

/**
 * An over-long array cut to the schema's own maximum.
 *
 * **This one is NOT lossless, and it is still the right call.** Truncating
 * eight cities to five drops three the model asked about. The alternative is
 * the turn dying with nothing, and the loss is *visible to the model*: the tool
 * result comes back naming the five it searched, so the next step can ask for
 * the rest. A silent truncation the model could not observe would not be
 * acceptable, and this is not that.
 *
 * Only `too_big` on an array is clamped. A `too_small`, a wrong enum member or
 * a missing required field is the model meaning something we cannot recover,
 * and those still fail the turn.
 */
function clampOversizedArrays(input: unknown, error: z.ZodError): unknown {
  if (typeof input !== "object" || input === null) return input;
  let changed = false;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const issue of error.issues) {
    if (issue.code !== "too_big" || issue.type !== "array") continue;
    const [key] = issue.path;
    if (typeof key !== "string") continue;
    const value = out[key];
    if (!Array.isArray(value) || typeof issue.maximum !== "number") continue;
    out[key] = value.slice(0, issue.maximum);
    changed = true;
  }
  return changed ? out : input;
}

/**
 * The repaired input for one tool call, or null when nothing honest can be done.
 *
 * Null means "let it fail": the caller rethrows and the turn ends as it did
 * before this file existed. That is the correct outcome for a model that asked
 * for something the tool does not offer, and keeping it is what stops this
 * from becoming a place where invalid calls are made to look valid.
 */
export function repairToolInput(toolName: string, rawInput: unknown): unknown | null {
  const schema = schemaFor(toolName);
  if (schema === null) return null;
  // Already valid: nothing to repair, and saying so is not the same as fixing
  // it. The SDK only calls us on a failure, so this is a guard, not a path.
  if (schema.safeParse(rawInput).success) return null;

  const unwrapped = unwrapJsonStrings(rawInput);
  const afterUnwrap = schema.safeParse(unwrapped);
  if (afterUnwrap.success) return unwrapped;

  const clamped = clampOversizedArrays(unwrapped, afterUnwrap.error);
  return schema.safeParse(clamped).success ? clamped : null;
}
