"use client";
import { useEditorState } from "@tiptap/react";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { WidgetBindControls, bindableInputs } from "./widgetBind";
import { rebindWidget, removeWidget, selectedBlock, selectedRepeat, type BlockWidget } from "./blockWidgets";
import { RepeatSettings } from "./RepeatSettings";
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
// **One entry per widget in the selected widget's block, never one aggregated
// control** (§26, and ADR-037 open question 1 as Mitchell settled it: *"i
// should be able to have a notebook that shows day 1, day 3 and day 9, if we
// lock all widgets to one selection, its not possible"*). "We land on Day 1 in
// Tokyo and by Day 9 we are in Kyoto" is one sentence holding two widgets, and
// each is pointed on its own. With more than one, every entry carries the
// number its widget's handle shows in the text.
//
// **The heading is the selected widget's name**, which §26 asks for: the handle
// in the document carries a bare ▸ and the name is its tooltip and this
// panel's title.
//
// **The Wording control is a repeat's, and it is a panel of its own.** §26
// shows it only for a block with authored wording (`hasWording: !!b.editRow`),
// which is the repeat's sentence — so a selected repeat gets `RepeatSettings`
// (its collection, its sentence, the details it can print), and a widget gets
// the entries below, which have no wording to edit.
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
  // Read live from the editor, not from `selection`: rebinding entry 2 changes
  // nothing the SELECTED widget reports, so a panel built from the report alone
  // would go on showing entry 2's old value — and write it back on the next
  // edit. Compared by value (`useEditorState`'s default), so a keystroke
  // elsewhere in the page does not re-render the panel.
  const block = useEditorState({ editor, selector: ({ editor: e }) => selectedBlock(e.state) });
  const repeat = useEditorState({ editor, selector: ({ editor: e }) => selectedRepeat(e.state) });
  if (repeat !== null) return <RepeatSettings editor={editor} repeat={repeat} />;
  // A frame where the report has landed and the editor's selection has already
  // moved on (the selected widget was just removed). The screen closes the
  // panel on the next flush; rendering nothing until then beats rendering
  // controls addressed at a node that is gone.
  if (block === null || block.entries.length === 0) return null;

  const selected = block.entries.find((entry) => entry.pos === block.selectedPos);
  const numbered = block.entries.length > 1;
  const anyBindable = block.entries.some((entry) => bindableInputs(entry.name).length > 0);

  return (
    <div className="flex flex-col gap-4" data-testid="widget-settings">
      <Heading level={3} className="text-sm font-semibold">
        {titleOf(selected ?? block.entries[0]!)}
      </Heading>

      {/* Said out loud because the page-scope model is recent enough that
          someone may still expect the old behaviour, where one control at the
          top of the page moved every widget on it (§18 removed that). Carried
          over verbatim from the phone bind sheet, which §19 quotes, so it does
          not change with the number of entries: each entry IS one widget. */}
      {anyBindable ? (
        <Text variant="secondary">This widget only — everything else on the page keeps what it is pointed at.</Text>
      ) : null}

      {block.entries.map((entry) => (
        <WidgetEntry
          key={entry.mark}
          entry={entry}
          numbered={numbered}
          detail={detail}
          globals={globals}
          onChange={(params) => editor.view.dispatch(rebindWidget(editor.state, entry.pos, params))}
          onRemove={() => editor.view.dispatch(removeWidget(editor.state, entry.pos))}
        />
      ))}
    </div>
  );
}

function titleOf(entry: BlockWidget): string {
  return getMacro(entry.name)?.title ?? entry.name;
}

function WidgetEntry({
  entry,
  numbered,
  detail,
  globals,
  onChange,
  onRemove,
}: {
  entry: BlockWidget;
  numbered: boolean;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const def = getMacro(entry.name);
  const title = titleOf(entry);
  // What names every control in this entry, and the entry itself. Numbered only
  // when there is something to tell apart; a lone widget keeps the plain name
  // its controls have always had.
  const label = numbered ? `${entry.mark} · ${title}` : title;
  const hasInputs = bindableInputs(entry.name).length > 0;

  return (
    <section className="flex flex-col gap-3" aria-label={label} data-testid="widget-settings-entry">
      {numbered ? (
        <div className="flex items-center gap-2">
          <span className="grid size-4 shrink-0 place-items-center bg-brand font-mono text-xs text-surface">
            {entry.mark}
          </span>
          <Text variant="muted" className="font-mono text-xs uppercase">
            {title}
          </Text>
        </div>
      ) : null}

      {hasInputs ? (
        <WidgetBindControls
          name={entry.name}
          params={entry.params}
          detail={detail}
          globals={globals}
          onChange={onChange}
          layout="stacked"
          idPrefix={`widget-settings-${entry.mark}`}
          title={numbered ? label : undefined}
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
