import type { MacroNode } from "@tc/contracts";
import { FilterDimension } from "@tc/contracts";
import type { AnyMacroDef } from "./registry-types";
import { getMacro } from "./registry";

// ADR-037 decision 4: **insert is one derived command, not a UI action per
// widget.**
//
// > That is the invariant worth stating: there is no way to put a widget into a
// > document that skips validation. A second insert path is how a document
// > acquires a node no resolver can read — and with five entry points that is no
// > longer a hypothetical.
//
// The five callers: click-to-insert in the sidebar, drag-and-drop, the slash
// menu, the assistant's `insert_widget` (link 8), and a template seeding a page
// with default bindings (link 7). Each supplies a different origin and the same
// two arguments.
//
// It lives in `packages/pages` beside the registry rather than in `apps/web`,
// so the assistant and the template seeder reach it without importing UI.

export type InsertError =
  | { reason: "unknown-widget"; name: string }
  | { reason: "bad-params"; name: string; message: string };

/**
 * The filter dimensions this widget does not accept, out of the ones supplied.
 *
 * **ADR-039 decision 3 asks for a refusal here, not a strip**: *"the picker
 * offers only combinations that are legal; `insertWidget` refuses the rest,
 * with the same typed refusal it uses for bad params today."* The params schema
 * is `.strip()`, so `insertWidget("city.rows", { kind: "booked" })` was landing
 * a node with the kind quietly dropped — a caller's filter discarded by the one
 * function whose whole job is to refuse bad input (Copilot, PR 141).
 *
 * **Strict on the way in, permissive on the way out**, which is the same
 * asymmetry `PageContent` already documents: `.strip()` stays on the read path
 * so a document written by a NEWER build still opens, and this closes the write
 * path so no build writes one carelessly.
 *
 * Only the closed filter vocabulary is checked. A key outside it is either a
 * primitive's own non-filter param (`count`'s `of`, `attribute`'s `field`) —
 * which its schema validates — or ordinary junk, and junk has always stripped.
 */
function illegalFilters(def: AnyMacroDef, params: unknown): string[] {
  if (!def.selection || typeof params !== "object" || params === null || Array.isArray(params)) return [];
  const declared = new Set<string>(def.selection.filters);
  return Object.keys(params).filter(
    (key) => (FilterDimension.options as readonly string[]).includes(key) && !declared.has(key),
  );
}

export type InsertResult =
  | { ok: true; node: MacroNode }
  | { ok: false; error: InsertError };

/**
 * Build a validated widget node, or refuse with a typed reason.
 *
 * `params` is `unknown` on purpose: every caller is handing over something a
 * person or a model chose, and the widget's own schema is the only thing that
 * decides whether it is usable. Returning a refusal rather than throwing keeps
 * the sidebar's job a render rather than a try/catch.
 *
 * **Defaults come from the schema, not from here.** A widget that binds nothing
 * parses `{}` into whatever its `params` declares, so "insert immediately" and
 * "insert then point it" are the same code path — the second just produces a
 * node whose resolver reports `unbound` until the chrome row fills it in.
 */
export function insertWidget(name: string, params: unknown = {}): InsertResult {
  const def = getMacro(name);
  if (!def) return { ok: false, error: { reason: "unknown-widget", name } };

  // `params ?? {}` here would turn an EXPLICIT `null` into an empty object, so
  // `insertWidget("cost.day", null)` inserted an unbound widget instead of
  // reporting bad params — the caller's input silently discarded by the one
  // function whose whole job is to refuse bad input. The default argument above
  // still covers an OMITTED argument, which is the case that wanted defaulting.
  // Found by CodeRabbit on PR 139.
  // Legality before shape: "this widget has no kind" is a more useful sentence
  // than whatever a stripped schema would have said, which is nothing at all.
  const illegal = illegalFilters(def, params);
  if (illegal.length > 0) {
    return {
      ok: false,
      error: {
        reason: "bad-params",
        name,
        message: `${name} does not accept ${illegal.join(", ")} (it selects over ${def.selection!.entity} by ${def.selection!.filters.join(", ") || "nothing"})`,
      },
    };
  }

  const parsed = def.params.safeParse(params);
  if (!parsed.success) {
    return { ok: false, error: { reason: "bad-params", name, message: parsed.error.message } };
  }
  return {
    ok: true,
    // The stored discriminator is `"macro"`, not `"widget"` — ADR-038's
    // deviation note. Every page ever written uses it, and v1 is by definition
    // what those rows already contain.
    node: { type: "macro", attrs: { name, params: parsed.data as Record<string, unknown> } },
  };
}
