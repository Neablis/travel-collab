"use client";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { WidgetBindControls, bindableInputs } from "./widgetBind";
import type { SelectedWidget } from "./MacroEditorContext";

// SPEC §26 — **where a widget's settings live, now that they are not in the
// document.**
//
// > Edit mode used to inject a chrome row — name pill, bind selects, tag chips
// > — above each widget. That meant the document you were editing was not the
// > document you had written: it reflowed the moment you hit Edit, and the
// > thing you were trying to judge moved.
//
// The controls themselves are unchanged: this is the same `WidgetBindControls`
// the chrome row and the phone bind sheet already shared, in the same `stacked`
// layout the sheet used. What changed is only WHERE it is mounted — the
// surface's one existing side channel — so nothing about binding semantics
// moves with it.
//
// **The heading is the widget's name**, which §26 asks for: the handle in the
// document carries a bare ▸ and the name is its tooltip and this panel's title.
// A name pill in the flow was one of the things that made the document reflow.
export function WidgetSettings({
  selection,
  detail,
  globals,
}: {
  selection: SelectedWidget;
  detail: TripDetail;
  globals: TripGlobals | null;
}) {
  const def = getMacro(selection.name);
  const inputs = bindableInputs(selection.name);
  const title = def?.title ?? selection.name;

  return (
    <div className="flex flex-col gap-4" data-testid="widget-settings">
      <Heading level={3} className="text-sm font-semibold">
        {title}
      </Heading>

      {inputs.length === 0 ? (
        // ADR-035 decision 2: `inputs: []` is a real answer, not an unfinished
        // one — `open` (SPEC §25) is the trip's whole list by definition. Saying
        // so is better than an empty panel, which reads as something failing to
        // load.
        <Text variant="muted">This widget has nothing to point — it shows the whole trip.</Text>
      ) : (
        <>
          {/* Said out loud because the page-scope model is recent enough that
              someone may still expect the old behaviour, where one control at
              the top of the page moved every widget on it (§18 removed that).
              Carried over verbatim from the phone bind sheet. */}
          <Text variant="secondary">
            This widget only — everything else on the page keeps what it is pointed at.
          </Text>
          <WidgetBindControls
            name={selection.name}
            params={selection.params}
            detail={detail}
            globals={globals}
            onChange={selection.onChange}
            layout="stacked"
            idPrefix="widget-settings"
          />
        </>
      )}

      {def ? (
        <div>
          <Text variant="muted">Reads as</Text>
          {/* A FIXED sample, never a computed value (ADR-037 decision 5). The
              live widget is on the page beside this panel; a computed preview
              here would be the same number twice (project rule 4) and would
              contradict it the moment a binding changed. */}
          <Text variant="secondary">{def.preview}</Text>
        </div>
      ) : null}
    </div>
  );
}
