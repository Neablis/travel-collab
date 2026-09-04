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

// The catalogue's own vocabulary table, which is the wording a person reading
// the sidebar has the best chance of already understanding. `single` is the
// stored identifier; "one value" is what it means.
const SHAPE_LABEL: Record<WidgetShape, string> = {
  single: "one value",
  block: "a block",
  repeat: "repeats",
};

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
  const widgets = useMemo(() => macroCatalog(), []);
  const shown = widgets.filter((w) => matches(w, query));

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
      {shown.length === 0 ? (
        <p className="text-xs text-slate">No widget matches “{query.trim()}”.</p>
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
                <span className="font-mono text-[11px] font-normal text-slate">{takesLine(w.inputs)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
