"use client";
import { useEditorState } from "@tiptap/react";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { REPEAT_WIDGETS, getMacro, repeatOver, rescopeRows, type RepeatOver } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { WidgetBindControls, bindableInputs } from "./widgetBind";
import { rebindWidget, removeWidget, rescopeWidgetAt, selectedRepeat, selectedWidget, type SelectedInline } from "./blockWidgets";
import { CollectionPicker, RepeatSettings } from "./RepeatSettings";
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
// layout the sheet used. The desktop column and the phone sheet both mount THIS
// component, which is what keeps them the same rows (§19's parity rule).
//
// **One widget at a time: the selected one** (KI-2026-09-24-x; Mitchell on PR
// #221: *"Just have 1 selected at a time."*). §26 drew one numbered entry per
// widget of the selected widget's block, with matching numbers on the handles
// in the text, so changing the widget you had clicked meant finding its number
// in a list. Each widget is still pointed on its own and never through an
// aggregated control (ADR-037 open question 1 as Mitchell settled it: *"i
// should be able to have a notebook that shows day 1, day 3 and day 9, if we
// lock all widgets to one selection, its not possible"*): "We land on Day 1 in
// Tokyo and by Day 9 we are in Kyoto" is one sentence holding two widgets, and
// reaching the other one is a click on it.
//
// **The heading is the widget's name**, which §26 asks for: the handle in the
// document carries a bare ▸ and the name is its tooltip and this panel's title.
//
// **The Wording control is a repeat's, and it is a panel of its own.** §26
// shows it only for a block with authored wording (`hasWording: !!b.editRow`),
// which is the repeat's sentence — so a selected repeat gets `RepeatSettings`
// (its collection, its sentence, the details it can print), and a widget gets
// the entry below, which has no wording to edit.
//
// **A rows table's entry opens with "Lines for each"** (Mitchell, PR 221
// preview: *"We combined a 'Sentence for every ...' and added a picker for
// type, can we do the same for 'A line for every....'?"*): the same Day / Stop /
// City control the sentence's "Repeat for each" is, moving `day.rows`,
// `stop.rows` and `city.rows` into one another. The switch is ONE transaction —
// the name and the params the new primitive takes (`rescopeRows`) — through
// `rescopeWidgetAt`, `rebindWidget` plus the name, so it is one undo step.
export function WidgetSettings({
  selection,
  detail,
  globals,
}: {
  selection: SelectedWidget;
  detail: TripDetail;
  globals: TripGlobals | null;
}) {
  const { editor } = selection;
  // Read live from the editor, not from `selection`: that report is
  // deduplicated by value (`PageScreen`), so it cannot tell two identical
  // widgets apart, and a write has to address the one the editor's selection
  // is actually on. Compared by value (`useEditorState`'s default), so a
  // keystroke elsewhere in the page does not re-render the panel.
  const widget = useEditorState({ editor, selector: ({ editor: e }) => selectedWidget(e.state) });
  const repeat = useEditorState({ editor, selector: ({ editor: e }) => selectedRepeat(e.state) });
  if (repeat !== null) return <RepeatSettings editor={editor} repeat={repeat} detail={detail} globals={globals} />;
  // A frame where the report has landed and the editor's selection has already
  // moved on (the selected widget was just removed). The screen closes the
  // panel on the next flush; rendering nothing until then beats rendering
  // controls addressed at a node that is gone.
  if (widget === null) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="widget-settings">
      <Heading level={3} className="text-sm font-semibold">
        {titleOf(widget)}
      </Heading>

      {/* Said out loud because the page-scope model is recent enough that
          someone may still expect the old behaviour, where one control at the
          top of the page moved every widget on it (§18 removed that). Carried
          over verbatim from the phone bind sheet, which §19 quotes. */}
      {bindableInputs(widget.name).length > 0 ? (
        <Text variant="secondary">This widget only — everything else on the page keeps what it is pointed at.</Text>
      ) : null}

      <WidgetEntry
        entry={widget}
        detail={detail}
        globals={globals}
        onChange={(params) => editor.view.dispatch(rebindWidget(editor.state, widget.pos, params))}
        onRescope={(over) =>
          editor.view.dispatch(rescopeWidgetAt(editor.state, widget.pos, REPEAT_WIDGETS[over], rescopeRows(over, widget.params)))
        }
        onRemove={() => editor.view.dispatch(removeWidget(editor.state, widget.pos))}
      />
    </div>
  );
}

function titleOf(entry: SelectedInline): string {
  return getMacro(entry.name)?.title ?? entry.name;
}

function WidgetEntry({
  entry,
  detail,
  globals,
  onChange,
  onRescope,
  onRemove,
}: {
  entry: SelectedInline;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
  onRescope: (over: RepeatOver) => void;
  onRemove: () => void;
}) {
  const def = getMacro(entry.name);
  // What names the entry and its Remove button.
  const label = titleOf(entry);
  const hasInputs = bindableInputs(entry.name).length > 0;
  // `day.rows`, `stop.rows`, `city.rows` — a table whose collection is a choice.
  const over = repeatOver(entry.name);

  return (
    <section className="flex flex-col gap-3" aria-label={label} data-testid="widget-settings-entry">
      {over !== null ? (
        <CollectionPicker id="widget-settings-over" label="Lines for each" value={over} onChange={onRescope} />
      ) : null}

      {hasInputs ? (
        <WidgetBindControls
          name={entry.name}
          params={entry.params}
          detail={detail}
          globals={globals}
          onChange={onChange}
          layout="stacked"
          idPrefix="widget-settings"
        />
      ) : (
        // ADR-035 decision 2: `inputs: []` is a real answer, not an unfinished
        // one — `open` (SPEC §25) is the trip's whole list by definition. Saying
        // so is better than an empty entry, which reads as something failing to
        // load.
        <Text variant="muted">This widget has nothing to point — it shows the whole trip.</Text>
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

      <div className="flex justify-end">
        {/* Takes THIS widget out of the sentence and leaves the prose around
            it. `sm` like the design's inspector footer; on a phone the
            button base's own 44px floor applies (§13.1). */}
        <Button variant="destructive" size="sm" onClick={onRemove} aria-label={`Remove ${label}`}>
          Remove
        </Button>
      </div>
    </section>
  );
}
