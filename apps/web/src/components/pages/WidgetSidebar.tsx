"use client";
import { macroCatalog, insertWidget } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";

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
export function WidgetSidebar({ onInsert }: { onInsert: (node: { type: "macro"; attrs: { name: string; params: Record<string, unknown> } }) => void }) {
  const widgets = macroCatalog();
  return (
    <aside aria-label="Widgets" className="w-64 shrink-0 rounded-md border border-hairline bg-surface p-3">
      <Heading level={4} className="mb-1">Widgets</Heading>
      <p className="mb-3 text-xs text-slate">
        Click one to drop it where your cursor is. Point it at a day afterwards.
      </p>
      <ul className="flex flex-col gap-1">
        {widgets.map((w) => (
          <li key={w.name}>
            <Button
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left"
              onClick={() => {
                const result = insertWidget(w.name);
                // The sidebar only ever offers names the registry gave it, so a
                // refusal here can only mean a widget's own schema cannot parse
                // `{}` — which the registry-wide insert test asserts never
                // happens. Nothing is inserted rather than something invalid.
                if (result.ok) onInsert(result.node);
              }}
            >
              <span className="text-sm font-medium text-ink">{w.title}</span>
              {/* A FIXED sample, never a computed value (ADR-037 decision 5):
                  a preview asserting numbers the live widget computes makes the
                  sidebar and the page contradict each other in one session. */}
              <span className="text-xs font-normal text-slate">{w.preview}</span>
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
