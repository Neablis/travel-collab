import { z } from "zod";
import { PersonRef, balances, stopPeople, type Balances, type FilterDimension, type TripDetail } from "@tc/contracts";
import type { MacroDef, RepeatPayload, RepeatRow, Seg, WidgetContext, WidgetInput } from "../../registry-types";
import { chip, ghost, inlineOf, rowLabel, rowValue, text } from "../../registry-types";
import { ok, empty, needsTrip, unbound, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow, type SelectedStop } from "../../select";
import { formatMoney } from "../../format";
import { collapseKind } from "../../kinds";
import { renderRows } from "./rows";

// Who owes what (M19 part 2, ADR-060 decision 6) — two widgets over ONE
// function, `balances` in `@tc/contracts`:
//
// - `cost.balances`, "Who owes what": a table of every member's share, what
//   they paid (the stops they are Booked by) and their balance, plus a
//   *not paid yet* line for stops nobody booked.
// - `person.share`, "What one person is in for": the parked `w-person`
//   (notebook-widget catalogue, 2026-09-03) — one member's row of that table,
//   said as a sentence.
//
// Neither re-derives who is in a stop or what it costs: the split is
// `balances`, the stop's people are `stopPeople`, and the stops are `narrow`'s,
// so a balance filtered to Kyoto is over the same stops `cost{city: Kyoto}`
// sums.
//
// **Currency is `cost.chart`'s rule**: only the trip's currency is counted, and
// anything priced in another is named rather than added in (KI-2026-09-24-p).
// A balance of yen and dollars is a wrong balance.
const BALANCE_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];

/** The selection's stops that are priced in the trip's currency, and the rest named. */
function inTripCurrency(trip: TripDetail, stops: readonly SelectedStop[]): { counted: SelectedStop[]; others: string | null } {
  const counted = stops.filter((s) => s.activity.cost?.currency === trip.currency);
  const otherCurrencies = stops.flatMap((s) =>
    s.activity.cost && s.activity.cost.currency !== trip.currency ? [s.activity.cost] : [],
  );
  return { counted, others: collapseKind("money", otherCurrencies, { currency: trip.currency }) };
}

const memberIdsOf = (trip: TripDetail): string[] => trip.members.map((m) => m.userId);

/**
 * What to call each person `ids` names. A member is the name the web handed in
 * (`WidgetContext.people`), or "Traveler N" by their place in the trip while
 * names have not arrived — never the raw id, which is a UUID or a 21-digit
 * number and reads as the page failing (`displayNameFor`'s own rule).
 *
 * Someone who has left the trip but is still a stop's payer or participant is
 * "Former member", numbered when there is more than one so two rows never read
 * as one person.
 */
export function personNames(
  trip: TripDetail,
  people: Readonly<Record<string, string>> | null | undefined,
  ids: readonly string[],
): Map<string, string> {
  const members = memberIdsOf(trip);
  const former = ids.filter((id) => !members.includes(id) && !people?.[id]);
  const names = new Map<string, string>();
  for (const id of ids) {
    const index = members.indexOf(id);
    const named = people?.[id];
    if (named) names.set(id, named);
    else if (index >= 0) names.set(id, `Traveler ${index + 1}`);
    else names.set(id, former.length > 1 ? `Former member ${former.indexOf(id) + 1}` : "Former member");
  }
  return names;
}

/** Where a balance leaves someone: "is owed" $30.00, "owes" $30.00, or "even". */
export interface Standing {
  verb: "is owed" | "owes" | "even";
  amount: string | null;
}

function standingOf(net: number, currency: string): Standing {
  if (net > 0) return { verb: "is owed", amount: formatMoney(net, currency) };
  if (net < 0) return { verb: "owes", amount: formatMoney(-net, currency) };
  return { verb: "even", amount: null };
}

const sayStanding = ({ verb, amount }: Standing) => (amount === null ? verb : `${verb} ${amount}`);

const nothingPriced = (b: Balances) => b.unpaid === 0 && b.perMember.every((m) => m.share === 0 && m.paid === 0);

const BalancesParams = filterParams(BALANCE_FILTERS);
type BalancesParams = z.infer<typeof BalancesParams>;

/**
 * `cost.balances` — "Who owes what".
 *
 * One row per member, in the trip's member order, then anyone who has left but
 * still paid or owes (`balances`' `former`). Columns: what they are in for,
 * what they paid, and where that leaves them. A member in nothing priced still
 * gets a row reading "even", because a table of who owes what that drops a
 * person reads as having forgotten them.
 *
 * Then, when there is any, the **not paid yet** line: the total of the stops
 * nobody is Booked by — owed to the trip rather than to a person, which is why
 * every member's balance can read "owes" with nobody "owed".
 */
export const costBalances: MacroDef<BalancesParams, RepeatPayload> = {
  name: "cost.balances", title: "Who owes what", shape: "repeat",
  params: BalancesParams, inputs: filterInputs(BALANCE_FILTERS),
  selection: { entity: "stop", filters: BALANCE_FILTERS },
  description:
    "Who owes what: each member's share of the selected stops (a stop's price per person, for everyone in it — everyone when nobody is picked), what they paid as the stop's Booked by, and their balance, plus a 'not paid yet' line for stops nobody booked. Trip currency only.",
  emptyText: "nothing priced yet",
  // Fixed, never computed (ADR-037 decision 5).
  preview: "each person's share, what they paid, and who owes what",
  resolve: ({ trip, globals, people }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { counted, others } = inTripCurrency(trip, selection.value.stops);

    const result = balances(counted.map((s) => s.activity), memberIdsOf(trip));
    if (nothingPriced(result)) return others === null ? empty() : empty(`only priced in other currencies: ${others}`);

    const names = personNames(trip, people, result.perMember.map((m) => m.userId));
    const money = (amount: number) => (amount === 0 ? [] : [rowValue(formatMoney(amount, trip.currency))]);
    const rows: RepeatRow[] = result.perMember.map((m) => ({
      lead: { name: "value", text: names.get(m.userId)! },
      cells: [money(m.share), money(m.paid), [rowValue(sayStanding(standingOf(m.net, trip.currency)))]],
    }));
    if (result.unpaid > 0) {
      rows.push({ lead: rowLabel("Not paid yet"), cells: [money(result.unpaid), [], [rowValue("nobody booked it")]] });
    }
    if (others !== null) {
      rows.push({ lead: rowLabel("Not counted"), cells: [[rowValue(`${others} in other currencies`)], [], []] });
    }
    return ok({ kind: "repeat-rows", rows, headings: ["Who", "Share", "Paid", "Balance"] });
  },
  render: renderRows,
};

const ShareParams = filterParams(BALANCE_FILTERS, {
  // A `userId`. Named `who`, not `person`: `person` is the filter DIMENSION,
  // which `narrow` refuses (`select.ts`), and this is the widget's subject —
  // whose share — rather than a narrowing of the stops.
  who: PersonRef.optional(),
});
type ShareParams = z.infer<typeof ShareParams>;

export interface PersonSharePayload {
  name: string;
  /** How many priced stops they are in, as a phrase: "3 stops". */
  stops: string;
  /** Their share, or null when they are in nothing priced. */
  share: string | null;
  /** What they paid, or null when they booked nothing priced. */
  paid: string | null;
  /** Where that leaves them. */
  standing: Standing;
  /** What the selection holds in other currencies, not counted; null when nothing. */
  notCounted: string | null;
}

const PERSON_INPUT: WidgetInput = { name: "who", type: "person", label: "Person" };

// The design's `personBlock`: a name, then their money, as chips in a sentence.
const SHARE_GHOST: readonly Seg[] = [ghost("text", "person"), text(" is in for "), ghost("money", "share")];

/**
 * `person.share` — "What one person is in for" (`w-person`).
 *
 * One member's row of "Who owes what", as a sentence: *"Priya is in for $90.00
 * across 3 stops, has paid $120.00 and is owed $30.00"*. The same `balances`
 * call over the same stops, so the sentence and the table cannot disagree.
 *
 * No person chosen is `unbound("person")` — there is no "everybody" for a
 * sentence about one person, so absent is a blank to fill, not the widest
 * answer.
 */
export const personShare: MacroDef<ShareParams, PersonSharePayload> = {
  name: "person.share", title: "What one person is in for", shape: "single",
  params: ShareParams, inputs: [PERSON_INPUT, ...filterInputs(BALANCE_FILTERS)],
  selection: { entity: "stop", filters: BALANCE_FILTERS },
  description:
    "One person's money as a sentence: what they are in for across the selected stops, what they paid as Booked by, and whether they owe or are owed. `who` is a member's userId. Trip currency only.",
  emptyText: "in nothing priced yet",
  // The design's own preview, phrased generically on purpose (§18).
  preview: "whoever you point it at — their stops, and their share so far",
  resolve: ({ trip, globals, people }: WidgetContext, params, item): MacroResult<PersonSharePayload> => {
    if (!trip) return needsTrip(SHARE_GHOST);
    if (params.who === undefined) return unbound("person", SHARE_GHOST);
    const who = params.who;
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { counted, others } = inTripCurrency(trip, selection.value.stops);

    const memberIds = memberIdsOf(trip);
    const result = balances(counted.map((s) => s.activity), memberIds);
    const mine = result.perMember.find((m) => m.userId === who);
    // Not a member and in nothing: an id from a page written before they left.
    if (!mine) return empty("not on this trip");
    if (mine.share === 0 && mine.paid === 0) {
      return others === null ? empty() : empty(`only priced in other currencies: ${others}`);
    }

    const priced = counted.filter((s) => s.activity.cost!.amountMinor > 0);
    const inStops = priced.filter((s) => stopPeople(s.activity, memberIds).includes(who)).length;
    return ok({
      name: personNames(trip, people, [who]).get(who)!,
      stops: `${inStops} ${inStops === 1 ? "stop" : "stops"}`,
      share: mine.share === 0 ? null : formatMoney(mine.share, trip.currency),
      paid: mine.paid === 0 ? null : formatMoney(mine.paid, trip.currency),
      standing: standingOf(mine.net, trip.currency),
      notCounted: others,
    });
  },
  render: (p) => {
    const segs: Seg[] = [chip("person", p.name)];
    if (p.share === null) segs.push(text(" is in nothing priced"));
    else segs.push(text(" is in for "), chip("value", p.share), text(" across "), chip("value", p.stops));
    if (p.paid !== null) segs.push(text(", has paid "), chip("value", p.paid));
    // "even" is a word, not an amount, so it is text and not a chip.
    if (p.standing.amount === null) segs.push(text(" and is even"));
    else segs.push(text(` and ${p.standing.verb} `), chip("value", p.standing.amount));
    if (p.notCounted !== null) segs.push(text(" — not counting "), chip("value", p.notCounted), text(" in other currencies"));
    return inlineOf(...segs);
  },
};
