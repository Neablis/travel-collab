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
// `domain`, `effect`, `spend` and `minimumRole` are RECORDED here and read by
// nothing yet. P2 builds the (domain, effect) filter that replaces
// `offeredToolNamesFor`; P5 reads `spend`. Recording them first is what makes
// those phases a filter over data rather than a second manifest.
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
   * `run`, with the result put through `output`. This is what an adapter calls;
   * `run` itself is kept on the definition so a unit test can exercise the body
   * without the parse, and so a reader can see the two are the same function.
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
    invoke: async (input, deps) => spec.output.parse(await spec.run(input, deps)) as z.infer<Output>,
  };
}
