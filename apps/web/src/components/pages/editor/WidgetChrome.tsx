"use client";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import type { WidgetInput } from "@tc/pages";
import { NativeSelect } from "@/components/ui/native-select";

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
// **It now renders ONE CONTROL PER DECLARED INPUT, and that is not a
// generalisation for its own sake.** The earlier version found the single `day`
// input and served it, which was correct while every bound widget took exactly
// one thing. `stop.line` takes a day AND a tag — the catalogue calls it *"the
// only two-input widget, so it is the one that proves the model"* — and the old
// shape had a defect that only a second input could expose: `onChange` REPLACED
// the whole params object, so setting the tag would have silently discarded the
// day. Merging per key is the fix, and it is why this component had to change
// before that widget could exist.

// Reading a param back into a select value. Kept next to the writer below so
// the two cannot drift: whatever shape is written is the shape read.
function valueOf(input: WidgetInput, params: Record<string, unknown>): string {
  const raw = params[input.name];
  if (input.type === "day") {
    const ref = raw as { kind?: string; index?: number } | undefined;
    return ref?.kind === "index" && typeof ref.index === "number" ? String(ref.index) : "";
  }
  return typeof raw === "string" ? raw : "";
}

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
  const def = getMacro(name);
  // A widget that binds nothing has nothing to point — it inserted immediately
  // and stays that way (ADR-035 decision 2: `inputs: []` is a real answer).
  //
  // `person` is filtered out rather than rendered empty: §18 declares the type
  // and nothing links an activity to a person yet, so a control for it would
  // resolve against data that does not exist. No widget declares it today; this
  // keeps that true if one ever does before the field lands.
  const inputs = (def?.inputs ?? []).filter((i) => i.type === "day" || i.type === "tags");
  if (inputs.length === 0) return null;

  // Merge, never replace. With one input the two are indistinguishable; with
  // two, replacing means pointing a widget at a tag silently unbinds its day —
  // and the widget would then render "no day set" with the tag control still
  // showing a choice, which is a control contradicting the document.
  const set = (input: WidgetInput, next: string) => {
    const merged = { ...params };
    if (next === "") {
      // Clearing goes back to UNBOUND rather than to a default. ADR-037
      // decision 6: "not common-sense defaults" — a widget pointed at nothing
      // must say so, because silently rendering day 1 is a confident wrong
      // answer nothing on the page would reveal. Deleting the key rather than
      // writing a null keeps `{}` the one spelling of "not set up".
      delete merged[input.name];
    } else {
      merged[input.name] = input.type === "day" ? { kind: "index", index: Number(next) } : next;
    }
    onChange(merged);
  };

  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      {/* The name pill. §18 makes it conditional on the widget having a name;
          every widget here has a title, and an itinerary under an authored
          heading is the case that would drop it — link 6's problem, not this
          one's. */}
      <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-pressed">
        {def?.title ?? name}
      </span>
      {inputs.map((input) => (
        <NativeSelect
          key={input.name}
          aria-label={`${def?.title ?? name}: ${input.label.toLowerCase()}`}
          className="h-7 py-0 text-xs"
          value={valueOf(input, params)}
          onChange={(e) => set(input, e.target.value)}
        >
          {input.type === "day" ? (
            <>
              <option value="">Not set up</option>
              {detail.days.map((day, index) => (
                <option key={day.dayId} value={index}>
                  {day.date ? `Day ${index + 1} · ${day.date}` : `Day ${index + 1}`}
                </option>
              ))}
            </>
          ) : (
            <>
              {/* §18's table: a tag input reads "every stop, or one". Unset is
                  therefore a REAL choice with a meaning of its own — every stop
                  — not an unfilled blank, so it is worded as the answer it is
                  rather than as "Not set up". */}
              <option value="">Every stop</option>
              {/* The trip's tags IN USE, from the globals projection, rather
                  than all four `ActivityTag` members. Offering "lodging" on a
                  trip with no lodging stop is a filter whose only outcome is an
                  empty widget. With no globals the list is empty and the
                  control still offers "every stop", which is the honest
                  degradation — the widget works, unfiltered. */}
              {(globals?.tags ?? []).map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag}
                </option>
              ))}
            </>
          )}
        </NativeSelect>
      ))}
    </span>
  );
}
