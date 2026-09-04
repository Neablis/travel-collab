"use client";
import { useMemo, useState } from "react";
import { macroCatalog } from "@tc/pages";
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
// **It lists the registry, not a menu.** `macroCatalog()` is live, so a widget
// added inside `packages/pages` appears on every surface with no edit here.
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

// The gate's "a mono line naming what it takes". Said BEFORE the click rather
// than discovered after it: a widget that lands unbound is correct behaviour
// (ADR-037 decision 6 — never a default day) and still surprising if the row
// gave no warning that it wanted pointing.
//
// `[]` is a real answer meaning "binds nothing, inserts immediately" (ADR-035
// decision 2), and saying so is worth a line — it tells a person the widget is
// finished the moment it lands.
function takesLine(inputs: readonly WidgetInput[]): string {
  if (inputs.length === 0) return "ready as soon as it lands";
  return `point it at: ${inputs.map((i) => i.label.toLowerCase()).join(", ")}`;
}

// Match on everything a person might type: the title they see, the description,
// and the stored name. The name is included deliberately — someone who has read
// a document's JSON, or the AI tool surface, knows a widget as `cost.day`, and a
// search that refused to find it would be hiding what the app itself uses.
export function widgetMatches(
  w: { name: string; title: string; description: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    w.title.toLowerCase().includes(q) ||
    w.description.toLowerCase().includes(q) ||
    w.name.toLowerCase().includes(q)
  );
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
  onPick: (name: string) => void;
  // Desktop only, and not a styling flag: a phone has no drag-and-drop into a
  // contenteditable, and a `draggable` row there fights the touch scroll of the
  // sheet it lives in.
  draggable?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState<ShapeFilter>(null);
  const widgets = useMemo(() => macroCatalog(), []);
  const shown = widgets.filter((w) => widgetMatches(w, query) && (shape === null || w.shape === shape));

  return (
    <>
      {/* The gate's "search over a flat list". The registry passed nine widgets
          on the day this shipped and passes thirteen now; the list is what grows
          every time someone does the thing the widget model was built to make
          cheap. `min-h-11` is §13 rule 1 — the phone sheet uses this same field,
          and §16 records getting that sizing wrong once already. */}
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
