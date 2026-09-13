import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CreatePageInput, PageDoc } from "@tc/contracts";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY, getTemplate, instantiateDefaults } from "./templates";
import { insertWidget } from "./insert";
import { getMacro } from "./registry";

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
  // SPEC §25, and Mitchell 2026-09-12: *"Only 1 notebook per trip is always
  // generated, this is undeletable notebook that needs to be created on every
  // new trip."* It was two — Trip Overview and Day overview — and both are
  // gallery templates now.
  it("seeds exactly one notebook into a new trip, and it is the Overview", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key)).toEqual(["overview"]);
    expect(DEFAULT_TEMPLATES[0]!.buildContext("t").kind).toBe("overview");
  });

  // **The seeded page is no longer IN the gallery, and that inverts this test.**
  // It used to assert containment — the seeded set is a prefix of the library —
  // because every seeded template was also offerable. The Overview is not: there
  // can be exactly one page marked `kind: "overview"` per trip, so a gallery
  // button that made a second would offer a broken outcome (rule 2). What is
  // left to assert is the disjointness, which is the same property stated from
  // the other side: adding a gallery template still cannot change what a new
  // trip gets.
  it("the seeded page is not in the gallery, and the gallery is not seeded", () => {
    const libraryKeys = TEMPLATE_LIBRARY.map((t) => t.key);
    const seededKeys = DEFAULT_TEMPLATES.map((t) => t.key);
    for (const key of seededKeys) expect(libraryKeys).not.toContain(key);
    for (const t of TEMPLATE_LIBRARY) expect(t.seedIntoNewTrips).toBe(false);
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
    // A page is trip-bound and carries no scope (SPEC §18) — `kind` is not a
    // scope, it is which page this is (§25), and only the Overview has one.
    for (const input of inputs) expect(input.context).toEqual({ tripId, kind: "overview" });
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
    // The GALLERY, which is what the bundle has always carried. The Overview is
    // not in it (see the disjointness test above) and does not belong in a
    // "start from a template" bundle either.
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

  /**
   * **A seeded page may only carry widgets that read well on an empty trip.**
   *
   * This used to be the blunter "the seeded pair is prose, everything you
   * choose is widgets", and it was right about the danger and wrong about the
   * rule. The danger: a widget-bearing page opens a brand-new trip's notebook
   * as five grey "no dates set" chips. The rule that actually prevents it is
   * about the EMPTY STATE, not about widgets — and §25 needs the Overview to
   * carry `open`, whose empty state is the sentence "nothing is waiting on
   * you".
   *
   * So the assertion is now: a seeded page's widgets must each declare
   * `emptyText`, which is the widget promising it has something to say when it
   * resolves to nothing. Two of the gallery's widgets do not, and those are
   * exactly the ones that must never be seeded.
   */
  it("seeds only widgets that have something to say when empty", () => {
    for (const t of DEFAULT_TEMPLATES) {
      for (const node of widgetsIn(t.content)) {
        const name = String(node.attrs?.name ?? "(unnamed)");
        const macro = getMacro(name);
        expect(macro, `${t.key} seeds an unregistered widget: ${name}`).toBeDefined();
        expect(
          macro!.emptyText,
          `${t.key} seeds ${name}, which renders nothing on an empty trip`,
        ).toBeTruthy();
      }
    }
    // Non-vacuous: the Overview really does seed a widget, so the loop above is
    // not passing by iterating over nothing.
    expect(DEFAULT_TEMPLATES.flatMap((t) => widgetsIn(t.content).map((n) => n.attrs?.name))).toEqual(["open"]);
    // And the gallery still builds itself — the other half of the old line,
    // which is unchanged and still worth holding.
    for (const t of TEMPLATE_LIBRARY) {
      if (t.key === "trip-overview" || t.key === "day-overview") continue; // prose, by design
      expect(widgetsIn(t.content).length, `${t.key} is a gallery template and should build itself`).toBeGreaterThan(0);
    }
    expect(TEMPLATE_LIBRARY.flatMap((t) => widgetsIn(t.content)).length).toBeGreaterThan(20);
  });
});
