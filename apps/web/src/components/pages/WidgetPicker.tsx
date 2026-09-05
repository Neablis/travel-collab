"use client";
import { useMemo, useState } from "react";
import { presetCatalog } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import type { WidgetShape } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

// **Named for WHEN you reach for one, not for what it is internally.**
//
// The catalogue's vocabulary table says "one value", "a block", "repeats", and
// the design shows the same. Mitchell, walking the preview (2026-09-04): *"thats
// not how people think of these widgets, they should have better names so people
// understand when they are used"*. He is right — "a block" describes the node,
// which is the author's problem, not the reader's.
//
// So each label answers "where does this land in my page?":
//   single → it reads as a word inside a sentence you wrote
//   block  → it stands on its own, as a table or a list
//   repeat → it becomes one line per day, city or stop
//
// The filter row below uses these same words, so the badge on a row and the
// filter that selects it cannot describe the same thing differently.
const SHAPE_LABEL: Record<WidgetShape, string> = {
  single: "in a sentence",
  block: "a section",
  repeat: "a line each",
};

// `null` is "everything", which is a real choice rather than the absence of one
// — so it gets a name in the row like the others.
type ShapeFilter = WidgetShape | null;
const FILTERS: readonly { value: ShapeFilter; label: string }[] = [
  { value: null, label: "All" },
  { value: "single", label: "In a sentence" },
  { value: "block", label: "A section" },
  { value: "repeat", label: "A line each" },
];

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
  if (inputs.length === 0) return "ready as soon as it lands";
  return `narrow it by: ${inputs.map((i) => i.label.toLowerCase()).join(", ")}`;
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
    <>
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
      {/* The filter row (M14's gate: "search + how it reads over a flat list").
          Chips with `aria-pressed`, the same control `ActivityEditor` uses for
          tags — a pattern this app already has, rather than a fifth way to say
          "one of these is on". A segmented control would have been the tidier
          primitive and does not fit: four labels in a 320px column. */}
      <div role="group" aria-label="Filter by kind" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            variant={shape === f.value ? "primary" : "secondary"}
            size="sm"
            aria-pressed={shape === f.value}
            className="rounded-full px-2.5 py-0.5 text-xs"
            onClick={() => setShape(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-slate">
          {query.trim() === "" ? "No widget of that kind." : `No widget matches “${query.trim()}”.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((w) => (
            <li key={w.name}>
              <Button
                variant="secondary"
                className={
                  draggable
                    ? "h-auto w-full cursor-grab flex-col items-start gap-0.5 px-2 py-1.5 text-left active:cursor-grabbing"
                    : "h-auto w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left"
                }
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
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{w.title}</span>
                  <Badge variant="neutral" className="font-normal">{SHAPE_LABEL[w.shape]}</Badge>
                </span>
                {/* A FIXED sample, never a computed value (ADR-037 decision 5):
                    a preview asserting numbers the live widget computes makes
                    the picker and the page contradict each other in one
                    session. M14's gate box asks instead for "a real resolved
                    preview" — the two were written the same day and the ADR is
                    the accepted decision, so this follows the ADR. Recorded in
                    the milestone file rather than settled silently here. */}
                <span className="text-xs font-normal text-slate">{w.preview}</span>
                {/* `text-xs`, not an arbitrary `text-[11px]`: the design-system
                    wall is tokens-only and `check-color-wall.mjs` rejects
                    arbitrary Tailwind values outright. Caught by CI on PR 139,
                    not by `pnpm --filter web lint` — the wall is its own script
                    under `pnpm check`, so a scoped lint run cannot see it. */}
                <span className="font-mono text-xs font-normal text-slate">{takesLine(w.inputs)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
