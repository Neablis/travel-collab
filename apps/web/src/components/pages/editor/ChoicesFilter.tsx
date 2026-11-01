"use client";
import type { WidgetInput } from "@tc/pages";
import { CheckboxField } from "@/components/ui/checkbox";

// **Several picked from a short closed list** — `open`'s row classes (M43
// decision 5), beside `DaysFilter` in the same settings column and bind sheet.
// A box per option rather than a select: the answer is a set, and three
// short labels read at a glance where a multi-select hides what is picked.
//
// Every box starts ticked, because absent is every option (ADR-039 decision 2),
// and the last ticked one cannot be cleared: hiding every row is not a filter
// anybody means, and the stored list is never empty (`ChoicesRef`). That box
// is `aria-disabled`, not `disabled`, and described by the line saying so: a
// disabled one leaves the tab order and is read as "dimmed" with no reason.

type ChoicesInput = Extract<WidgetInput, { type: "choices" }>;

/**
 * The values a stored list picks, in `options` order. Absent is every option,
 * and so is a list naming none of them: read leniently, as `DaysFilter` reads
 * a range, since the page's write check is where a bad value is refused.
 */
export function pickedChoices(input: ChoicesInput, raw: unknown): readonly string[] {
  const all = input.options.map((option) => option.value);
  if (!Array.isArray(raw)) return all;
  const picked = all.filter((value) => raw.includes(value));
  return picked.length === 0 ? all : picked;
}

/**
 * `params` with `picked` stored as the widget's schema spells it: in `options`
 * order, and no key at all for every option, so a widget left alone and one
 * switched away and back are the same `{}`.
 */
export function withChoices(
  params: Record<string, unknown>,
  input: ChoicesInput,
  picked: ReadonlySet<string>,
): Record<string, unknown> {
  const merged = { ...params };
  const list = input.options.map((option) => option.value).filter((value) => picked.has(value));
  if (list.length === input.options.length) delete merged[input.name];
  else merged[input.name] = list;
  return merged;
}

export function ChoicesFilter({
  input,
  params,
  onChange,
  layout,
  id,
  name,
}: {
  input: ChoicesInput;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  id: string;
  /** The group's accessible name when the visible label alone would not be unique (`WidgetBindControls`). */
  name?: string;
}) {
  const picked = pickedChoices(input, params[input.name]);
  const lastId = `${id}-last`;
  return (
    <fieldset
      id={id}
      aria-label={name}
      className={layout === "inline" ? "inline-flex items-center gap-3 border-0 p-0" : "flex flex-col gap-1.5 border-0 p-0"}
    >
      <legend className={layout === "inline" ? "sr-only" : "mb-1.5 text-sm font-medium text-slate"}>{input.label}</legend>
      {input.options.map((option) => {
        const on = picked.includes(option.value);
        const last = on && picked.length === 1;
        return (
          <div key={option.value} className={layout === "inline" ? "inline-flex items-center" : "flex min-h-11 items-center"}>
            <CheckboxField
              id={`${id}-${option.value}`}
              checked={on}
              aria-disabled={last || undefined}
              aria-describedby={last ? lastId : undefined}
              onCheckedChange={(next) => {
                if (last) return;
                const set = new Set(picked);
                if (next) set.add(option.value);
                else set.delete(option.value);
                onChange(withChoices(params, input, set));
              }}
              title={option.label}
            />
          </div>
        );
      })}
      {picked.length === 1 && (
        <span id={lastId} className={layout === "inline" ? "sr-only" : "text-xs text-slate"}>
          At least one stays shown
        </span>
      )}
    </fieldset>
  );
}
