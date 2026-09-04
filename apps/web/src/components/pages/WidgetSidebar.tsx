"use client";
import { useMemo, useState } from "react";
import { macroCatalog, insertWidget } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import type { WidgetShape } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";

// ADR-037 decision 4's insert surface: **a persistent sidebar, not §18's Sheet**
// (Mitchell, 2026-09-03: *"definitely side bar and drag in or click insert and
// it puts the widget inline at cursor"*). `DRIFT.md` records that the build
// diverges from the design here so the next design pass reconciles rather than
// re-specifying a Sheet.
//
// **It lists the registry, not a hand-written menu.** `macroCatalog()` is the
// live registry, so a widget added inside `packages/pages` appears here with no
// edit to this file — which is the same requirement that killed `MacroView`'s
// name switch. A menu enumerated here would be the second list all over again.
//
// Nothing here decides what a valid node is: `insertWidget` does, and it is the
// one path (decision 4 — "there is no way to put a widget into a document that
// skips validation"). This component's whole job is to say which name, and to
// hand the resulting node to the editor.

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
function matches(
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

export function WidgetSidebar({ onInsert }: { onInsert: (node: { type: "macro"; attrs: { name: string; params: Record<string, unknown> } }) => void }) {
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState<ShapeFilter>(null);
  const widgets = useMemo(() => macroCatalog(), []);
  const shown = widgets.filter((w) => matches(w, query) && (shape === null || w.shape === shape));

  return (
    <aside aria-label="Widgets" className="w-64 shrink-0 rounded-md border border-hairline bg-surface p-3">
      <Heading level={4} className="mb-1">Widgets</Heading>
      <p className="mb-2 text-xs text-slate">
        Click one to drop it where your cursor is.
      </p>
      {/* The gate's "search over a flat list". The registry passed nine widgets
          on the day this sidebar shipped and passes thirteen now; the list is
          what grows every time someone does the thing the widget model was
          built to make cheap. */}
      <Input
        type="search"
        aria-label="Search widgets"
        placeholder="Search widgets"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3 h-8 text-sm"
      />
      {/* The filter row (M14's gate: "search + how it reads over a flat list").
          Chips with `aria-pressed`, the same control `ActivityEditor` uses for
          tags — a pattern this app already has, rather than a fifth way to say
          "one of these is on". A segmented control would have been the tidier
          primitive and does not fit: four labels in a 256px rail. */}
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
                className="h-auto w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left"
                onClick={() => {
                  const result = insertWidget(w.name);
                  // The sidebar only ever offers names the registry gave it, so
                  // a refusal here can only mean a widget's own schema cannot
                  // parse `{}` — which the registry-wide insert test asserts
                  // never happens. Nothing is inserted rather than something
                  // invalid.
                  if (result.ok) onInsert(result.node);
                }}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{w.title}</span>
                  <Badge variant="neutral" className="font-normal">{SHAPE_LABEL[w.shape]}</Badge>
                </span>
                {/* A FIXED sample, never a computed value (ADR-037 decision 5):
                    a preview asserting numbers the live widget computes makes
                    the sidebar and the page contradict each other in one
                    session. M14's gate box asks instead for "a real resolved
                    preview" — the two were written the same day and the ADR is
                    the accepted decision, so this follows the ADR. Recorded in
                    the milestone file rather than settled silently here. */}
                <span className="text-xs font-normal text-slate">{w.preview}</span>
                {/* `text-xs`, not an arbitrary `text-[11px]`: the design-system wall is
                    tokens-only and `check-color-wall.mjs` rejects arbitrary
                    Tailwind values outright. Caught by CI on this PR, not by
                    `pnpm --filter web lint` — the wall is its own script under
                    `pnpm check`, so a scoped lint run cannot see it. */}
                <span className="font-mono text-xs font-normal text-slate">{takesLine(w.inputs)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
