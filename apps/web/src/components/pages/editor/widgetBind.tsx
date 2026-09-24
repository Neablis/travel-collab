"use client";
import { ActivityKind, type TripDetail, type TripGlobals } from "@tc/contracts";
import { distinctApplies, enumLabel, fieldChoices, getMacro, getPreset, presetParams } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";
import { DaysFilter, daysSummary } from "./DaysFilter";
import { FieldPicker } from "./FieldPicker";
import { FieldColumns } from "./FieldColumns";

// Pointing a widget at its filters, in ONE place — because as of SPEC §19 there
// are three surfaces that do it and they must not disagree:
//
//   1. the desktop chrome row, inline under/beside the widget (`WidgetChrome`),
//   2. the phone's bind sheet, opened from a 44px "Pointed at …" button,
//   3. the insert sheet's *Point it at* step, before the widget lands at all.
//
// §19 states the requirement as *"the same controls, in the same order, with the
// same Reads as preview"* — "binding and rebinding are therefore one act on both
// surfaces; only the container differs". A second copy of the option list is
// exactly how a phone ends up offering a day the desktop does not.
//
// **Every control's first option is "All", and that is ADR-039 decision 2 made
// visible.** Mitchell, on the preview: *"where we have a tool that you can
// select a day, it can also select All at the top, and it gives you a sum, or
// whatever makes sense in that context."* An absent filter is not a widget
// waiting for a choice — it is the widest true answer, and the one default that
// cannot be wrong about what the author meant.
//
// Nothing here writes to a document. Callers own that: the chrome row writes
// node attrs, the insert sheet builds params for `insertWidget`.

// Which of a widget's declared filters this app can render a control for: all
// of them, with `day` and `dates` as one. There is no `person` input to leave
// out any more — it was retired from `WidgetInput` (M14 decision 5).
export function bindableInputs(name: string): readonly WidgetInput[] {
  return collapseDays(getMacro(name)?.inputs ?? []);
}

/**
 * **`day` and `dates` become ONE control.**
 *
 * Mitchell, on the PR 141 preview: *"I dont think we need the date pickers, and
 * the dropdown for all days/specific day, and the range. Combine them into one
 * experience."* Three controls for one question — which days is this about — is
 * two too many, and the two raw date boxes were the worst of them.
 *
 * The `dates` input is the one that survives, because `DaysFilter` writes that
 * dimension (Mitchell's call: one control writing two different dimensions
 * depending on how many cells you touched is a rule nobody can predict from
 * outside). The `day` input drops out of the row and its stored value is still
 * read, shown and clearable by the same control.
 *
 * Every primitive declaring `day` also declares `dates` — asserted in
 * `filters.test.ts`, because this collapse silently loses a control the day one
 * does not.
 */
function collapseDays(inputs: readonly WidgetInput[]): readonly WidgetInput[] {
  const hasDates = inputs.some((input) => input.type === "dates");
  return hasDates ? inputs.filter((input) => input.type !== "day") : inputs;
}

/**
 * The widget a picker row inserts, and the filters its name already answers.
 *
 * A row in the picker is a PRESET (ADR-039 decision 4) — `(primitive, params,
 * title, keywords)` — so the insert sheet's bind step has to start from the
 * preset's own filters and offer only the dimensions the preset has not already
 * decided. `getPreset` is the one place that resolution happens.
 */
export function presetTarget(id: string): { widget: string; params: Record<string, unknown> } | null {
  const preset = getPreset(id);
  return preset ? { widget: preset.widget, params: presetParams(preset) } : null;
}

/**
 * The controls a preset's bind step offers: its widget's, minus what it fixes.
 * None for a sentence: which collection it reads decides which filters apply,
 * and that is chosen in its settings once it lands (`presetInputs`).
 */
export function presetBindableInputs(id: string): readonly WidgetInput[] {
  const preset = getPreset(id);
  if (!preset || preset.repeat) return [];
  return bindableInputs(preset.widget).filter((input) => !(input.name in preset.params));
}

// Reading a param back into a select value, kept beside the writer below so the
// two cannot drift: whatever shape is written is the shape read.
//
// **A `dayId` ref resolves to its current index, and reading only `index` was a
// real bug.** `DayRef` has two shapes and the resolvers honour both, so a widget
// bound by `dayId` — what a hand-edited document or an AI insert can carry —
// rendered its day correctly while the control said the widget was unbound. A
// control contradicting the document it describes is worse than either state
// alone, because the reader believes the control. Found by Copilot on PR 139.
//
// A `dayId` matching no day reads as unset, the same answer the resolvers give
// it: a stale binding is silently no binding, never a guessed one.
export function valueOf(
  input: WidgetInput,
  params: Record<string, unknown>,
  detail: TripDetail,
): string {
  const raw = params[input.name];
  if (input.type === "day") {
    const ref = raw as { kind?: string; index?: number; dayId?: string } | undefined;
    if (ref?.kind === "index" && typeof ref.index === "number") {
      return ref.index < detail.days.length ? String(ref.index) : "";
    }
    if (ref?.kind === "dayId" && typeof ref.dayId === "string") {
      const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
      return idx === -1 ? "" : String(idx);
    }
    // No ref at all is the real "All days", and the one that means every day.
    return "";
  }
  return typeof raw === "string" ? raw : "";
}

// A stale binding stays visible and clearable rather than silently reading as
// "All": the union keeps whatever the document says even once the trip no longer
// offers it. Same rule for tags and cities.
function withBound(options: readonly string[], bound: unknown): string[] {
  return typeof bound === "string" && bound !== "" && !options.includes(bound)
    ? [...options, bound]
    : [...options];
}

// The option list for one input, as data rather than as JSX — so the phone's
// "Pointed at Day 6 · 2026-04-12" label and the select that sets it read the
// same string from the same array. Building the label a second time in the
// button is how the two start disagreeing.
//
// **The empty option is a real, named choice on every dimension** (ADR-039
// decision 2): "All days", "All cities", "Every stop", "Any kind". It used to
// read "Not set up" on the day select, which was true of the seventeen named
// widgets — `cost.day` with no day WAS unbound — and is a lie about a primitive,
// where an unset day means the whole trip.
export function optionsFor(
  input: WidgetInput,
  params: Record<string, unknown>,
  detail: TripDetail,
  globals: TripGlobals | null,
): readonly { value: string; label: string; group?: string }[] {
  const bound = params[input.name];
  switch (input.type) {
    // Reachable only for a primitive that declares `day` WITHOUT `dates`, which
    // none does today — `collapseDays` hands the whole question to `DaysFilter`
    // otherwise. Kept because `filters.test.ts` pins the every-day-primitive-
    // also-declares-dates property rather than assuming it, and this is the
    // honest fallback if that ever stops being true.
    case "day":
      return [
        { value: "", label: "All days" },
        ...detail.days.map((day, index) => ({
          value: String(index),
          label: day.date ? `Day ${index + 1} · ${day.date}` : `Day ${index + 1}`,
        })),
      ];
    case "city":
      return [
        { value: "", label: "All cities" },
        ...withBound((globals?.cities ?? []).map((c) => c.name), bound).map((name) => ({
          value: name,
          label: name,
        })),
      ];
    case "kind":
      return [
        { value: "", label: "Any kind" },
        // The enum itself, not a list copied here: a sixth `ActivityKind` shows
        // up in this select the day it exists.
        // Labelled as the stop card labels them; a stale value prints as itself.
        ...withBound(ActivityKind.options, bound).map((kind) => ({ value: kind, label: enumLabel(kind) })),
      ];
    case "tags":
      return [
        { value: "", label: "Every stop" },
        // The trip's tags in use, plus whatever this widget is already bound to.
        // `ActivityTag.options` is deliberately NOT the source: a tag no stop
        // carries is a filter that can only find nothing, and offering it is
        // offering an empty result.
        ...withBound((globals?.tags ?? []).map((t) => t.tag as string), bound).map((tag) => ({
          value: tag,
          label: enumLabel(tag),
        })),
      ];
    // The manifest's published fields for `of`, by label and grouped, for
    // `FieldPicker`. **No "All" row**: there is no every-field, so an unset one
    // is a widget with nothing to read (`unbound("field")`), not the widest
    // answer. A stored path the manifest no longer publishes stays visible
    // under a label that says so — never under the path itself (ADR-037 oq4),
    // since it is checked at resolve time and can outlive its field.
    case "field": {
      const choices = fieldChoices(input.of).map((c) => ({ value: c.path, label: c.label, group: c.group }));
      const stale = typeof bound === "string" && bound !== "" && !choices.some((c) => c.value === bound);
      return stale ? [...choices, { value: bound, label: "A field that is no longer offered" }] : choices;
    }
    // No select, so no options: `dates` is `DaysFilter`'s whole control. Before
    // it was named, it fell into a `default:` that offered the TAG list, and so
    // would any input type added later (KI-2026-09-05-h).
    case "dates":
      return [];
    default: {
      // The enforcement, the same as `BlockView`'s: a new `WidgetInput` type
      // fails to compile here until someone decides what its control offers.
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}

// Merge, never replace. With one input the two are indistinguishable; with six,
// replacing means pointing a widget at a tag silently unbinds its day — and the
// widget would then render the whole trip with the day control still showing a
// choice, which is a control contradicting the document.
export function withBinding(
  params: Record<string, unknown>,
  input: WidgetInput,
  next: string,
): Record<string, unknown> {
  const merged = { ...params };
  if (next === "") {
    // Clearing goes back to ALL rather than to a default (ADR-039 decision 2).
    // Deleting the key rather than writing a null keeps `{}` the one spelling
    // of "every member" — which matters because it is also what a widget lands
    // with, and two spellings of the same state is two things to test.
    delete merged[input.name];
  } else {
    merged[input.name] = input.type === "day" ? { kind: "index", index: Number(next) } : next;
  }
  return merged;
}

// A `multiple` field input's stored list, read as `withList` writes it. Anything
// else stored there reads as no columns rather than as a crash.
function listOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

// `withBinding` for a boolean: merge, and off deletes the key, so a widget
// never given the flag and one ticked then unticked are the same `{}`.
function withFlag(params: Record<string, unknown>, key: string, on: boolean): Record<string, unknown> {
  const merged = { ...params };
  if (on) merged[key] = true;
  else delete merged[key];
  return merged;
}

// `withBinding` for a list: merge, and an empty list deletes the key so `{}`
// stays the one spelling of "nothing chosen".
function withList(params: Record<string, unknown>, input: WidgetInput, next: string[]): Record<string, unknown> {
  const merged = { ...params };
  if (next.length === 0) delete merged[input.name];
  else merged[input.name] = next;
  return merged;
}

/**
 * What this widget is showing, as one line — §19's button label.
 *
 * **Only the dimensions that are actually SET**, joined with ` → ` (the
 * separator §19 names), and "everything" when none are. A widget under ADR-039
 * declares up to five controls, so listing every one would give a phone button
 * reading *"All days → All cities → Every stop → Any kind → All dates"* — five
 * words for "everything", on a 44px control. The unset ones are exactly the
 * ones with nothing to say. Except a single `field`: unset, it is "choose a
 * field", because there is no every-field for "everything" to mean.
 *
 * `null` for a widget that declares no filters at all: there is no button to
 * label, and rendering "Showing everything" would be purposeless UI (project
 * rule 2) on the one widget that has no set behind it.
 */
export function bindSummary(
  name: string,
  params: Record<string, unknown>,
  detail: TripDetail,
  globals: TripGlobals | null,
  inputs: readonly WidgetInput[] = bindableInputs(name),
): string | null {
  if (inputs.length === 0) return null;
  // An unset single field is no answer at all rather than the widest one — the
  // widget renders `unbound("field")` whatever else is bound — so the summary
  // says what the widget says. Columns are different: none is a real value.
  if (inputs.some((i) => i.type === "field" && !i.multiple && valueOf(i, params, detail) === "")) {
    return "choose a field";
  }
  const bound = inputs
    .map((input) => {
      if (input.type === "dates") {
        // One entry for the whole "which days" question, reading a stored `day`
        // as well as a range — `DaysFilter` owns both.
        const summary = daysSummary(params, detail);
        return summary === "All days" ? null : summary;
      }
      const value = valueOf(input, params, detail);
      if (value === "") return null;
      return optionsFor(input, params, detail, globals).find((o) => o.value === value)?.label ?? value;
    })
    .filter((label): label is string => label !== null);
  // "everything" rather than "nothing": ADR-039 decision 2, and the difference
  // between a widget waiting to be told what to do and one already showing the
  // widest true answer.
  return bound.length === 0 ? "everything" : bound.join(" → ");
}

/**
 * One control per declared filter.
 *
 * `layout` is the only thing §19 lets differ between surfaces, and it is
 * density, not model:
 *
 * - `inline` — the desktop chrome row. Bare selects, short, labelled only for
 *   screen readers, because the widget's own name pill sits beside them.
 * - `stacked` — the phone bind sheet and the insert step. Visible labels and
 *   44px targets (§13 rule 1, and the sizing note §16 got wrong once); there is
 *   no name pill next to the control here to say what it is for.
 *
 * `inputs` is passed in rather than looked up, because the insert step binds a
 * PRESET and a preset offers only the dimensions its name has not already
 * answered (`presetBindableInputs`).
 *
 * `title` names the controls, and defaults to the widget's own title. The
 * settings panel passes a NUMBERED one when a sentence holds two widgets (§26):
 * "We land in {city} and fly home from {city}" is two widgets both called "The
 * cities", and two controls with one accessible name are one control to a
 * screen reader — the number is what tells them apart for everyone else.
 */
export function WidgetBindControls({
  name,
  params,
  detail,
  globals,
  onChange,
  layout,
  idPrefix,
  inputs = bindableInputs(name),
  title: titleOverride,
}: {
  name: string;
  params: Record<string, unknown>;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  idPrefix: string;
  inputs?: readonly WidgetInput[];
  title?: string;
}) {
  const title = titleOverride ?? getMacro(name)?.title ?? name;
  // A stacked select is otherwise named by its visible `FormField` label alone
  // ("Tags"), which is unique only while the panel holds one widget.
  const namedByTitle = layout === "inline" || titleOverride !== undefined;
  return (
    <>
      {inputs.map((input) => {
        const control =
          input.type === "field" && input.multiple ? (
            // A LIST of fields, one per column (`stop.rows`' `columns`). Each
            // picker reads `optionsFor` as the single one does, so a stale path
            // keeps its "no longer offered" row.
            <FieldColumns
              id={`${idPrefix}-${input.name}`}
              name={(part) => (namedByTitle ? `${title}: ${part}` : part.charAt(0).toUpperCase() + part.slice(1))}
              value={listOf(params[input.name])}
              optionsOf={(path) => optionsFor(input, { [input.name]: path }, detail, globals)}
              onChange={(next) => onChange(withList(params, input, next))}
              layout={layout}
            />
          ) : input.type === "field" ? (
            // Searchable, because a manifest root lists more fields than a
            // select can be read down comfortably, and it grows with every
            // annotation. Same options as the summary line reads.
            <FieldPicker
              id={`${idPrefix}-${input.name}`}
              label={namedByTitle ? `${title}: ${input.label.toLowerCase()}` : undefined}
              options={optionsFor(input, params, detail, globals)}
              value={valueOf(input, params, detail)}
              onChange={(next) => onChange(withBinding(params, input, next))}
              layout={layout}
            />
          ) : input.type === "dates" ? (
            <DaysFilter
              params={params}
              detail={detail}
              onChange={onChange}
              layout={layout}
              id={`${idPrefix}-${input.name}`}
              label={`${title}: ${input.label.toLowerCase()}`}
            />
          ) : (
            <NativeSelect
              id={`${idPrefix}-${input.name}`}
              aria-label={namedByTitle ? `${title}: ${input.label.toLowerCase()}` : undefined}
              className={layout === "inline" ? "h-7 py-0 text-xs" : "min-h-11 w-full"}
              value={valueOf(input, params, detail)}
              onChange={(e) => onChange(withBinding(params, input, e.target.value))}
            >
              {optionsFor(input, params, detail, globals).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          );
        if (layout === "inline") return <span key={input.name}>{control}</span>;
        return (
          <FormField key={input.name} id={`${idPrefix}-${input.name}`} label={input.label}>
            {control}
          </FormField>
        );
      })}
      {/* Not a filter, so not in `inputs`: a param of the widget's own, shown
          only while it changes what the widget prints (`distinctApplies`). A
          field that sums, or no field yet, has no duplicates to remove. */}
      {distinctApplies(name, params) ? (
        <div className={layout === "inline" ? "inline-flex items-center" : "flex min-h-11 items-center"}>
          <CheckboxField
            id={`${idPrefix}-distinct`}
            aria-label={namedByTitle ? `${title}: remove duplicates` : undefined}
            checked={params.distinct === true}
            onCheckedChange={(on) => onChange(withFlag(params, "distinct", on))}
            title="Remove duplicates"
            description={layout === "stacked" ? "List a repeated value once." : undefined}
          />
        </div>
      ) : null}
    </>
  );
}
