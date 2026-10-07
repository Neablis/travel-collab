import { z } from "zod";
import { travellerIds, type TripDetail } from "@tc/contracts";
import type { MacroDef, TripPeoplePayload, TripPeoplePerson, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { personNames } from "./balances";

// `trip.people` — "Who's going" (M38, canvas artboard 5). A stack of chips and
// one sentence: *"Sam, Priya, Kenji and Mei are going with Dana."*
//
// **Not `person.share`.** That widget is one person's money in a sentence, and
// with the money taken out (D4, for the invite page) nothing is left of it. This
// one divides nothing, which is what lets the invite page and a notebook draw
// the same widget (D6).
//
// **A registered widget, not a primitive**, for `trip.strip`'s reason: it has
// no entity to narrow. Some of the people going is not who is going.
//
// **No chip here** (ADR-037 decision 1): the payload carries each person's
// avatar and colour as keys, and `apps/web` draws them (`TripPeopleBlock`).

const TripPeopleParams = z.object({});
type TripPeopleParams = z.infer<typeof TripPeopleParams>;

/** How many chips the stack draws before the sentence counts the rest (the canvas's four). */
const STACK = 4;

interface Member extends TripPeoplePerson {
  /** What the sentence calls them: a real name's first word, a placeholder whole. */
  short: string;
  going: boolean;
}

/**
 * Every member, in the trip's order, as the sentence and the chips need them.
 *
 * A persona is the word on how a member looks and whether they are going —
 * see `WidgetContext.personas` for why `travelling` is read there and not off
 * `trip.members`. A member it does not hold yet is named as every person
 * widget names one (`personNames`) and counted by `travellerIds`.
 */
function membersOf({ trip, people, personas }: WidgetContext & { trip: TripDetail }): Member[] {
  const ids = trip.members.map((m) => m.userId);
  const fallback = personNames(trip, people, ids);
  const travelling = new Set(travellerIds(trip.members));
  return ids.map((id) => {
    const persona = personas?.[id];
    const real = persona?.name ?? people?.[id];
    const name = real ?? fallback.get(id)!;
    return {
      name,
      avatar: persona?.avatar ?? null,
      color: persona?.color ?? null,
      // "Traveler 2" is a placeholder, and its first word is not a name.
      short: real === undefined ? name : firstWord(real),
      going: persona ? persona.travelling : travelling.has(id),
    };
  });
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Sam", "Sam and Priya", "Sam, Priya and Kenji", "Sam, Priya, Kenji and 2 others". */
function listOf(names: readonly string[]): string {
  if (names.length > STACK) {
    const rest = names.length - (STACK - 1);
    return `${names.slice(0, STACK - 1).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  }
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const chipOf = ({ name, avatar, color }: Member): TripPeoplePerson => ({ name, avatar, color });

export const tripPeopleWidget: MacroDef<TripPeopleParams, TripPeoplePayload> = {
  name: "trip.people",
  title: "Who's going",
  shape: "block",
  params: TripPeopleParams,
  inputs: [],
  selection: undefined,
  description:
    "Who is travelling on the trip: a stack of their chips, then their names in a sentence that ends with the trip's owner. People only helping plan are left out.",
  emptyText: "nobody is going yet",
  // Fixed, never computed (ADR-037 decision 5): nobody named.
  preview: "everyone going, as chips and their names in a sentence",
  resolve: (ctx: WidgetContext, _params): MacroResult<TripPeoplePayload> => {
    const { trip } = ctx;
    if (!trip) return needsTrip();
    const members = membersOf({ ...ctx, trip });
    // The owner is who the others go WITH; the contract does not promise they
    // are listed first, so they are found by role.
    const ownerId = trip.members.find((m) => m.role === "owner")?.userId ?? trip.members[0]?.userId;
    const owner = members[trip.members.findIndex((m) => m.userId === ownerId)];
    const others = members.filter((m) => m !== owner && m.going);
    if (others.length === 0) {
      if (!owner?.going) return empty();
      return ok({ kind: "trip-people", stack: [chipOf(owner)], sentence: `${owner.short} is going.` });
    }
    const verb = others.length === 1 ? "is" : "are";
    const sentence = `${listOf(others.map((m) => m.short))} ${verb} going${owner?.going ? ` with ${owner.short}` : ""}.`;
    return ok({ kind: "trip-people", stack: others.slice(0, STACK).map(chipOf), sentence });
  },
  render: blockOf,
};
