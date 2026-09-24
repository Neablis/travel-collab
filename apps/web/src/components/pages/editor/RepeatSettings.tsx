"use client";
import { useId, useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { REPEAT_SCOPE_ORDER, SENTENCE_TEMPLATE_MAX, type TripDetail, type TripGlobals } from "@tc/contracts";
import {
  REPEAT_WIDGETS, TABLE_ONLY_PARAMS, repeatNoun, repeatOver, repeatTemplate, rescopeRepeat, sentenceFields,
  unknownSentenceTokens, type RepeatOver,
} from "@tc/pages";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { rebindWidget, removeWidget, rescopeRepeatAt, type SelectedRepeat } from "./blockWidgets";
import { WidgetBindControls, bindableInputs } from "./widgetBind";

// The settings of an authored repeat (Mitchell's preview comment on PR #221,
// 2026-09-24): *"one widget 'A sentence X' and its a input to select day, stop
// city"*, and *"make the string template a input setting on the sidebar"*.
//
// Four controls. **What it repeats for**, a segmented choice of day, stop or
// city; switching keeps the sentence when the new collection can print every
// detail in it, and otherwise starts from that collection's own sentence
// (`rescopeRepeat`). **Which ones**, the rows primitive's own filters — "every
// stop in Kyoto", "every booked stop" — through the same `WidgetBindControls`
// every other widget is pointed with, less `columns` (`TABLE_ONLY_PARAMS`),
// which a sentence has none of. **The sentence**, one line of text — the one
// place on screen the raw template, braces and all, is ever shown; a token the
// collection does not publish is named under it, since the page prints it as
// a gap. **Insert a detail**, one "+ Trip day" button per field the chosen
// collection publishes, each dropping its token in at the caret; the author
// never has to know a key exists.
//
// Every write is an attribute step on the document (`blockWidgets.ts`), so the
// page's lines — resolved in Editing exactly as in Reading — follow each
// keystroke, and the repeat stays selected throughout.

const SCOPE_LABEL: Record<RepeatOver, string> = { day: "Day", stop: "Stop", city: "City" };

/**
 * The settings panel for the selected repeat: what it repeats for, which of
 * those it reads, its sentence and the details it can print. Every control
 * writes the repeat at `repeat.pos` through `editor`, as one attribute step.
 */
export function RepeatSettings({
  editor,
  repeat,
  detail,
  globals,
}: {
  editor: Editor;
  repeat: SelectedRepeat;
  detail: TripDetail;
  globals: TripGlobals | null;
}) {
  // A stored name that is no longer a collection reads as days, so the panel
  // has an answer to show; choosing any scope writes a valid one.
  const over = repeatOver(repeat.name) ?? "day";
  const template = repeatTemplate(repeat.params);
  const fields = sentenceFields(over);
  const input = useRef<HTMLInputElement>(null);
  // Where the caret goes once an inserted detail has reached the input. Set by
  // the insert, spent by the effect below after React writes the new value —
  // setting it before would put it inside the old string.
  const caretAfterInsert = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = caretAfterInsert.current;
    if (at === null || input.current === null) return;
    caretAfterInsert.current = null;
    input.current.focus();
    input.current.setSelectionRange(at, at);
  }, [template]);

  const writeTemplate = (next: string) =>
    editor.view.dispatch(rebindWidget(editor.state, repeat.pos, { ...repeat.params, template: next }));

  const insertDetail = (key: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? start;
    const next = `${template.slice(0, start)}{${key}}${template.slice(end)}`;
    // The input's own `maxLength` stops typing past the limit; a detail
    // dropped in has to be held to it too, or the params schema refuses it.
    if (next.length > SENTENCE_TEMPLATE_MAX) return;
    caretAfterInsert.current = start + key.length + 2;
    writeTemplate(next);
  };

  const noun = repeatNoun(over);
  const detailsHeading = useId();
  const detailsHint = useId();
  const unknownHint = useId();

  // The rows primitive's filters, as the controls see them: the repeat's own
  // `template` held aside, so no control can touch it, and put back on every
  // write — the same attribute step the sentence and the scope take. Keyed by
  // the STORED name, so a name that is no collection offers no controls rather
  // than day controls writing onto it.
  const filters = withoutTemplate(repeat.params);
  const filterInputs = bindableInputs(repeat.name).filter((i) => !TABLE_ONLY_PARAMS.includes(i.name));
  const writeFilters = (next: Record<string, unknown>) => {
    const own = "template" in repeat.params ? { template: repeat.params.template } : {};
    editor.view.dispatch(rebindWidget(editor.state, repeat.pos, { ...withoutTemplate(next), ...own }));
  };

  // Tokens this collection does not publish print as a gap on the page
  // (`sentenceLine`), so the author is told which, and why, while typing.
  const unknown = unknownSentenceTokens(over, template);

  return (
    <div className="flex flex-col gap-4" data-testid="widget-settings">
      <Heading level={3} className="text-sm font-semibold">
        A sentence for each {noun}
      </Heading>

      <FormField id="repeat-settings-over" label="Repeat for each">
        <SegmentedControl
          aria-label="Repeat for each"
          value={over}
          options={REPEAT_SCOPE_ORDER.map((scope) => ({ value: scope, label: SCOPE_LABEL[scope] }))}
          onValueChange={(next) =>
            editor.view.dispatch(rescopeRepeatAt(editor.state, repeat.pos, REPEAT_WIDGETS[next], rescopeRepeat(next, repeat.params)))
          }
        />
      </FormField>

      {filterInputs.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label={`Which ${noun} it is for`}>
          <WidgetBindControls
            name={repeat.name}
            params={filters}
            detail={detail}
            globals={globals}
            onChange={writeFilters}
            layout="stacked"
            idPrefix="repeat-settings"
            inputs={filterInputs}
            title={`A sentence for each ${noun}`}
          />
        </section>
      ) : null}

      <FormField
        id="repeat-settings-sentence"
        label="Sentence"
        hint={`Printed once for each ${noun}, as the page shows it.`}
      >
        <Input
          id="repeat-settings-sentence"
          ref={input}
          value={template}
          maxLength={SENTENCE_TEMPLATE_MAX}
          autoComplete="off"
          placeholder="Welcome to"
          aria-describedby={unknown.length > 0 ? unknownHint : undefined}
          onChange={(e) => writeTemplate(e.target.value)}
        />
        {unknown.length > 0 ? (
          <div id={unknownHint} className="flex flex-col gap-0.5">
            {unknown.map((key) => (
              <Text key={key} variant="muted" className="text-warning-ink">
                {`{${key}} isn't a detail of each ${noun}, so the page leaves a gap there.`}
              </Text>
            ))}
          </div>
        ) : null}
      </FormField>

      {/* **Headed by what a button DOES** (Mitchell, PR 221 preview: *"Oh i
          didnt realize this was a shortcut for the templates, that wasnt clear
          and was pretty confused at first"*). The heading names the action,
          the hint says where the detail lands, and each button reads
          "+ Trip day" — a short name, one line (*"Lines are too long"*), so
          the row reads as things to add rather than as settings. */}
      <div className="flex flex-col gap-1.5">
        <Label id={detailsHeading}>Insert a detail</Label>
        <div
          role="group"
          aria-labelledby={detailsHeading}
          aria-describedby={detailsHint}
          className="flex flex-wrap gap-1.5"
        >
          {fields.map((field) => (
            <Button
              key={field.key}
              variant="secondary"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => insertDetail(field.key)}
            >
              <span aria-hidden className="text-slate">+</span>
              {field.label}
            </Button>
          ))}
        </div>
        <Text variant="muted" id={detailsHint}>
          Adds it to the sentence at the cursor, filled in for each {noun}.
        </Text>
      </div>

      <div className="flex justify-end">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => editor.view.dispatch(removeWidget(editor.state, repeat.pos))}
          aria-label={`Remove the sentence for each ${noun}`}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

// A repeat's params less its own `template`: the rows primitive's filters.
function withoutTemplate(params: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...params };
  delete rest.template;
  return rest;
}
