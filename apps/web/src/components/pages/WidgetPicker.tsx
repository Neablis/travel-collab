"use client";
import { useMemo, useState } from "react";
import { presetCatalog } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import type { WidgetShape } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

// Choosing WHICH widget — search, the kind filter, and the list of cards.
//
// It is its own component because SPEC §19 gave the same list a second home:
// the desktop opens it in a popover beside the document, the phone opens it as
// the browse step of a bottom sheet, and §19 is explicit that this is "the same
// registry, same order, same copy as desktop". A second hand-written list is
// precisely the thing that made `MacroView`'s name switch a bug.
//
// **It lists the PRESETS, not the registry** (ADR-039 decision 5: *"the
// combination space is not the browsable list; the preset list is"*). Twelve
// primitives times six filter dimensions is a cross product nobody wants to
// browse; a preset is a `(primitive, params, title, keywords)` row that names
// one useful cell of it, and adding one is data with no code at all.
//
// `presetCatalog()` is live, so a preset added inside `packages/pages` appears
// on every surface with no edit here.
//
// Nothing here decides what a valid node is: `insertWidget` does, and it is the
// one path (ADR-037 decision 4 — "there is no way to put a widget into a
// document that skips validation"). This component's whole job is to say which
// name.

// **The chip on a row says the SHAPE, in the design's words**
// (`Trip Planner Redesign.dc.html:7348`, `SHAPES`).
//
// This used to read "in a sentence" / "a section" / "a line each", from
// Mitchell's 2026-09-04 note that the catalogue's vocabulary table was written
// for the author rather than the reader. The design answers that complaint a
// different way and it is the better one: the chip stays short, the ICON in the
// filter above carries the shape visually, and the plain-English sentence moved
// into that control's `title` ("A value that sits inside your sentence"). So
// the words are still there for anyone who needs them, and a row is no longer
// three long phrases deep before it gets to what the widget does.
const SHAPE_LABEL: Record<WidgetShape, string> = {
  single: "inline",
  block: "a block",
  repeat: "a list",
};

// `null` is "everything", which is a real choice rather than the absence of one
// — so it gets a name in the row like the others.
type ShapeFilter = WidgetShape | null;

// **A cell of a kind glyph.** `"fade"` is the muted half of a shape, a number is
// a solid cell with that flex grow, and `"dot"` is the fixed 3px lead a list row
// carries. Straight out of the design's `G` table (`:3657`).
type GlyphCell = "fade" | "dot" | number;
type GlyphRow = { h: number; cells: readonly GlyphCell[] };

// **The four-up kind control** (`Trip Planner Redesign.dc.html:3961-3976`), and
// the icons are the point rather than decoration: the question "how does this
// land in my page" has a shape for an answer, and a 26x18 picture of that shape
// answers it faster than any label fits in a 320px column split four ways.
//
// - All    two rows of two — a bit of everything
// - Inline one short row, solid in the middle, faded either side: a value inside
//          a sentence
// - Block  one filled panel
// - List   three thin rows, each with a lead dot: one row per thing
const FILTERS: readonly {
  value: ShapeFilter;
  label: string;
  hint: string;
  glyph: readonly GlyphRow[];
}[] = [
  {
    value: null,
    label: "All",
    hint: "Every widget",
    glyph: [{ h: 7, cells: [1, 1] }, { h: 7, cells: [1, 1] }],
  },
  {
    value: "single",
    label: "Inline",
    hint: "A value that sits inside your sentence",
    glyph: [{ h: 5, cells: ["fade", 1.6, "fade"] }],
  },
  {
    value: "block",
    label: "Block",
    hint: "A panel that fills the width",
    glyph: [{ h: 16, cells: [1] }],
  },
  {
    value: "repeat",
    label: "List",
    hint: "One row for every one of something",
    glyph: [
      { h: 3, cells: ["dot", "fade"] },
      { h: 3, cells: ["dot", "fade"] },
      { h: 3, cells: ["dot", "fade"] },
    ],
  },
];

/**
 * One kind glyph, drawn from its row table.
 *
 * **The geometry is inline and the colour is not**, which is the split the
 * walls want: `check-color-wall.mjs` refuses arbitrary Tailwind values, and
 * 26x18 with 3px dots is a literal no token names — while every fill here is a
 * token class the wall can still see and check. The same division `MacroView`
 * makes for its column template.
 */
function KindGlyph({ rows, on }: { rows: readonly GlyphRow[]; on: boolean }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- a 26x18 pictogram is a design literal; no token names it, and the colour half below stays in classes where the wall can read it
    <span aria-hidden className="flex flex-col justify-center gap-0.5" style={{ width: 26, height: 18 }}>
      {rows.map((row, i) => (
        // eslint-disable-next-line no-restricted-syntax -- as above: the row heights ARE the picture
        <span key={i} className="flex items-center gap-0.5" style={{ height: row.h }}>
          {row.cells.map((cell, c) => (
            <span
              key={c}
              className={cn(
                "h-full",
                row.h > 8 ? "rounded-xs" : "rounded-full",
                cell === "fade" ? (on ? "bg-brand-tint" : "bg-hairline") : on ? "bg-brand" : "bg-slate",
              )}
              // eslint-disable-next-line no-restricted-syntax -- a cell's share of the row is the shape it is drawing
              style={cell === "dot" ? { flex: "0 0 3px" } : { flex: cell === "fade" ? 1 : cell }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

// The gate's "a mono line naming what it takes", said BEFORE the click rather
// than discovered after it.
//
// **"Narrow it by", not "point it at".** Under ADR-039 decision 2 a widget with
// nothing bound is not waiting for anything — it is showing everything, which
// is the widest true answer — so every row here is ready as soon as it lands
// and the filters are what a person can do NEXT, not a debt the widget arrives
// with. The old wording was correct about `cost.day`, which really was unbound
// until you pointed it at a day, and is a lie about `cost`.
function takesLine(inputs: readonly WidgetInput[]): string {
  if (inputs.length === 0) return "takes nothing \u2014 goes straight in";
  // **The registry's own labels, not the design's `INPUT_WORDS`.** The design
  // carries a second vocabulary keyed by input TYPE (`a stretch of days`,
  // `someone on the trip`); `filters.ts`'s `LABEL_OF` is where this repo says
  // what a dimension is called, and it is what every bind control already
  // shows. Two maps would be two surfaces disagreeing about one dimension,
  // which is the thing `LABEL_OF`'s own comment exists to prevent \u2014 so this
  // reads "takes day + tags" where the design reads "takes a day + tags".
  return `takes ${inputs.map((i) => i.label.toLowerCase()).join(" + ")}`;
}

/**
 * Does this row match what was typed? (spec §6, findability.)
 *
 * **Every word of the query must match something, rather than the whole query
 * matching one field.** The old rule was a single substring over title,
 * description and name, so *"day cost"* found nothing at all — the words are in
 * two different fields, and no field contains the phrase. Token matching is
 * what makes a person's actual search behaviour work.
 *
 * What a token can match:
 *
 * - the **title** they see;
 * - the **description**, which is the sentence under it;
 * - the **id**, deliberately — someone who has read a document's JSON or the AI
 *   tool surface knows a widget by name, and a search that refused to find it
 *   would hide what the app itself uses;
 * - the **keywords**, which are what somebody types when they do not know the
 *   title: `cost` answers to total, spend, price, sum, budget;
 * - the **aliases** — the retired names. `booking.line` stopped existing, and
 *   `/booking` still finds "A line for every booking" (§6's last line).
 */
export function widgetMatches(
  w: {
    name: string;
    title: string;
    description: string;
    keywords?: readonly string[];
    aliases?: readonly string[];
  },
  query: string,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [w.title, w.description, w.name, ...(w.keywords ?? []), ...(w.aliases ?? [])]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

// The drag payload's MIME type, exported so the editor's drop handler and this
// component cannot disagree about it. A bare `text/plain` would let any dragged
// text land as a widget, and would put a widget's stored name into other apps
// when dragged out of the page.
export const WIDGET_DRAG_TYPE = "application/x-tc-widget";

export function WidgetPicker({
  onPick,
  draggable = false,
  autoFocus = false,
}: {
  // The PRESET's id, not a widget name: the row a person clicked is
  // `(primitive, params)`, and only `insertPreset` knows which. Callers hand it
  // straight back rather than resolving it themselves, so there is still one
  // place that turns a click into a node.
  onPick: (presetId: string) => void;
  // Desktop only, and not a styling flag: a phone has no drag-and-drop into a
  // contenteditable, and a `draggable` row there fights the touch scroll of the
  // sheet it lives in.
  draggable?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState<ShapeFilter>(null);
  const widgets = useMemo(() => presetCatalog(), []);
  const shown = widgets.filter((w) => widgetMatches(w, query) && (shape === null || w.shape === shape));

  return (
    // **The rail is a header and a scrolling body, not one long column**
    // (`Trip Planner Redesign.dc.html:3956-3978`). The design gives the header
    // `flex: 0 0 auto` and the list `flex: 1; min-height: 0; overflow-y: auto`,
    // and the reason is not decoration: with one scroll over the whole panel,
    // the search field and the filter chips scroll away the moment you look
    // past the sixth widget — so narrowing a list you are already reading
    // means scrolling back up to the control that narrows it.
    //
    // This resolves only where a container gives it a bounded height, which is
    // the desktop popover (`WidgetInsert` makes it a `max-h-96` flex column).
    // Inside the phone Sheet the height is indefinite, so `flex-1` falls back
    // to content height, the inner `overflow-y-auto` never engages, and the
    // sheet keeps its own single scroll — which is what §13 rule 3 wants on a
    // phone anyway. One structure, correct in both, no `isPhone` branch.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-hairline pb-3">
        {/* The gate's "search over a flat list". It lists presets now, and the
            list is what grows every time someone names a combination worth
            naming — which is a row of data, not code (ADR-039 decision 4).
            `min-h-11` is §13 rule 1 — the phone sheet uses this same field, and
            §16 records getting that sizing wrong once already. */}
        <Input
          type="search"
          aria-label="Search widgets"
          placeholder="Search widgets"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3 min-h-11 text-sm"
        />
        {/* **The design's four-up kind control** (`:3961`), and it replaces four
            wrapping pills. The old row was `Button variant="primary"/"secondary"`
            chips, which is a pattern this app does have — but four labels of
            "In a sentence" / "A section" / "A line each" in a 320px column wrap
            to three lines and still say nothing a picture of the shape would not
            say instantly. A fixed 4-column grid cannot wrap, so the header's
            height is the same whatever is selected.

            `role="radiogroup"` with `role="radio"`, not `aria-pressed` toggles:
            exactly one of these is on at a time, and a radio is the role that
            says so. The plain-English sentence the labels used to carry lives in
            `title` now, which is where the design puts it.

            A raw `<button>`, not the `Button` primitive: every variant it has
            draws a control with its own ground and border, and this needs to be
            a transparent target that becomes a brand tint when chosen. Same
            reason `MapRail` reaches for one. */}
        <div role="radiogroup" aria-label="How it reads" className="grid grid-cols-4 gap-1">
          {FILTERS.map((f) => {
            const on = shape === f.value;
            return (
              // eslint-disable-next-line no-restricted-syntax -- a radio drawn as an icon over a label; every Button variant brings its own ground and border, and this target has to be transparent until chosen
              <button
                key={f.label}
                type="button"
                role="radio"
                aria-checked={on}
                title={f.hint}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1.5 rounded-md px-1 pt-2 pb-1.5 transition-colors",
                  on ? "bg-brand-tint text-brand-pressed" : "text-slate ring-1 ring-hairline ring-inset hover:bg-paper",
                )}
                onClick={() => setShape(f.value)}
              >
                <KindGlyph rows={f.glyph} on={on} />
                <span className="text-2xs leading-none font-semibold">{f.label}</span>
              </button>
            );
          })}
        </div>
        {/* The design's count line (`:3977`), and it is the header's last row
            rather than a caption on the list, because it counts what the two
            controls above it just did — type "day" and the number answers.
            `WidgetInsert`'s popover carried a fixed hint with no count and the
            phone sheet carried nothing; this is one line, on both.

            **The design's own sentence ends "It lands not set up." and that
            clause is deliberately dropped.** Under ADR-039 decision 2 a widget
            with nothing bound is not waiting for anything — it shows
            everything, the widest true answer — which is the same correction
            `takesLine` already carries below ("ready as soon as it lands"). The
            design predates that decision; importing the words would reintroduce
            the lie the build has already fixed once. */}
        <p aria-live="polite" className="mt-3 text-xs text-slate">
          {`${shown.length} ${shown.length === 1 ? "widget" : "widgets"} · `}
          {draggable ? "click to drop one at the cursor, or drag it in." : "tap one to drop it into the page."}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="pt-3 text-xs text-slate">
          {query.trim() === "" ? "No widget of that kind." : `No widget matches “${query.trim()}”.`}
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pt-3">
          {shown.map((w) => (
            <li key={w.name}>
              {/* **A bordered card, not a secondary Button** (`:3980`). The rows
                  were `Button variant="secondary"` stacked at `gap-1`, and
                  twenty-two of those in a 320px column read as a toolbar —
                  every row shouting "press me" with equal weight, so nothing in
                  the list has a hierarchy. The design draws a card: a quiet edge
                  that takes the brand only on hover, and three lines inside it
                  that each answer a different question (what it is, what it
                  needs, what it will look like).

                  Still a real `<button>`, so the list stays keyboard-reachable
                  and `getAllByRole("button")` still means "the rows". The
                  `Button` primitive is what goes, not the semantics. */}
              {/* eslint-disable-next-line no-restricted-syntax -- a three-line card that is also the control; Button&apos;s variants draw an action, and twenty-two actions in a 320px column is the toolbar this change exists to stop */}
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-md border border-hairline bg-surface p-2.5 text-left transition-colors",
                  "hover:border-brand hover:bg-paper",
                  draggable && "cursor-grab active:cursor-grabbing",
                )}
                // Drag is the SAME insert, at a position the pointer chooses
                // rather than one the caret chose (Mitchell: "i cant drag and
                // drop a widget onto page"). The row carries only the widget's
                // name; `insertWidget` still builds and validates the node on
                // the drop side, so there is no second construction path.
                draggable={draggable}
                onDragStart={
                  draggable
                    ? (e) => {
                        e.dataTransfer.setData(WIDGET_DRAG_TYPE, w.name);
                        e.dataTransfer.effectAllowed = "copy";
                      }
                    : undefined
                }
                onClick={() => onPick(w.name)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  {/* The design's grab affordance (`:3982`). `aria-hidden`
                      because it is a picture of "draggable", and the row
                      already announces itself as the control. It shows on the
                      phone too, where nothing drags — deliberately not: a
                      handle that cannot be dragged is a promise the surface
                      cannot keep, so it is bound to `draggable` like the
                      cursor is. */}
                  {draggable ? <span aria-hidden className="text-2xs text-slate">&#8759;</span> : null}
                  <span className="text-sm font-semibold text-ink">{w.title}</span>
                  <Badge variant="neutral" className="font-mono text-2xs font-normal">
                    {SHAPE_LABEL[w.shape]}
                  </Badge>
                </span>
                {/* `text-brand-pressed`, which is the one colour on the card
                    that is not ink or slate — the design uses it to mark the
                    line that says what you still get to choose, so the eye
                    lands on it when scanning for a widget that takes a day. */}
                <span className="font-mono text-2xs font-normal text-brand-pressed">{takesLine(w.inputs)}</span>
                {/* A FIXED sample, never a computed value (ADR-037 decision 5):
                    a preview asserting numbers the live widget computes makes
                    the picker and the page contradict each other in one
                    session. M14's gate box asks instead for "a real resolved
                    preview" — the two were written the same day and the ADR is
                    the accepted decision, so this follows the ADR. Recorded in
                    the milestone file rather than settled silently here. */}
                <span className="text-xs font-normal text-slate">{w.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
