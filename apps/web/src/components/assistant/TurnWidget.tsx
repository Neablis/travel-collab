"use client";

import { useState } from "react";
import Link from "next/link";
import type { AskAnswer, AssistantAsk, AssistantHandOff, AssistantOptions, HandOffTo } from "@tc/contracts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Picker, type PickerAnswer, type PickerOther } from "@/components/ui/picker";
import { PlaceSearch } from "@/components/places/PlaceSearch";
import { runPaletteCommand } from "@/components/palette/paletteRegistry";
import { TAG_LABEL } from "@/lib/activityTags";
import { NEW_TRIP_PATH } from "@/lib/homePath";

/** The widget a turn ended in (ADR-084 §2): a question, cards, or a hand-off. */
export type TurnWidgetState =
  | { kind: "ask"; ask: AssistantAsk }
  | { kind: "options"; options: AssistantOptions }
  | { kind: "handOff"; handOff: AssistantHandOff };

/** Sends an answer: the words the person's turn shows, and the answer as data. */
export type OnAnswer = (text: string, answer: AskAnswer) => void;

/**
 * The turn's widget, under its answer. `answered` is a later turn already
 * answering it, so the question stays readable and can no longer be sent;
 * without `onAnswer` (a picture of a conversation) nothing is sendable either.
 * `busy` is a turn in flight: its buttons wait, since a second turn started
 * now would orphan the first.
 */
export function TurnWidget({
  widget,
  answered,
  busy = false,
  onAnswer,
}: {
  widget: TurnWidgetState;
  answered: boolean;
  busy?: boolean;
  onAnswer?: OnAnswer;
}) {
  const live = !answered && onAnswer !== undefined;
  switch (widget.kind) {
    case "ask":
      return <AskPicker ask={widget.ask} busy={busy} {...(live && { onAnswer })} />;
    case "options":
      return <OptionCards options={widget.options} busy={busy} {...(live && { onAnswer })} />;
    case "handOff":
      return <HandOffCard handOff={widget.handOff} />;
  }
}

/** The *other* a question offers, as the picker draws it. A place is chosen from the library's own search. */
function pickerOther(other: AssistantAsk["other"]): PickerOther | undefined {
  if (other === undefined) return undefined;
  if (other.kind !== "place") return other;
  return {
    kind: "place",
    label: other.label,
    slot: ({ commit }) => (
      <PlaceSearch
        selected={{ cities: [], countries: [] }}
        onAdd={(pick) =>
          commit(pick.kind === "city" ? { id: `city:${pick.city}`, label: pick.city } : { id: `country:${pick.countryCode}`, label: pick.countryCode })
        }
        onRemove={() => {}}
      />
    ),
  };
}

/** What the person's turn says for an answer: the labels they picked, and the other's value. */
function answerWords(ask: AssistantAsk, value: PickerAnswer): string {
  const labels = ask.options.filter((option) => value.optionIds.includes(option.id)).map((option) => option.label);
  const other = value.other;
  if (other !== null) {
    if (other.kind === "place" && other.value !== null) labels.push(other.value.label);
    if (other.kind === "number") labels.push(String(other.value));
    if (other.kind === "date" && other.value !== null) labels.push(other.value);
    if (other.kind === "tags") labels.push(...other.value.map((tag) => TAG_LABEL[tag]));
  }
  return labels.length === 0 ? "None of these" : labels.join(", ");
}

/** The picker's answer as the contract's: an *other* still waiting for its place or date is no answer yet. */
function asAnswer(ask: AssistantAsk, value: PickerAnswer | null): AskAnswer | null {
  if (value === null) return null;
  const other = value.other;
  if (other === null) return { answeredAsk: ask.id, optionIds: value.optionIds, other: null };
  if (other.kind === "place" || other.kind === "date") {
    if (other.value === null) return null;
    return other.kind === "place"
      ? { answeredAsk: ask.id, optionIds: value.optionIds, other: { kind: "place", value: other.value } }
      : { answeredAsk: ask.id, optionIds: value.optionIds, other: { kind: "date", value: other.value } };
  }
  return { answeredAsk: ask.id, optionIds: value.optionIds, other };
}

function AskPicker({ ask, busy, onAnswer }: { ask: AssistantAsk; busy: boolean; onAnswer?: OnAnswer }) {
  const [value, setValue] = useState<PickerAnswer | null>(null);
  const other = pickerOther(ask.other);
  const answer = asAnswer(ask, value);
  return (
    <div className="flex flex-col gap-2">
      {/* A question no longer sendable takes no clicks or keys either: the
          fieldset disables every control the picker draws. */}
      <fieldset disabled={onAnswer === undefined} className="m-0 min-w-0 border-0 p-0">
        <Picker
          question={ask.question}
          options={ask.options}
          multi={ask.multi}
          allowNone={ask.allowNone}
          {...(other !== undefined && { other })}
          value={value}
          onChange={setValue}
        />
      </fieldset>
      {onAnswer !== undefined && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="self-start"
          disabled={busy || answer === null}
          onClick={() => answer !== null && value !== null && onAnswer(answerWords(ask, value), { ...answer, question: ask.question })}
        >
          Answer
        </Button>
      )}
    </div>
  );
}

function OptionCards({ options, busy, onAnswer }: { options: AssistantOptions; busy: boolean; onAnswer?: OnAnswer }) {
  return (
    <ul aria-label={options.prompt} className="flex flex-col gap-2">
      {options.cards.map((card) => (
        <li key={card.id} className="flex items-center justify-between gap-3 rounded-md border border-hairline px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-ink">{card.name}</span>
            <span className="text-xs text-slate">
              {card.kind === "place"
                ? [card.area, card.city].filter(Boolean).join(", ")
                : `${card.cities.join(", ")}${card.cities.length > 0 ? " · " : ""}${card.stopCount} stop${card.stopCount === 1 ? "" : "s"}`}
            </span>
          </span>
          {onAnswer !== undefined && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Choose ${card.name}`}
              disabled={busy}
              onClick={() => onAnswer(card.name, { answeredAsk: options.id, question: options.prompt, optionIds: [card.id], other: null })}
            >
              Choose
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Where each target is, in a sentence, and its button. Nowhere has none. */
const HAND_OFF_COPY: Readonly<Record<HandOffTo, { says: string; button: string | null }>> = {
  new_trip: { says: "This starts as a new trip.", button: "Start a new trip" },
  plan_page: { says: "This is done on the trip's plan.", button: "Open the plan" },
  upgrade: { says: "Changes come with a plan that includes them.", button: "See plans" },
  nowhere: { says: "This isn't something this app can do.", button: null },
};

/**
 * A decline with a way forward. Each button is a person pressing it, through
 * the page's own command or link. New trip is the palette's `new-trip` where
 * this page has one (Home), and otherwise a link to Home that opens it there.
 */
function HandOffCard({ handOff }: { handOff: AssistantHandOff }) {
  const { says, button } = HAND_OFF_COPY[handOff.to];
  // The plan page's command exists once the palette has read the trips, and
  // only for one it lists: when it is not there, say so rather than nothing.
  const [unopened, setUnopened] = useState(false);
  const command = handOff.to === "plan_page" ? handOff.command : undefined;
  return (
    <div role="group" aria-label="Where this is done" className="flex flex-col items-start gap-2">
      <p className="text-sm text-a-asst-ink">{says}</p>
      {button !== null &&
        (handOff.to === "upgrade" ? (
          <Link href="/plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            {button}
          </Link>
        ) : handOff.to === "new_trip" ? (
          <Link
            href={NEW_TRIP_PATH}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            onClick={(event) => {
              if (runPaletteCommand("new-trip")) event.preventDefault();
            }}
          >
            {button}
          </Link>
        ) : command === undefined ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setUnopened(!runPaletteCommand(command))}>
            {button}
          </Button>
        ))}
      {/* In place before the press and filled by it, so a screen reader, whose
          focus stays on the button, is told. Pulled up by the gap while empty
          rather than hidden: a display:none region is not in place. */}
      {command !== undefined && (
        <p role="status" className="text-sm text-a-asst-ink empty:-mt-2">
          {unopened ? "I couldn't open that trip from this page." : null}
        </p>
      )}
    </div>
  );
}
