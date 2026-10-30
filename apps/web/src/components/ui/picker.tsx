"use client";

import { useId, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { ActivityTagDescribed } from "@tc/contracts";
import { cn } from "@/lib/cn";
import { ACTIVITY_TAG_ICON } from "@/lib/activityTagIcons";
import { TAG_CHIP_CLASS, TAG_LABEL } from "@/lib/activityTags";
import { Button } from "./button";
import { Input } from "./input";
import { Text } from "./text";
import { useRovingRadio } from "./use-roving-radio";

/** One choice in a `Picker`: what it reports, what it says, and an optional line under it. */
export type PickerOption = { id: string; label: string; detail?: string };

/** A place a `place` other's slot committed: a search result's id and the name it showed. */
export type PickedPlace = { id: string; label: string };

/**
 * The constrained *other* a question may offer beside its options (ADR-084
 * §2). Never free text: each kind can only produce a value of its own shape.
 * `label` is the choice that opens it; with no options it is always open and
 * `label` names it instead.
 *
 * - `place` is a slot the caller draws (a place search), handed `commit` for
 *   the result picked — only a picked result is an answer — and the question's
 *   id to name its input by.
 * - `number` is − / + between `min` and `max`, starting at `initial` or `min`.
 * - `date` is a date input inside the box; only a whole day on or after `min`
 *   is an answer.
 * - `tags` is the described activity tags as tiles, any number of them.
 */
export type PickerOther =
  | {
      kind: "place";
      label: string;
      slot: (props: { commit: (place: PickedPlace) => void; labelledBy: string }) => ReactNode;
    }
  | { kind: "number"; label: string; min: number; max: number; initial?: number; unit: { one: string; many: string } }
  | { kind: "date"; label: string; min?: string }
  | { kind: "tags"; label: string };

/** What the chosen *other* holds; `place` and `date` are null until one is picked. */
export type PickerOtherAnswer =
  | { kind: "place"; value: PickedPlace | null }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string | null }
  | { kind: "tags"; value: ActivityTagDescribed[] };

/**
 * An answer, in the shape of ADR-084's `data-ask-answer` minus the ask's id,
 * so the assistant's picker can send it as it stands. `optionIds` are in the
 * options' order. An answer with no ids and no `other` is "none of these";
 * no answer at all is `null`.
 */
export type PickerAnswer = { optionIds: string[]; other: PickerOtherAnswer | null };

const NONE = "none";
const OTHER = "other";
const optionKey = (id: string) => `option:${id}`;

// `ToggleChip`'s tones, not `ToggleChip`: it is an `aria-pressed` button on
// its own tab stop, and these are radios or checkboxes on one roving stop
// carrying a second line. A token fix to one belongs in the other.
const CHOICE =
  "flex min-h-11 flex-col items-start justify-center rounded-md border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";
const choiceTone = (on: boolean) =>
  on ? "border-brand bg-brand-tint text-brand" : "border-border-input bg-surface text-ink hover:border-border-strong";

function freshOther(other: PickerOther): PickerOtherAnswer {
  switch (other.kind) {
    case "place":
      return { kind: "place", value: null };
    case "number":
      return { kind: "number", value: clamp(other.initial ?? other.min, other.min, other.max) };
    case "date":
      return { kind: "date", value: null };
    case "tags":
      return { kind: "tags", value: [] };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// A native date input can fire `change` on a half-typed value in some
// browsers, and `min` only steers its picker (`TripDateControl` records both).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateAnswer = (raw: string, min: string | undefined): string | null =>
  ISO_DATE_RE.test(raw) && (min === undefined || raw >= min) ? raw : null;

/**
 * **One boxed question with a fixed set of answers** — New trip's pages
 * (M56 part 2) and the assistant's `ask_user` (part 5). There is no text box:
 * every answer is an option, "none" or a constrained `other`, so nothing the
 * person gives has to be parsed.
 *
 * Single is a radio group and multi a group of checkboxes, both on
 * `useRovingRadio`'s keyboard: one tab stop, arrows move, Space or Enter picks,
 * Tab leaves. Single's arrows pick as they move, as every radio group here
 * does; multi's only move, since moving must not toggle what it passes over.
 *
 * Controlled, and it owns no submit: the caller decides when an answer is
 * final. `allowNone` adds "None of these", which makes picking nothing an
 * answer rather than a question left unanswered.
 */
export function Picker({
  question,
  options,
  multi = false,
  allowNone = false,
  other,
  value,
  onChange,
}: {
  question: string;
  /** Two to six, or none when `other` is the whole answer. */
  options: readonly PickerOption[];
  multi?: boolean;
  allowNone?: boolean;
  other?: PickerOther;
  value: PickerAnswer | null;
  onChange: (next: PickerAnswer | null) => void;
}) {
  const questionId = useId();
  const ids = value?.optionIds ?? [];
  // With options, the other is one more choice; without, it is the answer.
  const otherIsChoice = other !== undefined && options.length > 0;
  const otherOpen = other !== undefined && (!otherIsChoice || value?.other != null);
  const isNone = value !== null && value.optionIds.length === 0 && value.other === null;

  const choices = [
    ...options.map((o) => ({ key: optionKey(o.id), label: o.label, detail: o.detail, on: ids.includes(o.id) })),
    ...(otherIsChoice ? [{ key: OTHER, label: other.label, detail: undefined, on: value?.other != null }] : []),
    ...(allowNone ? [{ key: NONE, label: "None of these", detail: undefined, on: isNone }] : []),
  ];
  const keys = choices.map((c) => c.key);

  const answer = (optionIds: string[], nextOther: PickerOtherAnswer | null): PickerAnswer | null =>
    multi && optionIds.length === 0 && nextOther === null ? null : { optionIds, other: nextOther };

  const press = (key: string) => {
    if (key === NONE) return onChange({ optionIds: [], other: null });
    if (key === OTHER) {
      const kept = value?.other ?? null;
      if (!multi) return onChange({ optionIds: [], other: kept ?? freshOther(other!) });
      return onChange(answer(ids, kept === null ? freshOther(other!) : null));
    }
    const id = key.slice(optionKey("").length);
    if (!multi) return onChange({ optionIds: [id], other: null });
    // Leaving "none" by picking again: `ids` is already empty then.
    const next = options.filter((o) => (o.id === id) !== ids.includes(o.id)).map((o) => o.id);
    onChange(answer(next, value?.other ?? null));
  };

  // Multi's arrows move a cursor, not the answer, so the hook gets one.
  const [cursor, setCursor] = useState(0);
  const chosenKey = choices.find((c) => c.on)?.key ?? null;
  const radioProps = useRovingRadio(
    keys,
    multi ? (keys[cursor] ?? null) : chosenKey,
    multi ? (key) => setCursor(keys.indexOf(key)) : press,
  );

  const setOther = (next: PickerOtherAnswer | null) =>
    onChange(answer(otherIsChoice ? ids : [], next));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-3">
      <Text id={questionId} className="font-semibold">
        {question}
      </Text>
      {choices.length > 0 && (
        // With no options the choices are "None of these" alone, beside an
        // other that is already the question's group: a second group of the
        // same name would hold one checkbox.
        <div
          role={options.length > 0 ? (multi ? "group" : "radiogroup") : undefined}
          aria-labelledby={options.length > 0 ? questionId : undefined}
          className="flex flex-wrap gap-2"
        >
          {choices.map((choice, i) => (
            <ChoiceButton
              key={choice.key}
              {...radioProps(i)}
              role={multi ? "checkbox" : "radio"}
              label={choice.label}
              detail={choice.detail}
              on={choice.on}
              onClick={() => {
                setCursor(i);
                press(choice.key);
              }}
            />
          ))}
        </div>
      )}
      {otherOpen && other !== undefined && (
        <OtherInput other={other} value={value?.other ?? null} onChange={setOther} questionId={questionId} labelled={!otherIsChoice} />
      )}
    </div>
  );
}

function ChoiceButton({
  label,
  detail,
  on,
  role,
  ...props
}: {
  label: string;
  detail?: string;
  on: boolean;
  role: "radio" | "checkbox";
  ref: (el: HTMLButtonElement | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
  onClick: () => void;
}) {
  const labelId = useId();
  const detailId = useId();
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      aria-labelledby={labelId}
      aria-describedby={detail === undefined ? undefined : detailId}
      className={cn(CHOICE, choiceTone(on))}
      {...props}
    >
      <span id={labelId} className="font-semibold">
        {label}
      </span>
      {detail !== undefined && (
        <span id={detailId} className="text-xs text-slate">
          {detail}
        </span>
      )}
    </button>
  );
}

function OtherInput({
  other,
  value,
  onChange,
  questionId,
  labelled,
}: {
  other: PickerOther;
  value: PickerOtherAnswer | null;
  onChange: (next: PickerOtherAnswer | null) => void;
  questionId: string;
  /** True when the other is the whole answer, so the question names it. */
  labelled: boolean;
}) {
  switch (other.kind) {
    case "place":
      return <div>{other.slot({ commit: (place) => onChange({ kind: "place", value: place }), labelledBy: questionId })}</div>;
    case "number":
      return <NumberStepper other={other} value={value?.kind === "number" ? value.value : null} onChange={onChange} />;
    case "date":
      return (
        <Input
          type="date"
          aria-label={other.label}
          min={other.min}
          value={value?.kind === "date" ? (value.value ?? "") : ""}
          onChange={(e) => onChange({ kind: "date", value: dateAnswer(e.target.value, other.min) })}
        />
      );
    case "tags":
      return (
        <TagTiles
          label={labelled ? undefined : other.label}
          labelledBy={labelled ? questionId : undefined}
          value={value?.kind === "tags" ? value.value : []}
          onChange={(tags) => onChange(tags.length === 0 && labelled ? null : { kind: "tags", value: tags })}
        />
      );
  }
}

function NumberStepper({
  other,
  value,
  onChange,
}: {
  other: Extract<PickerOther, { kind: "number" }>;
  value: number | null;
  onChange: (next: PickerOtherAnswer) => void;
}) {
  const { min, max, unit } = other;
  // A prefilled answer (a length carried from Home) may sit outside the bounds.
  const n = clamp(value ?? other.initial ?? min, min, max);
  const step = (by: number) => {
    const next = clamp(n + by, min, max);
    if (next !== value) onChange({ kind: "number", value: next });
  };
  // `aria-disabled`, not `disabled`, at a bound: a disabled button drops the
  // keyboard focus that just pressed it to the page's body.
  const held = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
  return (
    <div className="flex items-center gap-3">
      <Button
        size="touch"
        variant="secondary"
        className={held}
        aria-label={`Fewer ${unit.many}`}
        aria-disabled={n <= min || undefined}
        onClick={() => step(-1)}
      >
        <Minus className="size-4" aria-hidden />
      </Button>
      <span role="status" className="min-w-16 text-center text-base font-semibold text-ink">
        {n} {n === 1 ? unit.one : unit.many}
      </span>
      <Button
        size="touch"
        variant="secondary"
        className={held}
        aria-label={`More ${unit.many}`}
        aria-disabled={n >= max || undefined}
        onClick={() => step(1)}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/** The described tags as tiles, each in its chip tint and icon; any number, in contract order. */
function TagTiles({
  label,
  labelledBy,
  value,
  onChange,
}: {
  label?: string;
  labelledBy?: string;
  value: readonly ActivityTagDescribed[];
  onChange: (next: ActivityTagDescribed[]) => void;
}) {
  const tags = ActivityTagDescribed.options;
  const [cursor, setCursor] = useState(0);
  const radioProps = useRovingRadio(tags, tags[cursor] ?? null, (tag) => setCursor(tags.indexOf(tag)));
  const toggle = (tag: ActivityTagDescribed) =>
    onChange(tags.filter((t) => (t === tag) !== value.includes(t)));
  return (
    <div role="group" aria-label={label} aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {tags.map((tag, i) => {
        const on = value.includes(tag);
        const Icon = ACTIVITY_TAG_ICON[tag];
        return (
          <button
            key={tag}
            type="button"
            role="checkbox"
            aria-checked={on}
            {...radioProps(i)}
            onClick={() => {
              setCursor(i);
              toggle(tag);
            }}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
              TAG_CHIP_CLASS[tag],
              // The ring, not the tint, says it is picked: every tile is tinted.
              on && "ring-2 ring-brand ring-inset",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {TAG_LABEL[tag]}
          </button>
        );
      })}
    </div>
  );
}
