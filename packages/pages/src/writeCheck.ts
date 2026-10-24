import { MacroNode } from "@tc/contracts";
import { insertWidget } from "./insert";
import { insertRepeat } from "./repeat";

/**
 * The first widget in a document that the registry refuses, as a sentence, or
 * `null` when every widget is one this build can resolve.
 *
 * **Every widget, not just the ones a picker inserted.** ADR-037 decision 4
 * says there is no way to put a widget into a document that skips validation,
 * and `insertWidget` is that door for the five insert paths. A document SAVED
 * whole never went through it, so the server stored `attribute{field:
 * "account.email"}` and `nope.nope{}` as readily as anything else, and
 * ADR-039 decision 6's allow-list was a browser convention (KI-2026-09-05-g,
 * F-B01). Each node is judged by `insertWidget` itself rather than a second
 * copy of its rules, so the write path and the insert path cannot come to
 * disagree — unknown name, bad params, and a filter the widget does not select
 * by are refused here for the reason they are refused there.
 *
 * Lived in `apps/web/src/server/ai/pageTools.ts` as `walkForError`, with one
 * caller on the assistant path. It is here, beside the registry, so every
 * write path reaches it without importing the assistant.
 *
 * Walks `content` at any depth. A node wrapped as `unknown` (ADR-038 decision
 * 3) has no `content` and no `attrs`, so it is carried rather than judged: it
 * belongs to a newer build, and this one has no rule to hold it to.
 *
 * **`held` is what the page already stores, and a widget it already holds is
 * carried, not judged, when its macro is no longer registered**
 * (KI-2026-10-24-g). A macro retired after a page saved it (M52's
 * `assistant.prompts`) is still in that page, and the editor draws it as *this
 * widget isn't available in this version*; refusing it made every later save
 * of the page a 400 until someone found and deleted the widget by hand. Only
 * the unknown-name refusal is lifted, and only for a node the page already
 * held with the same name and params, so a save still cannot ADD a widget the
 * registry does not know. Omit `held` for a document with no stored version.
 */
export function findWidgetError(nodes: readonly unknown[], held: readonly unknown[] = []): string | null {
  return walk(nodes, heldMacroKeys(held, new Set()));
}

/** A macro's identity for "the page already held this": its name and its params, key order aside. */
function macroKey(name: string, params: Record<string, unknown>): string {
  return JSON.stringify([name, canonical(params)]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

function heldMacroKeys(nodes: readonly unknown[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;
    if (record.type === "macro") {
      const parsed = MacroNode.safeParse(node);
      if (parsed.success) into.add(macroKey(parsed.data.attrs.name, parsed.data.attrs.params));
      continue;
    }
    if (Array.isArray(record.content)) heldMacroKeys(record.content, into);
  }
  return into;
}

function walk(nodes: readonly unknown[], held: ReadonlySet<string>): string | null {
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;

    if (record.type === "macro") {
      const parsed = MacroNode.safeParse(node);
      if (!parsed.success) return `Invalid macro node: ${parsed.error.message}`;
      const { name, params } = parsed.data.attrs;
      const checked = insertWidget(name, params);
      if (!checked.ok) {
        if (checked.error.reason !== "unknown-widget") {
          return `Macro "${name}" params failed validation: ${checked.error.message}`;
        }
        if (!held.has(macroKey(name, params))) return `Unknown macro "${name}" is not in the registry.`;
      }
      continue;
    }

    // A repeat is judged by `insertRepeat`, for the reason a widget is judged
    // by `insertWidget`: the door and the write check cannot disagree — its
    // filters and its `template` both. Its sentence is that param, so content
    // is a v2 template nobody migrated (`pageDoc.ts`, v2 → v3), and the editor
    // could not mount it: a repeat is a leaf there.
    if (record.type === "repeat") {
      const parsed = MacroNode.shape.attrs.safeParse(record.attrs);
      if (!parsed.success) return `Invalid repeat node: ${parsed.error.message}`;
      const { name, params } = parsed.data;
      const checked = insertRepeat(name, params);
      if (!checked.ok) {
        return checked.error.reason === "unknown-widget"
          ? `Unknown repeat "${name}": only a day, stop or city collection can be repeated over.`
          : `Repeat "${name}" params failed validation: ${checked.error.message}`;
      }
      if (Array.isArray(record.content) && record.content.length > 0) {
        return `Repeat "${name}" carries content; its sentence belongs in its template param.`;
      }
      continue;
    }

    const nested = record.content;
    if (Array.isArray(nested)) {
      const error = walk(nested, held);
      if (error) return error;
    }
  }
  return null;
}
