"use client";
import { ActivityKind, type TripDetail, type TripGlobals } from "@tc/contracts";
import { getMacro, getPreset, presetParams } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

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

// Which of a widget's declared filters this app can render a control for.
//
// **`person` is filtered out, and it is the only one.** ADR-039 decision 7
// declares the dimension and says plainly that it cannot resolve: `TripMember`
// is `{ userId, role }` with no display name, so an option list built today
// would show ids, and no stop carries a person at all, so the filter would have
// nothing to narrow by. A control here would be a choice that changes nothing
// except turning the widget into "needs a person field". The vocabulary exists
// so the shape is settled; the control arrives with M13 `add-stop-who` / M19
// link 3.
export function bindableInputs(name: string): readonly WidgetInput[] {
  return (getMacro(name)?.inputs ?? []).filter((i) => i.type !== "person");
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

/** The controls a preset's bind step offers: its widget's, minus what it fixes. */
export function presetBindableInputs(id: string): readonly WidgetInput[] {
  const preset = getPreset(id);
  if (!preset) return [];
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
/**
 * The value a day select shows for a binding aimed at a day that is gone.
 *
 * **Not `""`, and that was a dead end.** A stale ref read back as "All days",
 * so the control already displayed the option that would fix it — and choosing
 * it fired no change event, leaving the widget stuck on "that day was removed"
 * with no way out but editing the document by hand (Copilot, PR 141). A
 * distinct value gives the select something to move AWAY from.
 *
 * It is never written: `withBinding` treats it as a no-op, so the only thing a
 * reader can do from here is pick a real day or All.
 */
export const STALE_DAY_VALUE = "__stale-day";

export function valueOf(
  input: WidgetInput,
  params: Record<string, unknown>,
  detail: TripDetail,
): string {
  const raw = params[input.name];
  if (input.type === "day") {
    const ref = raw as { kind?: string; index?: number; dayId?: string } | undefined;
    if (ref?.kind === "index" && typeof ref.index === "number") {
      return ref.index < detail.days.length ? String(ref.index) : STALE_DAY_VALUE;
    }
    if (ref?.kind === "dayId" && typeof ref.dayId === "string") {
      const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
      return idx === -1 ? STALE_DAY_VALUE : String(idx);
    }
    // No ref at all is the real "All days", and the one that means every day.
    return "";
  }
  return typeof raw === "string" ? raw : "";
}

/** A bound date range, or two empty strings. Both ends are separate controls. */
export function dateRangeOf(
  input: WidgetInput,
  params: Record<string, unknown>,
): { from: string; through: string } {
  const raw = params[input.name] as { from?: unknown; through?: unknown } | undefined;
  return {
    from: typeof raw?.from === "string" ? raw.from : "",
    through: typeof raw?.through === "string" ? raw.through : "",
  };
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
): readonly { value: string; label: string }[] {
  const bound = params[input.name];
  switch (input.type) {
    case "day": {
      const days = [
        { value: "", label: "All days" },
        ...detail.days.map((day, index) => ({
          value: String(index),
          label: day.date ? `Day ${index + 1} · ${day.date}` : `Day ${index + 1}`,
        })),
      ];
      // A binding aimed at a deleted day gets its own option, selected, so the
      // control tells the same story the widget does ("that day was removed")
      // and picking All is a change the select actually reports.
      return valueOf(input, params, detail) === STALE_DAY_VALUE
        ? [...days, { value: STALE_DAY_VALUE, label: "The day this pointed at (removed)" }]
        : days;
    }
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
        ...withBound(ActivityKind.options, bound).map((kind) => ({ value: kind, label: kind })),
      ];
    default:
      return [
        { value: "", label: "Every stop" },
        // The trip's tags in use, plus whatever this widget is already bound to.
        // `ActivityTag.options` is deliberately NOT the source: a tag no stop
        // carries is a filter that can only find nothing, and offering it is
        // offering an empty result.
        ...withBound((globals?.tags ?? []).map((t) => t.tag as string), bound).map((tag) => ({
          value: tag,
          label: tag,
        })),
      ];
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
  // Re-picking the stale option changes nothing, so it writes nothing. It is
  // there to be moved away from, not chosen.
  if (next === STALE_DAY_VALUE) return merged;
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

/**
 * Write one end of a date range.
 *
 * A range needs both ends before it is a range, so a half-filled control leaves
 * the filter ABSENT — which is "all dates", the honest reading of "the author
 * has not finished choosing". Writing `{ from, through: "" }` would be a
 * `DateRangeRef` the contract refuses, and the widget would render bad-params
 * mid-typing.
 *
 * A single date is `from === through`, which is what the spec's *"All · a single
 * date · a range"* means with one control shape instead of two: type the same
 * date twice, or set one end and the range collapses to it.
 */
export function withDateRange(
  params: Record<string, unknown>,
  input: WidgetInput,
  end: "from" | "through",
  next: string,
): Record<string, unknown> {
  const merged = { ...params };
  const current = dateRangeOf(input, params);

  // **Clearing either end clears the filter.** A range with one end is not a
  // range, and the completion rule below would otherwise refill the box the
  // reader just emptied from the box they left alone — so a date filter, once
  // set, could never be taken off again except by editing the document. That is
  // the same dead end the stale day select had, in the other control.
  if (next === "") {
    delete merged[input.name];
    return merged;
  }

  const from = end === "from" ? next : current.from;
  const through = end === "through" ? next : current.through;
  // **One end typed means that single date; two ends typed mean exactly what
  // was typed.** Completing an EMPTY other end is not the same as
  // reinterpreting a filled one, and this used to `.sort()` both — so setting
  // `from` to a date after `through` silently rewrote the author's input into
  // the range they did not ask for (Copilot, PR 141). A genuinely reversed pair
  // is written as given and refused by `DateRangeRef`, which is the contract's
  // own stated intent: *"a reversed range is a mistake somebody made, and
  // quietly reinterpreting it is how a widget shows a confident wrong answer."*
  merged[input.name] = { from: from || through, through: through || from };
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
 * ones with nothing to say.
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
  const bound = inputs
    .map((input) => {
      if (input.type === "dates") {
        const { from, through } = dateRangeOf(input, params);
        if (from === "") return null;
        return from === through ? from : `${from} – ${through}`;
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
}: {
  name: string;
  params: Record<string, unknown>;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  idPrefix: string;
  inputs?: readonly WidgetInput[];
}) {
  const title = getMacro(name)?.title ?? name;

  return (
    <>
      {inputs.map((input) => {
        const control =
          input.type === "dates" ? (
            <DateRangeControl
              input={input}
              params={params}
              onChange={onChange}
              layout={layout}
              id={`${idPrefix}-${input.name}`}
              label={`${title}: ${input.label.toLowerCase()}`}
            />
          ) : (
            <NativeSelect
              id={`${idPrefix}-${input.name}`}
              aria-label={layout === "inline" ? `${title}: ${input.label.toLowerCase()}` : undefined}
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
    </>
  );
}

// The one dimension that is not a select. Two native date inputs, because a
// range is two dates and the platform already has a date picker that works on a
// phone — a custom calendar would be a new widget to maintain for a filter
// nothing in the preset table uses yet.
//
// Both ends carry their own accessible name: "Dates: from" and "Dates: through"
// read as two controls, which is what they are, where a shared label would leave
// a screen-reader user with two identically-named boxes.
function DateRangeControl({
  input,
  params,
  onChange,
  layout,
  id,
  label,
}: {
  input: WidgetInput;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  id: string;
  label: string;
}) {
  const { from, through } = dateRangeOf(input, params);
  const size = layout === "inline" ? "h-7 py-0 text-xs" : "min-h-11 w-full";
  // A range typed back-to-front is written as given and refused by
  // `DateRangeRef`, so the widget beside this renders its bad-params state.
  // Saying which control is wrong is the other half of not silently fixing it:
  // a refusal the reader cannot locate is barely better than a rewrite.
  const reversed = from !== "" && through !== "" && from > through;
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        id={id}
        type="date"
        aria-label={`${label} from`}
        aria-invalid={reversed || undefined}
        className={size}
        value={from}
        onChange={(e) => onChange(withDateRange(params, input, "from", e.target.value))}
      />
      <Input
        type="date"
        aria-label={`${label} through`}
        aria-invalid={reversed || undefined}
        className={size}
        value={through}
        onChange={(e) => onChange(withDateRange(params, input, "through", e.target.value))}
      />
    </span>
  );
}
