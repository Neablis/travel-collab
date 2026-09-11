// The tool envelope (ADR-043 decision 1) — the shape ADR-037 gave widgets,
// applied to tools.
//
// `defineTool` is the ENVELOPE; derivation stays the BODY. ADR-015 invariant 5
// is not weakened by it: the planning tools are still emitted by a generator
// over `@tc/contracts` command schemas and the page tools by one over the
// `@tc/pages` macro registry, each producing one `defineTool` call per registry
// member. A thirteenth command still yields a thirteenth tool with no hand
// edit. What the envelope adds is the four fields a hand-written manifest could
// never carry, and one runtime guarantee.
//
// The runtime guarantee is `output`. It is a REQUIRED zod schema and `invoke`
// parses through it before a result reaches the model, so a tool cannot return
// a shape nothing parsed (KI-9, at the tool boundary). A tool whose `run`
// drifts from its declared readout fails at its own edge, in this build's own
// tests, rather than as a confidently-shaped wrong answer three layers away.
//
// The compile-time guarantee is `needs`. `run`'s second parameter is
// `Pick<AssistantDeps, Needs[number]>` — a tool that did not declare the
// geocoder cannot reach the geocoder, and that is a type error rather than a
// convention. `defineTool.test.ts` pins it with a `@ts-expect-error` case,
// because a compile-time guarantee no test can see is one a refactor can
// delete silently.
//
// The third guarantee is `taint`. A tool that returns content a PERSON wrote
// declares how to fence it, and `invoke` applies that on the way out — so
// "the model never sees an unfenced activity title" is a property of the tool
// boundary rather than of whoever last edited the readout. See `prompt.ts` for
// why this product needs it at all (the trip is shared; the asker did not write
// most of what the tools return).
//
// `domain`, `effect` and `minimumRole` are RECORDED here and READ by
// `grants.ts` — the (domain, effect) filter that replaced `offeredToolNamesFor`
// and the three name manifests (F-F02). `spend` is still recorded and read by
// nothing; P5 is where it becomes the ledger's filter. Recording a tag before
// there is a reader is what makes each of those phases a filter over data
// rather than a second manifest.
import type { z } from "zod";
import type { TripRole } from "@tc/contracts";
import type { AssistantDeps, DepKey } from "./deps";

/**
 * What a tool is ABOUT. Six values, fixed by ADR-043 decision 2.
 *
 * A set membership rather than a predicate per tool, deliberately: the
 * requirement is auditability, and a set is readable at a glance where a
 * predicate is not.
 */
export type ToolDomain = "itinerary" | "library" | "pages" | "places" | "account" | "system";

/**
 * What a tool DOES — and there is no `commit`. The turn changes nothing; that
 * stays a property of the shape rather than a rule the prompt has to hold.
 * A `propose` tool collects and the loop ends; the only thing that commits is
 * the apply endpoint, reached by a human clicking Approve.
 */
export type ToolEffect = "read" | "propose";

/**
 * Whether calling this tool can spend money at a vendor.
 *
 * KI-93 exists because a second path to `LOCATIONIQ_API_KEY` was invisible.
 * Once every tool declares this, the set of spending paths is a filter over the
 * registry rather than something a reviewer has to notice.
 */
export type ToolSpend = "none" | "vendor";

export interface ToolSpec<
  Input extends z.ZodTypeAny,
  Output extends z.ZodTypeAny,
  Needs extends readonly DepKey[],
> {
  /** The name the model calls, and the registry's key. */
  name: string;
  description: string;
  domain: ToolDomain;
  effect: ToolEffect;
  spend: ToolSpend;
  input: Input;
  /** Required — see the file header. There is no un-parsed tool result. */
  output: Output;
  /** Typed keys into `AssistantDeps`, and the whole of what `run` may reach. */
  needs: Needs;
  minimumRole: TripRole;
  /**
   * Fence the user-authored fields of a result before the model sees it
   * (`untrusted`, prompt.ts). Omitted by a tool whose result is entirely
   * server-authored — `find_free_time` returns day numbers and clock times, and
   * fencing those would be noise that teaches a reader the mark means nothing.
   *
   * Optional rather than required-and-usually-identity because the twelve
   * planning tools all return a bare `{ queued: true }`, and twelve identity
   * functions would be a manifest with the same failure mode as the ones
   * ADR-043 deleted.
   *
   * **The thirteenth write tool is the exception, and it is the one that proves
   * why the measurement matters more than the count** (PR #162 review, Major).
   * `insert_playbook_day` returns the saved day's `name` — author-written, and
   * the author is a stranger to the asker — and it shipped unfenced, because
   * the taint measurement was scoped by its own FILE NAME to the read tools.
   * A write tool that returns user text is not a special case; it is the case
   * the name hid. What keeps this honest is a measurement:
   * `toolResults.taint.test.ts` feeds every tool that returns user-authored
   * text a trip whose every such string is a marker, and asserts
   * no marker reaches the model unfenced — so a new tool that forgets this
   * fails without anybody remembering to add it to a list.
   */
  taint?: (result: z.infer<Output>) => z.infer<Output>;
  run: (
    input: z.infer<Input>,
    deps: Pick<AssistantDeps, Needs[number]>,
  ) => z.infer<Output> | Promise<z.infer<Output>>;
}

export interface AssistantTool<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Output extends z.ZodTypeAny = z.ZodTypeAny,
  Needs extends readonly DepKey[] = readonly DepKey[],
> extends ToolSpec<Input, Output, Needs> {
  /**
   * `run`, with the result put through `output` and then through `taint`. This
   * is what an adapter calls; `run` itself is kept on the definition so a unit
   * test can exercise the body without either step, and so a reader can see
   * they are the same function.
   *
   * Parse BEFORE fence: `output` is the tool's own contract with itself (KI-9),
   * and validating an already-fenced value would check the fence rather than
   * the readout.
   */
  invoke(input: z.infer<Input>, deps: Pick<AssistantDeps, Needs[number]>): Promise<z.infer<Output>>;
}

/** A definition with its type parameters erased, for the registry's array. */
export type AnyAssistantTool = AssistantTool<z.ZodTypeAny, z.ZodTypeAny, readonly DepKey[]>;

/**
 * `const Needs` so `needs: ["trip"]` infers the readonly TUPLE rather than
 * widening to `DepKey[]` — which would resolve `Needs[number]` to every key and
 * silently hand every tool everything, deleting the guarantee this file is for.
 * `as const` at the call site says the same thing and both are accepted; the
 * modifier is what makes forgetting it harmless.
 */
export function defineTool<
  Input extends z.ZodTypeAny,
  Output extends z.ZodTypeAny,
  const Needs extends readonly DepKey[],
>(spec: ToolSpec<Input, Output, Needs>): AssistantTool<Input, Output, Needs> {
  return {
    ...spec,
    invoke: async (input, deps) => {
      const parsed = spec.output.parse(await spec.run(input, deps)) as z.infer<Output>;
      return spec.taint ? spec.taint(parsed) : parsed;
    },
  };
}
