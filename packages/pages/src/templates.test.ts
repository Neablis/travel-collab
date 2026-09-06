import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CreatePageInput, PageDoc } from "@tc/contracts";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY, getTemplate, instantiateDefaults } from "./templates";
import { insertWidget } from "./insert";

/** Every node in a document, depth-first, including nodes inside paragraphs and list items. */
function walk(node: unknown, out: { type?: string; attrs?: { name?: string; params?: unknown } }[] = []) {
  if (typeof node !== "object" || node === null) return out;
  const n = node as { type?: string; content?: unknown[]; attrs?: { name?: string; params?: unknown } };
  if (typeof n.type === "string") out.push(n);
  for (const child of n.content ?? []) walk(child, out);
  return out;
}

const widgetsIn = (doc: unknown) => walk(doc).filter((n) => n.type === "macro");

describe("templates", () => {
  it("seeds exactly Trip Overview + Day overview into a new trip", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key)).toEqual(["trip-overview", "day-overview"]);
  });

  // The gallery offers more than a trip is seeded with, and that split is the
  // reason `seedIntoNewTrips` exists — see the file header. Asserting the
  // containment rather than the two lists separately is what makes "adding a
  // template must not change what every new trip gets" a property rather than a
  // thing to remember.
  it("the seeded set is a subset of the library, and the library leads with it", () => {
    const libraryKeys = TEMPLATE_LIBRARY.map((t) => t.key);
    const seededKeys = DEFAULT_TEMPLATES.map((t) => t.key);
    expect(libraryKeys.slice(0, seededKeys.length)).toEqual(seededKeys);
    for (const key of seededKeys) expect(libraryKeys).toContain(key);
    expect(libraryKeys.length).toBeGreaterThan(seededKeys.length);
  });

  it("every template has a unique key, a title and a gallery description", () => {
    const keys = TEMPLATE_LIBRARY.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TEMPLATE_LIBRARY) {
      expect(t.title.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
      expect(getTemplate(t.key)).toBe(t);
    }
  });

  it("instantiateDefaults produces valid CreatePageInputs bound to the trip", () => {
    const tripId = crypto.randomUUID();
    const inputs = instantiateDefaults(tripId);
    expect(inputs).toHaveLength(DEFAULT_TEMPLATES.length);
    for (const input of inputs) expect(CreatePageInput.safeParse(input).success).toBe(true);
    for (const input of inputs) expect(input.context).toEqual({ tripId }); // a page is trip-bound and nothing else (SPEC §18)
  });

  // Every template — not only the seeded pair — has to survive the write path,
  // because the gallery POSTs one straight to `POST /api/trips/:id/pages`,
  // whose body is `CreatePageInput`. A template the editor cannot open is a
  // template that opens read-only (ADR-038 decision 4).
  it("every template in the library parses as a PageDoc", () => {
    for (const t of TEMPLATE_LIBRARY) {
      const parsed = PageDoc.safeParse(t.content);
      expect(parsed.success, `${t.key}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  /**
   * **The check this file exists for.**
   *
   * `templates.ts` builds widget nodes as typed literals rather than through
   * `insertWidget`, because `insertWidget` returns a refusal and a module-level
   * constant has nowhere to put one — a throw at import time would white-screen
   * every surface that reads `TEMPLATE_LIBRARY`. The compiler checks the node
   * SHAPE; nothing checks the params, which is where a template actually rots:
   * a filter dimension a primitive does not declare (`city.rows` does not take
   * `kind`) is stripped or refused, and the widget silently shows something
   * other than what the template meant.
   *
   * So the refusal happens here instead. Same function, same rules, same typed
   * error — just at test time rather than at import time.
   */
  it("every widget in every template is one insertWidget would accept", () => {
    const failures: string[] = [];
    for (const t of TEMPLATE_LIBRARY) {
      for (const node of widgetsIn(t.content)) {
        const name = node.attrs?.name ?? "(unnamed)";
        const result = insertWidget(name, node.attrs?.params);
        if (!result.ok) {
          failures.push(`${t.key} → ${name}: ${JSON.stringify(result.error)}`);
          continue;
        }
        // Round-trip: what `insertWidget` would have produced must be what the
        // template literally contains. A param the schema strips would pass the
        // check above and still mean the stored node is not the node anybody
        // wrote — which is the same "the caller's input silently discarded"
        // failure `insertWidget` exists to refuse.
        expect(result.node, `${t.key} → ${name}`).toEqual(node);
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The library, serialised, must equal the library.
   *
   * `content/notebooks/built-in-notebooks.json` is a `content-bundle/v1` copy
   * of `TEMPLATE_LIBRARY`, and it exists to make one claim true rather than
   * merely stated: **the format carries notebooks**, demonstrated on the
   * notebooks the product itself ships. A format whose only notebook example
   * is a toy is a format nobody has actually tried.
   *
   * `@tc/fixtures`' `content.test.ts` parses that file against the schema; this
   * checks it still says what the code says. Between the two, the file cannot
   * drift from either the format or the templates.
   *
   * The fix when this fails is to REGENERATE the file from the library, never
   * to edit the JSON: the templates are the source, and the AST is typed there.
   */
  it("content/notebooks/built-in-notebooks.json matches the library", () => {
    const path = fileURLToPath(new URL("../../../content/notebooks/built-in-notebooks.json", import.meta.url));
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    expect(bundle.notebooks).toEqual(
      TEMPLATE_LIBRARY.map((t) => ({
        key: t.key,
        title: t.title,
        description: t.description,
        seedIntoNewTrips: t.seedIntoNewTrips,
        content: t.content,
      })),
    );
  });

  // A template made entirely of prose is a template that is stale by the second
  // day — the reason the M8-era "no macro nodes" rule was lifted (file header).
  // This is the floor, not a target: it fails if somebody strips the widgets
  // back out, and says nothing about how many is right.
  it("the library actually uses widgets", () => {
    const total = TEMPLATE_LIBRARY.flatMap((t) => widgetsIn(t.content));
    expect(total.length).toBeGreaterThan(20);
    for (const t of TEMPLATE_LIBRARY) {
      expect(widgetsIn(t.content).length, `${t.key} has no widgets`).toBeGreaterThan(0);
    }
  });
});
