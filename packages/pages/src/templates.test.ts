import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CreatePageInput, PageDoc } from "@tc/contracts";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY, getTemplate, instantiateDefaults } from "./templates";
import { notebookPreviewOf } from "./linkTarget";
import { insertWidget } from "./insert";
import { getMacro, renderMacro } from "./registry";
import { tripDetailFactory } from "@tc/factories";
import type { WidgetContext } from "./registry-types";

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
  // **Four, since M30** — Mitchell, 2026-09-26, reversing his 2026-09-12 *"Only
  // 1 notebook per trip is always generated"*: *"Maybe the issue is trying to
  // make the overview do everything, and instead we have several notebooks,
  // with different purposes."* Only the first is marked, and so only it is
  // undeletable (`deletePage` refuses on the marker, not on the title).
  it("seeds four notebooks into a new trip, and only the Overview is marked", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.title)).toEqual(["Overview", "Before you go", "Bookings", "Money"]);
    expect(DEFAULT_TEMPLATES.map((t) => t.buildContext("t").kind)).toEqual(["overview", undefined, undefined, undefined]);
  });

  // **The Overview is not IN the gallery; every other seeded notebook is.**
  // There can be exactly one page marked `kind: "overview"` per trip, so a
  // gallery button that made a second would offer a broken outcome (rule 2).
  // The other three are offered, which is how a notebook somebody deleted comes
  // back — and they lead the gallery, where a returning reader recognises them.
  it("offers every seeded notebook but the Overview in the gallery, first", () => {
    const libraryKeys = TEMPLATE_LIBRARY.map((t) => t.key);
    const [overview, ...rest] = DEFAULT_TEMPLATES.map((t) => t.key);
    expect(libraryKeys).not.toContain(overview);
    expect(libraryKeys.slice(0, rest.length)).toEqual(rest);
    for (const t of TEMPLATE_LIBRARY) expect(t.seedIntoNewTrips).toBe(rest.includes(t.key));
    expect(libraryKeys.length).toBeGreaterThan(rest.length);
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

  it("instantiateDefaults produces valid CreatePageInputs bound to the trip, with the ids it was handed", () => {
    const tripId = crypto.randomUUID();
    const minted: string[] = [];
    const inputs = instantiateDefaults(tripId, () => {
      const id = crypto.randomUUID();
      minted.push(id);
      return id;
    });
    expect(inputs).toHaveLength(DEFAULT_TEMPLATES.length);
    expect(inputs.map((i) => i.id)).toEqual(minted);
    for (const input of inputs) expect(CreatePageInput.safeParse(input).success).toBe(true);
    // A page is trip-bound and carries no scope (SPEC §18) — `kind` is not a
    // scope, it is which page this is (§25), and only the Overview has one.
    expect(inputs.map((i) => i.context)).toEqual([{ tripId, kind: "overview" }, { tripId }, { tripId }, { tripId }]);
  });

  // ADR-056: the Overview names its siblings by the ids the SEEDER minted —
  // not the placeholders `content` carries, and not titles, which a reader may
  // change. Seen red with `instantiateDefaults` passing `t.content` instead of
  // `buildContent(ids)`: the links then named `…f001`–`…f003`.
  it("links the seeded Overview to the other three seeded notebooks, by their minted ids", () => {
    let n = 0;
    const inputs = instantiateDefaults(crypto.randomUUID(), () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const [overview, ...siblings] = inputs;
    const targets = widgetsIn(overview!.content)
      .filter((node) => node.attrs?.name === "link.internal")
      .map((node) => (node.attrs?.params as { to: { pageId: string } }).to.pageId);
    expect(targets).toEqual(siblings.map((s) => s.id));
    // The siblings do not link anywhere; only the Overview is built per trip.
    for (const s of siblings) expect(widgetsIn(s.content).some((node) => node.attrs?.name === "link.internal")).toBe(false);
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
    // The seeded Overview too: it is built the same way, and a stripped param
    // there is worse than in the gallery — every new trip gets it.
    for (const t of [...DEFAULT_TEMPLATES, ...TEMPLATE_LIBRARY]) {
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
   * The one exception is a loading line at first paint: a widget with an
   * outside input (`needs`) may say "loading weather" before its fetch lands,
   * and must say something the trip explains once it has.
   */
  // **The rule this file's header states, enforced by running the widgets
  // rather than by reading their declarations.**
  //
  // > A widget that reads well on an empty trip may be seeded. One that does
  // > not, may not.
  //
  // It used to check that each seeded widget HAD an `emptyText`, which is a
  // much weaker claim: a widget can carry one and still come out `unbound` — a
  // grey "needs a day" chip on a page nobody has bound anything on — and it
  // never resolved a single one to find out. This builds the trip a person
  // actually lands on a minute after pressing "New trip" — no dates, no days,
  // no stops, no budget — and renders every seeded widget against it.
  it("seeds only widgets that say something readable on a brand-new empty trip", () => {
    // dayCount 0: a trip created with no dates — the wizard's "decide later".
    const bare = tripDetailFactory.build({ startDate: null }, { transient: { dayCount: 0 } });
    // **And the trip the wizard makes when it IS given dates**: days, each
    // dated, and not one stop. This is the likelier first visit, and the one
    // where `day.weather` has something to ask about — days — and nothing to
    // ask it with. It was missing until the #243 review, which is how a rule
    // that said "no widget waiting on a third party" shipped next to a seeded
    // weather block that, on this trip, did exactly that.
    const datedBuilt = tripDetailFactory.build(
      { startDate: "2026-10-12" },
      { transient: { dayCount: 3, startDate: "2026-10-12" } },
    );
    const dated = {
      ...datedBuilt,
      days: datedBuilt.days.map((day, i) => ({ ...day, date: `2026-10-1${2 + i}` })),
    };
    const datedGlobals = {
      days: dated.days.map((day, index) => ({
        index, date: day.date, cities: [], activityCount: 0, costSubtotal: 0, place: null, timeZone: null,
      })),
      cities: [],
      tags: [],
      homeTimeZone: null,
    };
    // What `GET /api/trips/:id/weather` answers for a trip with no located stop:
    // zero points, and no upstream call behind them (`weatherPointsOf`).
    // And what `GET /pages` answers once the seeder has run: the four seeded
    // notebooks, each described by its own first line (ADR-056). Seeded through
    // `instantiateDefaults` itself, so the Overview's links carry the ids the
    // list carries — a placeholder id would pass as "this notebook was
    // deleted", which is `empty` with words and would hide a broken seed.
    let n = 0;
    const seeded = instantiateDefaults(bare.tripId, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const notebooks = {
      state: "ready" as const,
      value: { pages: seeded.map((p) => ({ id: p.id, title: p.title, ...notebookPreviewOf(p.content) })), openable: true },
    };
    const fetched = { weather: { state: "ready" as const, value: { points: [] } }, notebooks };

    // **Each trip is read at two moments.** First paint: no globals, no today,
    // and every outside input still in flight. Then, a beat later, the globals,
    // the reader's date and the fetched weather. A widget that is quiet while
    // they load and asks for a binding once they arrive would pass the first
    // moment alone; one that only reads well once they land would pass the
    // second alone.
    type Moment = { name: string; firstPaint: boolean; ctx: WidgetContext };
    const moments: Moment[] = [
      {
        name: "empty trip, first paint",
        firstPaint: true,
        ctx: { trip: bare, page: { tripId: bare.tripId }, user: null, globals: null, today: null },
      },
      {
        name: "empty trip, after load",
        firstPaint: false,
        ctx: {
          trip: bare, page: { tripId: bare.tripId }, user: null,
          globals: { days: [], cities: [], tags: [], homeTimeZone: null }, today: "2026-09-26", external: fetched,
        },
      },
      {
        name: "dated days, no stops, first paint",
        firstPaint: true,
        ctx: { trip: dated, page: { tripId: dated.tripId }, user: null, globals: null, today: null },
      },
      {
        name: "dated days, no stops, after load",
        firstPaint: false,
        ctx: {
          trip: dated, page: { tripId: dated.tripId }, user: null,
          globals: datedGlobals, today: "2026-09-26", external: fetched,
        },
      },
    ];

    let loadingSeen = 0;
    let linksFound = 0;
    for (const { name: moment, firstPaint, ctx } of moments) {
      for (const t of seeded.map((p) => ({ key: p.title, content: p.content }))) {
        for (const node of widgetsIn(t.content)) {
          const name = String(node.attrs?.name ?? "(unnamed)");
          const macro = getMacro(name);
          expect(macro, `${t.key} seeds an unregistered widget: ${name}`).toBeDefined();

          const outcome = renderMacro(ctx, name, node.attrs?.params ?? {});
          // `unbound` is the state this test exists to refuse: it renders as a
          // chip asking for a binding the seeded page never made.
          expect(
            outcome.status,
            `${t.key} seeds ${name}, which asks to be bound before it will say anything (${moment})`,
          ).not.toBe("unbound");
          // **`unavailable("pending")` is a loading line, and first paint is
          // when things load.** A widget that declares an outside input
          // (`needs`) says "loading weather" while its fetch is in flight — the
          // same beat every other widget spends waiting for its globals. What
          // is refused is that line OUTLIVING the load: after it, the widget
          // must have said something the trip explains (`ok` or `empty`).
          if (
            firstPaint &&
            outcome.status === "unavailable" &&
            outcome.reason === "pending" &&
            (macro!.needs?.length ?? 0) > 0
          ) {
            loadingSeen++;
            continue;
          }
          expect(["ok", "empty"], `${t.key} seeds ${name}, which failed to resolve (${moment})`).toContain(outcome.status);
          // A seeded link must FIND its notebook once the list has landed: a
          // "this notebook was deleted" on a trip created a minute ago is a
          // broken seed, however well it is worded.
          if (name === "link.internal" && !firstPaint) {
            expect(outcome.status, `${t.key} links to a notebook the seed did not make (${moment})`).toBe("ok");
            linksFound++;
          }
          if (outcome.status === "empty") {
            // SPEC §36.10b: *"an empty line that says what fills it reads
            // well"* — so there must BE a line, from the resolver's own reason
            // or the widget's blanket one. A blank chip reads as a rendering
            // fault, which is worse than any wording.
            const said = outcome.because ?? macro!.emptyText;
            expect(said, `${t.key} seeds ${name}, which renders an empty chip with no words in it (${moment})`).toBeTruthy();
          }
        }
      }
    }
    // The allowance above is used — the dated trip's weather does load — so
    // it is not a rule nothing exercises. If this drops to zero, the moment
    // has stopped modelling the wizard's trip.
    expect(loadingSeen).toBeGreaterThan(0);
    // Three links, after load, on each of the two trips.
    expect(linksFound).toBe(6);

    // Non-vacuous, and it pins the composition: each seeded notebook is built
    // out of widgets and this is which ones, in reading order. A change here is
    // a deliberate change to what every new trip comes with (M30).
    expect(
      Object.fromEntries(DEFAULT_TEMPLATES.map((t) => [t.title, widgetsIn(t.content).map((node) => node.attrs?.name)])),
    ).toEqual({
      // The letter's facts, the printed schedule, the three notebook cards.
      Overview: ["dates", "city", "day.detail", "link.internal", "link.internal", "link.internal"],
      "Before you go": ["day.fromHome", "day.weather", "country.facts"],
      Bookings: ["stop.rows", "stop.rows", "stop.rows", "open"],
      Money: ["cost.chart", "cost.rows"],
    });
    // The Overview's schedule is the printed itinerary, not the glance.
    expect(widgetsIn(DEFAULT_TEMPLATES[0]!.content).find((node) => node.attrs?.name === "day.detail")?.attrs?.params).toEqual({
      view: "schedule",
    });
    // And the gallery still builds itself — the other half of the old line,
    // which is unchanged and still worth holding.
    for (const t of TEMPLATE_LIBRARY) {
      if (t.key === "trip-overview" || t.key === "day-overview") continue; // prose, by design
      expect(widgetsIn(t.content).length, `${t.key} is a gallery template and should build itself`).toBeGreaterThan(0);
    }
    expect(TEMPLATE_LIBRARY.flatMap((t) => widgetsIn(t.content)).length).toBeGreaterThan(20);
  });
});
