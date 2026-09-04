"use client";
import type { TripDetail } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { NativeSelect } from "@/components/ui/native-select";

// The chrome row (M14 link 4 / ADR-037 decision 4) — where a widget is pointed
// at a day after it has been inserted.
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
export function WidgetChrome({
  name,
  params,
  detail,
  onChange,
}: {
  name: string;
  params: Record<string, unknown>;
  detail: TripDetail;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const def = getMacro(name);
  // A widget that binds nothing has nothing to point — it inserted immediately
  // and stays that way (ADR-035 decision 2: `inputs: []` is a real answer).
  const dayInput = def?.inputs.find((i) => i.type === "day");
  if (!dayInput) return null;

  const current = params[dayInput.name] as { kind?: string; index?: number } | undefined;
  const value = current?.kind === "index" && typeof current.index === "number" ? String(current.index) : "";

  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      {/* The name pill. §18 makes it conditional on the widget having a name;
          every widget here has a title, and an itinerary under an authored
          heading is the case that would drop it — link 6's problem, not this
          one's. */}
      <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-pressed">
        {def?.title ?? name}
      </span>
      <NativeSelect
        aria-label={`${def?.title ?? name}: ${dayInput.label.toLowerCase()}`}
        className="h-7 py-0 text-xs"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          // Clearing goes back to UNBOUND rather than to a default day.
          // ADR-037 decision 6: "not common-sense defaults" — a widget pointed
          // at nothing must say so, because silently rendering day 1 is a
          // confident wrong answer nothing on the page would reveal.
          onChange(next === "" ? {} : { [dayInput.name]: { kind: "index", index: Number(next) } });
        }}
      >
        <option value="">Not set up</option>
        {detail.days.map((day, index) => (
          <option key={day.dayId} value={index}>
            {day.date ? `Day ${index + 1} · ${day.date}` : `Day ${index + 1}`}
          </option>
        ))}
      </NativeSelect>
    </span>
  );
}
