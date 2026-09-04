import type { MacroNode } from "@tc/contracts";
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

  const parsed = def.params.safeParse(params ?? {});
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
