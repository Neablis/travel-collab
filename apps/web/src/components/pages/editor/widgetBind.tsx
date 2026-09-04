"use client";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";

// Pointing a widget at its inputs, in ONE place — because as of SPEC §19 there
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
// Nothing here writes to a document. Callers own that: the chrome row writes
// node attrs, the insert sheet builds params for `insertWidget`.

// Which of a widget's declared inputs this app can actually render a control
// for. `person` is declared in §18 and filtered out rather than shown empty:
// nothing links an activity to a person yet, so its control would resolve
// against data that does not exist. No widget declares it today; this keeps
// that true if one lands before the field does.
export function bindableInputs(name: string): readonly WidgetInput[] {
  return (getMacro(name)?.inputs ?? []).filter((i) => i.type === "day" || i.type === "tags");
}

// Reading a param back into a select value, kept beside the writer below so the
// two cannot drift: whatever shape is written is the shape read.
//
// **A `dayId` ref resolves to its current index, and reading only `index` was a
// real bug.** `DayRef` has two shapes and `resolveDayIndex` honours both, so a
// widget bound by `dayId` — what a hand-edited document or an AI insert can
// carry — rendered its day correctly while the control said "Not set up". A
// control contradicting the document it describes is worse than either state
// alone, because the reader believes the control. Found by Copilot on PR 139.
//
// A `dayId` matching no day reads as unset, the same answer `resolveDayIndex`
// gives it: a stale binding is silently no binding, never a guessed one.
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
    return "";
  }
  return typeof raw === "string" ? raw : "";
}

// The tags a person may choose: the trip's tags in use, plus whatever this
// widget is already bound to. Union rather than replacement, so a stale binding
// stays visible and clearable instead of silently reading as "every stop".
function tagOptions(bound: unknown, globals: TripGlobals | null): string[] {
  const inUse = (globals?.tags ?? []).map((t) => t.tag as string);
  return typeof bound === "string" && bound !== "" && !inUse.includes(bound) ? [...inUse, bound] : inUse;
}

// The option list for one input, as data rather than as JSX — so the phone's
// "Pointed at Day 6 · 2026-04-12" label and the select that sets it read the
// same string from the same array. Building the label a second time in the
// button is how the two start disagreeing.
//
// The empty value is a real option in both cases, and it means different things:
// a day binds nothing until you point it (ADR-037 decision 6 — never a default
// day), while an unset tag is the answer "every stop" (§18's table).
export function optionsFor(
  input: WidgetInput,
  params: Record<string, unknown>,
  detail: TripDetail,
  globals: TripGlobals | null,
): readonly { value: string; label: string }[] {
  if (input.type === "day") {
    return [
      { value: "", label: "Not set up" },
      ...detail.days.map((day, index) => ({
        value: String(index),
        label: day.date ? `Day ${index + 1} · ${day.date}` : `Day ${index + 1}`,
      })),
    ];
  }
  return [
    { value: "", label: "Every stop" },
    ...tagOptions(params[input.name], globals).map((tag) => ({ value: tag, label: tag })),
  ];
}

// Merge, never replace. With one input the two are indistinguishable; with two,
// replacing means pointing a widget at a tag silently unbinds its day — and the
// widget would then render "no day set" with the tag control still showing a
// choice, which is a control contradicting the document. `stop.line` is the
// widget that exposes this, and it is why this function exists.
export function withBinding(
  params: Record<string, unknown>,
  input: WidgetInput,
  next: string,
): Record<string, unknown> {
  const merged = { ...params };
  if (next === "") {
    // Clearing goes back to UNBOUND rather than to a default (ADR-037 decision
    // 6: "not common-sense defaults"). Deleting the key rather than writing a
    // null keeps `{}` the one spelling of "not set up".
    delete merged[input.name];
  } else {
    merged[input.name] = input.type === "day" ? { kind: "index", index: Number(next) } : next;
  }
  return merged;
}

/**
 * What this widget is pointed at, as one line — §19's button label.
 *
 * Multi-input widgets join with ` → ` ("Day 4 · … → lodging"), which is the
 * separator §19 names. `null` for a widget that binds nothing: there is no
 * button to label, and rendering "Pointed at nothing" would be purposeless UI
 * (project rule 2) on the one widget that is finished the moment it lands.
 */
export function bindSummary(
  name: string,
  params: Record<string, unknown>,
  detail: TripDetail,
  globals: TripGlobals | null,
): string | null {
  const inputs = bindableInputs(name);
  if (inputs.length === 0) return null;
  return inputs
    .map((input) => {
      const value = valueOf(input, params, detail);
      const option = optionsFor(input, params, detail, globals).find((o) => o.value === value);
      return option?.label ?? "Not set up";
    })
    .join(" → ");
}

/**
 * One control per declared input.
 *
 * `layout` is the only thing §19 lets differ between surfaces, and it is
 * density, not model:
 *
 * - `inline` — the desktop chrome row. Bare selects, short, labelled only for
 *   screen readers, because the widget's own name pill sits beside them.
 * - `stacked` — the phone bind sheet and the insert step. Visible labels and
 *   44px targets (§13 rule 1, and the sizing note §16 got wrong once); there is
 *   no name pill next to the control here to say what it is for.
 */
export function WidgetBindControls({
  name,
  params,
  detail,
  globals,
  onChange,
  layout,
  idPrefix,
}: {
  name: string;
  params: Record<string, unknown>;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  idPrefix: string;
}) {
  const inputs = bindableInputs(name);
  const title = getMacro(name)?.title ?? name;

  return (
    <>
      {inputs.map((input) => {
        const control = (
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
