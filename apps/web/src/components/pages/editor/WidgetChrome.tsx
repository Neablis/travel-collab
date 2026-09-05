"use client";
import { useState } from "react";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { WidgetBindControls, bindSummary, bindableInputs } from "./widgetBind";

// The chrome row (M14 link 4 / ADR-037 decision 4) — where a widget is pointed
// at its inputs after it has been inserted.
//
// **One control per BOUND WIDGET, never one aggregated control for a block.**
// That was ADR-037's last open question and Mitchell settled it on 2026-09-03:
//
// > i should be able to have a notebook that shows day 1, day 3 and day 9, if we
// > lock all widgets to one selection, its not possible
//
// So this renders against a single widget instance and knows nothing about its
// neighbours. Two day widgets in one sentence — *"We land on Day 1 in Tokyo and
// by Day 9 we are in Kyoto"* — get two independent selects, which is the case
// an aggregated control cannot answer honestly.
//
// It shows only in Editing mode; Reading is the traveller's view and shows no
// chrome at all (§18). `PageScreen` owns that switch, and this component is
// simply not rendered in Reading.
//
// The controls themselves, the option lists and the merge-don't-replace rule all
// live in `widgetBind.tsx` now: SPEC §19 gives the phone a bind *sheet* and the
// insert flow a bind *step*, and three surfaces building their own option list
// is how a phone ends up offering a day the desktop does not.

export function WidgetChrome({
  name,
  params,
  detail,
  globals = null,
  onChange,
}: {
  name: string;
  params: Record<string, unknown>;
  detail: TripDetail;
  globals?: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const isPhone = useIsPhone();
  const [binding, setBinding] = useState(false);
  const def = getMacro(name);
  // A widget that binds nothing has nothing to point — it inserted immediately
  // and stays that way (ADR-035 decision 2: `inputs: []` is a real answer).
  const inputs = bindableInputs(name);
  if (inputs.length === 0) return null;

  const title = def?.title ?? name;

  // **The phone collapses the row to one button, and that is the ONE
  // divergence SPEC §19 allows** — density, not model. On desktop the chrome
  // row carries a name chip plus a select per input, inline; at 390px that row
  // wraps into unreadability, so the phone shows the resolved binding as a 44px
  // button and opens the same controls in a sheet.
  //
  // The button label IS the binding (`bindSummary`), not a second copy of the
  // widget's name: §19's rule 4 — "binds render on binds, not on name pills",
  // and the widget's output is already rendered above it.
  if (isPhone) {
    return (
      <>
        <span className="mt-1 flex">
          <Button
            variant="secondary"
            className="min-h-11 rounded-full text-sm font-normal"
            onClick={() => setBinding(true)}
          >
            {/* "Showing", not "Pointed at". §19 wrote the label when a widget
                with nothing bound was genuinely unpointed; ADR-039 decision 2
                makes that state the widest true answer instead, and "Pointed at
                everything" is not a sentence. */}
            Showing {bindSummary(name, params, detail, globals)}
          </Button>
        </span>
        {/* `bottom`, not the default rail. This is the phone branch, and a
            right-hand rail at 390px is the full-screen takeover the phone
            treatment exists to replace — SPEC §19 asks for a sheet. The insert
            flow got it and this one did not, which made the two halves of the
            same divergence disagree. Found by Copilot on PR 139. */}
        <Sheet open={binding} onOpenChange={setBinding} size="bottom" title={title}>
          <div className="flex flex-col gap-4">
            {/* Said out loud because the page-scope model is recent enough that
                someone may still expect the old behaviour, where one control at
                the top of the page moved every widget on it (§18 removed that,
                §19 asks for this sentence). */}
            <Text variant="secondary">
              This widget only — everything else on the page keeps what it is pointed at.
            </Text>
            <WidgetBindControls
              name={name}
              params={params}
              detail={detail}
              globals={globals}
              onChange={onChange}
              layout="stacked"
              idPrefix="widget-bind"
            />
            {def ? (
              <div>
                <Text variant="muted">Reads as</Text>
                {/* A FIXED sample, never a computed value (ADR-037 decision 5).
                    The live widget is rendered on the page behind this sheet;
                    a computed preview here would be the same number twice
                    (project rule 4) and would contradict it the moment the
                    binding above changed but the sheet had not closed. */}
                <Text variant="secondary">{def.preview}</Text>
              </div>
            ) : null}
          </div>
        </Sheet>
      </>
    );
  }

  // **A block's chrome gets its own row; a single value's stays inline.**
  //
  // The row used to be inline for every shape, so a `block` or `repeat` widget
  // put its controls in the text flow immediately after content that is not in
  // the text flow — Mitchell, on the preview: "the dropdown is also overtop the
  // widget block". Inline is right for a value that reads as a word in a
  // sentence and wrong for anything that occupies its own space.
  //
  // Still one ProseMirror node type (`MacroNodeExtension` stays an inline atom):
  // this is a `display` decision inside the node view, not a schema change, so
  // ADR-035's "one node type, not two" is untouched.
  const inline = def?.shape === "single";

  return (
    <span
      className={
        inline
          // `flex-wrap`, because a primitive declares up to five controls
          // (ADR-039 decision 1) where a named widget declared one or two, and
          // an inline row that cannot wrap pushes the paragraph it sits in
          // sideways. SPEC §5 asks for one control per dimension "including the
          // ones you have not set", so the row is wide by design and has to
          // fold rather than overflow.
          ? "ml-1 inline-flex flex-wrap items-center gap-1 align-middle"
          : "mt-1 flex flex-wrap items-center gap-1"
      }
    >
      {/* The name pill. §18 makes it conditional on the widget having a name;
          every widget here has a title, and an itinerary under an authored
          heading is the case that would drop it — link 6's problem, not this
          one's. */}
      <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-pressed">
        {title}
      </span>
      <WidgetBindControls
        name={name}
        params={params}
        detail={detail}
        globals={globals}
        onChange={onChange}
        layout="inline"
        idPrefix={`widget-chrome-${name}`}
      />
    </span>
  );
}
