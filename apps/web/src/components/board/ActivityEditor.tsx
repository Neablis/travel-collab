"use client";

import { useEffect, useRef, useState } from "react";
import { travellerIds, type ActivityKind, type ActivityMode, type ActivityTag, type ActivityView, type Anchor, type AvatarKey, type DistanceUnit, type Location, type Money, type NearbyStop, type PendingReason, type PersonColor, type TimeWindow } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonChip } from "@/components/ui/person-chip";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner } from "@/components/ui/banner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { stopTotalLine } from "@/lib/cost";
import { formatDuration, toClockRange, toEndMinutes, toMinutes, toTimeString } from "@/lib/time";
import { useDistanceUnit, useTimeFormat } from "@/components/account/PreferencesProvider";
import { displayPlace } from "@/lib/place";
import { kmLabel } from "@/lib/units";
import type { Slot } from "@/components/trip/fitIntoDay";
import {
  closestDurationLabel,
  DEFAULT_DURATION_LABEL,
  DURATION_OPTIONS,
  durationMinutes,
  type DurationLabel,
} from "./activityDuration";
import { KIND_LABEL, KIND_OPTIONS } from "./activityKind";
import { TAG_GROUPS, TAG_LABEL, toggleTag } from "@/lib/activityTags";
import { LocationInput } from "./LocationInput";
import { MoneyInput } from "./MoneyInput";
import { PendingReasonPicker } from "./PendingReasonPicker";
import { TravelModePicker } from "./TravelModePicker";

export type ActivityFormValue = {
  title: string;
  dayId: string | null;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
  kind: ActivityKind;
  tags: ActivityTag[];
  cost: Money | null;
  // M13 link 5. Two relations, not one (Mitchell, 2026-09-03): who BOOKED a
  // stop is not who is GOING to it, and M19's splits need the participants.
  bookedBy: string | null;
  participants: string[];
  // M24. Only ever non-null while `kind` is "transit": the form clears both on
  // save otherwise, because the decider refuses a leg on any other kind.
  mode: ActivityMode | null;
  endLocation: Location | null;
  // ADR-055. Only ever non-null while `kind` is "pending", for the same reason.
  pendingReason: PendingReason | null;
  // M52. Only ever non-null on a flight leg: the field is asked for there alone.
  flightNumber: string | null;
};

// One option per trip day for the "Day" NativeSelect, plus that day's
// already-scheduled windows (excluding whatever activity is being edited) —
// the availability Banner below feeds these straight into fitIntoDay.
// One line under the Kind control saying what the chosen kind means — the
// handoff's `kindHelp`. Exhaustive, so a fourth kind needs a sentence.
const KIND_HELP: Record<ActivityKind, string> = {
  planned: "You intend to do it",
  pending: "Not locked in yet",
  transit: "Moving between the stops either side",
};

/**
 * A trip member as the attribution controls show them: the id is the value,
 * `name` the label. `travelling` is `TripMember`'s, absent meaning travelling
 * (travellers spec D2). `avatar` and `color` are what their chip draws (M38),
 * absent until the trip's personas land — the chip is then their initials.
 */
export type NamedMember = {
  userId: string;
  name: string;
  travelling?: boolean;
  avatar?: AvatarKey | null;
  color?: PersonColor | null;
};

/**
 * A trip guest as the attribution controls show them (guests spec P1): the
 * `guest_<uuid>` id is the value, `name` the label. A guest has no account,
 * so there is no avatar or colour — the chip draws their initials, and the
 * badge says what they are. `linkedUserId` is who claimed the record, or
 * null; a claimed guest counts as their member wherever heads are counted
 * (`travellerIds`'s dedup), while picks always name the `guestId`.
 */
export type NamedGuest = Pick<NamedMember, "name" | "travelling"> & {
  guestId: string;
  linkedUserId: string | null;
};

export type ActivityDayOption = { dayId: string; label: string; existing: Slot[] };

/** The "How long" value for a length drawn on the river that is none of the five. */
const DRAWN = "drawn";

/** A "How long" option that is none of the five: a length drawn on the river, or a picked stop's (M34 D11). */
type ExtraDuration = { label: string; minutes: number };

function extraDuration(minutes: number | null): ExtraDuration | null {
  return minutes !== null && minutes > 0 && !DURATION_OPTIONS.some((o) => o.minutes === minutes)
    ? { label: formatDuration(minutes, "").trim(), minutes }
    : null;
}

// M34 D3: before typing, the closest few; while typing, a few more of those
// that match, since the text has already done some of the choosing.
const NEARBY_BEFORE_TYPING = 4;
const NEARBY_WHILE_TYPING = 6;

// Case- and accent-insensitive, so "kiyomizu" finds "Kiyomizu-dera" and
// "cafe" finds "Café de Flore": a library written by other people spells
// names their way, not the reader's.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function nearbyStopsFor(stops: readonly NearbyStop[], typed: string): NearbyStop[] {
  const needle = fold(typed.trim());
  if (needle === "") return stops.slice(0, NEARBY_BEFORE_TYPING);
  return stops
    .filter((stop) => fold(stop.title).includes(needle) || fold(stop.location.name).includes(needle))
    .slice(0, NEARBY_WHILE_TYPING);
}

// Illustrative only (Preview id="add-stop-who", M13 — no field records who a
// stop is for yet, so there is nothing real to list per-stop).
// M13 link 5 replaced the `add-stop-who` Preview placeholder that stood here
// (a single hardcoded "Everyone" chip) with the real control below.

export function ActivityEditor({
  initial,
  mode,
  days,
  defaultDayId,
  tripCurrency = "USD",
  members = [],
  guests = [],
  guestNames,
  guestsLoaded = true,
  nearbyStops = [],
  onSave,
  onCancel,
  onRemove,
}: {
  initial: ActivityView | null;
  mode: "create" | "edit";
  days: ActivityDayOption[];
  // The day to preselect: a create-mode prefill's dayId, or (edit mode) the
  // day that already lists this activity. Left undefined when neither
  // applies (a MapLens create-by-coordinate, or a backlog activity) — the
  // selection then falls back to "no day" rather than guessing one.
  defaultDayId?: string;
  tripCurrency?: string;
  /**
   * The trip's members, as the only options this form offers for attribution
   * (M13 link 5). Defaulted to `[]` so every existing caller and test keeps
   * working: with no members there is nobody to attribute to, and the section
   * renders a plain "nobody else is on this trip yet" rather than an empty
   * control that looks broken.
   *
   * Named by the caller, because `TripMember` carries no name and Booked by
   * decides who is owed money (ADR-060 decision 6): a toggle reading a UUID
   * cannot be picked correctly. The sheet names them through `personNames`,
   * the rule the notebook's balances use, so the two never disagree.
   */
  members?: NamedMember[];
  /**
   * The trip's guests (guests spec P1), offered beside the members above.
   * Defaulted to `[]` like `members`, for the same reason: a caller that
   * fetches none sees the form exactly as it was. A claimed guest counts as
   * their member in the headcount (`travellerIds`'s dedup), but picks always
   * name the `guestId` — the id the cost path prices.
   */
  guests?: NamedGuest[];
  /**
   * Names the picker has seen for guests, including ones since removed. A
   * picked guest who was removed shows under their name when it is known,
   * and under "Former member" when it is not — the sheet keeps every name
   * its guest reads ever saw, because a removed guest's record is gone.
   */
  guestNames?: ReadonlyMap<string, string>;
  /**
   * Whether the `guests` list has answered yet. The sheet fetches guests
   * after it opens, so a picked guest is briefly absent from `guests` without
   * having left: until this is true, a `guest_*` id is never labelled
   * departed. Defaults to true — a caller that hands the list over directly
   * has answered by construction.
   */
  guestsLoaded?: boolean;
  /**
   * Stops from other people's published days, ranked for this day (M34).
   * Create mode only (D12); defaulted to `[]`, which renders nothing at all,
   * so a caller that fetches none sees the form exactly as it was.
   */
  nearbyStops?: readonly NearbyStop[];
  /** `stay` is an autosave: persist, but leave the sheet open. */
  onSave: (value: ActivityFormValue, options?: { stay?: boolean }) => void | Promise<void>;
  onCancel: () => void;
  /** Edit mode's *Remove*; absent, the footer offers none (create mode). */
  onRemove?: () => void;
}) {
  const clock = useTimeFormat();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.timeWindow?.start ?? "");
  // Edit mode only: a stop being edited already has an end time, and forcing
  // it back through the duration dropdown would lose precision (Task 7.1).
  const [end, setEnd] = useState(initial?.timeWindow?.end ?? "");
  // **A length drawn on the river is kept as drawn** (M29 part 3). A stop
  // sketched across 9:00–11:15 arrives here as a prefilled window whose 135
  // minutes are none of the five "How long" options; rounding it to the
  // nearest one (the design's own answer) would save a stop that is not the
  // one just drawn. So a create-mode prefill that matches no option adds one
  // more, named for its length and chosen, and the other five stay offered.
  // The end is read with `toEndMinutes`: a sketch to midnight is stored ending
  // 23:59, and is the 2 hours that were drawn, not 1 h 59 m.
  //
  // Held in state rather than derived from `initial`, because a picked nearby
  // stop's length is kept the same way (M34 D11), and replaces it.
  const [drawnOption, setDrawnOption] = useState<ExtraDuration | null>(() =>
    extraDuration(
      mode === "create" && initial?.timeWindow ? toEndMinutes(initial.timeWindow.end) - toMinutes(initial.timeWindow.start) : null,
    ),
  );
  const [durationLabel, setDurationLabel] = useState<DurationLabel | typeof DRAWN>(() => {
    if (drawnOption !== null) return DRAWN;
    if (initial?.timeWindow) {
      const minutes = toEndMinutes(initial.timeWindow.end) - toMinutes(initial.timeWindow.start);
      if (minutes > 0) return closestDurationLabel(minutes);
    }
    return DEFAULT_DURATION_LABEL;
  });
  const lengthMinutes =
    durationLabel === DRAWN ? (drawnOption?.minutes ?? durationMinutes(DEFAULT_DURATION_LABEL)) : durationMinutes(durationLabel);
  const [location, setLocation] = useState<Location | null>(initial?.location ?? null);
  // No UI reaches anchors (D-1, see packages/domain/src/trip/conflicts.ts) — the
  // editor never lets a user set them, but still round-trips whatever value the
  // activity already carries so existing anchors aren't silently dropped.
  const anchors: Anchor[] = initial?.anchors ?? [];
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // A stop being edited starts wherever it already sits. One being CREATED
  // starts at `pending` (`hold` before M28 folded it in), not the contract's
  // `planned` zero value: a new stop is more likely to need booking than not
  // (Mitchell, 2026-08-29) — see ActivityEditorSheet's `createInitial` for the
  // same call on the prefilled path. This `??` only fires for
  // `initial === null` — the bare "Add stop" with no prefill;
  // ActivityEditorSheet already supplies "pending" whenever it builds an
  // initial value at all, and an edit's `initial` carries the activity's own
  // real kind.
  const [kind, setKind] = useState<ActivityKind>(initial?.kind ?? (mode === "create" ? "pending" : "planned"));
  const [tags, setTags] = useState<ActivityTag[]>(initial?.tags ?? []);
  const [bookedBy, setBookedBy] = useState<string | null>(initial?.bookedBy ?? null);
  const [participants, setParticipants] = useState<string[]>(initial?.participants ?? []);
  const [cost, setCost] = useState<Money | null>(initial?.cost ?? null);
  // Nobody picked is every traveller (travellers spec D1); with no member list
  // to hand (a caller that passes none) `stopHeadcount` reads it as the one
  // person who is here. Guests ride the same set through `travellerIds`'s
  // second argument: a claimed guest counts as their member, so the picker
  // and the line below price exactly what the server's overlay does.
  const travelling = new Set(travellerIds(members, guests));
  const stopLine = stopTotalLine({ cost, participants }, travelling.size, tripCurrency);
  // Who is in offers the travellers first and everyone else after them, under
  // "Not travelling" (D6): a non-traveller may still join one dinner, and once
  // picked they count, so the chip says so — the line above just went up.
  // Booked by offers every member as they come (D7): a non-traveller can pay.
  // Guests are never Booked by (guests spec P1).
  const notTravelling = members.filter((member) => !travelling.has(member.userId));
  const idleGuests = guests.filter((guest) => guest.travelling === false);
  const goingGuests = guests.filter((guest) => guest.travelling !== false);
  const personChip = (member: NamedMember) => {
    const on = participants.includes(member.userId);
    return (
      <Button
        key={member.userId}
        variant={on ? "primary" : "secondary"}
        size="sm"
        aria-pressed={on}
        className="rounded-full pr-3 pl-1"
        onClick={() =>
          setParticipants((current) =>
            current.includes(member.userId) ? current.filter((id) => id !== member.userId) : [...current, member.userId],
          )
        }
      >
        {/* The chip says who; the pill's own fill still says "in" (M38,
            artboard 3). Ringed so it holds on the brand fill. */}
        <PersonChip name={member.name} avatar={member.avatar ?? null} color={member.color ?? null} size="xs" ring />
        {member.name}
        {on && !travelling.has(member.userId) && (
          <>
            {" "}
            <span className="opacity-80">(not travelling)</span>
          </>
        )}
      </Button>
    );
  };
  // A guest's chip: the `guestId` is the value (participants is `string[]`,
  // so no schema change), the name the label. No avatar — a guest has no
  // account, so there is nothing to draw but their initials — and the badge
  // says what they are, the way the People panel does.
  const guestChip = (guest: NamedGuest) => {
    const on = participants.includes(guest.guestId);
    return (
      <Button
        key={guest.guestId}
        variant={on ? "primary" : "secondary"}
        size="sm"
        aria-pressed={on}
        className="rounded-full pr-3 pl-1"
        onClick={() =>
          setParticipants((current) =>
            current.includes(guest.guestId)
              ? current.filter((id) => id !== guest.guestId)
              : [...current, guest.guestId],
          )
        }
      >
        <PersonChip name={guest.name} avatar={null} color={null} size="xs" ring />
        {guest.name}{" "}
        <Badge className="shrink-0 px-1.5 py-0 font-medium">Guest</Badge>
        {on && guest.travelling === false && (
          <>
            {" "}
            <span className="opacity-80">(not travelling)</span>
          </>
        )}
      </Button>
    );
  };
  // Ids this stop names for people who have since LEFT the trip. The read path
  // keeps them (contracts' detail.ts) and `stopHeadcount` still prices them, so
  // a picker that listed members only hid a person the line was charging for,
  // with no way to untick them. They are shown, picked, under a fallback name
  // (never the raw id) and can only be removed: the list is taken from what the
  // stop arrived with, and each is rendered while it is still picked, so one
  // removed is never offered back. With no member list there is no telling a
  // departed id from an unknown one, so nothing is called departed.
  const knownIds = new Set([...members.map((member) => member.userId), ...guests.map((guest) => guest.guestId)]);
  // A picked guest is not in `knownIds` while the guest list has not answered
  // yet (`guestsLoaded`); calling it departed then mislabels it "Former member
  // (removed)" until the read lands, so `guest_*` ids are held out of the
  // departed set meanwhile. A non-guest id is still judged on the members
  // list, which the sheet always has by the time the form renders.
  const departedIds =
    members.length === 0 && guests.length === 0
      ? []
      : [...new Set(initial?.participants ?? [])].filter(
          (id) => !knownIds.has(id) && (guestsLoaded || !id.startsWith("guest_")),
        );
  // A picked guest since removed: their name if the picker ever saw it
  // (`guestNames`), else the same "Former member" fallback a departed member
  // gets. A removed guest did not leave the trip, so the parenthetical says so.
  const departedLabel = (id: string, index: number) => ({
    name:
      (id.startsWith("guest_") ? guestNames?.get(id) : undefined) ??
      (departedIds.length > 1 ? `Former member ${index + 1}` : "Former member"),
    note: id.startsWith("guest_") ? "(removed)" : "(left the trip)",
  });
  const memberIds = new Set(members.map((member) => member.userId));
  const departedBookedBy = members.length > 0 && bookedBy !== null && !memberIds.has(bookedBy) ? bookedBy : null;
  const booker = members.find((member) => member.userId === bookedBy);
  // Kept while the kind is switched away, so switching back does not lose
  // them; only what is SAVED is cleared (see submit).
  const [travelMode, setTravelMode] = useState<ActivityMode | null>(initial?.mode ?? null);
  const [endLocation, setEndLocation] = useState<Location | null>(initial?.endLocation ?? null);
  const [flightNumber, setFlightNumber] = useState(initial?.flightNumber ?? "");
  // Whether the number has been on screen to edit; see `savedFlightNumber`.
  const [flightFieldShown, setFlightFieldShown] = useState(initial?.mode === "flight");
  // A stop being CREATED says "To book" until told otherwise — the handoff's
  // own default (`addWhy || 'book'`), and the same bet the `pending` default
  // above makes. A stop being edited keeps what it has, including no reason.
  // Kept across a kind switch like the leg above; only the save clears it.
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(
    initial?.pendingReason ?? (mode === "create" ? "book" : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState(defaultDayId ?? "");
  // Set once the user picks a day themselves, *Unscheduled* included, so the
  // late-arriving default below never takes their choice back (M41 D3: in
  // edit mode, "" is a real answer that parks the stop).
  const [dayPicked, setDayPicked] = useState(false);
  // The title of the nearby stop last picked. The list stays out of the way
  // while the field still says exactly that, and comes back on the first edit.
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  const nearby = mode === "create" && title !== pickedTitle ? nearbyStopsFor(nearbyStops, title) : [];

  // What a pick copies is M34 D2: name, place, kind, tags and length. Never the
  // start (the day decides it) or the cost (stale, or in another currency).
  // The pending reason needs no handling: it already defaults to "To book" in
  // create mode and is kept across a kind switch.
  function pickNearbyStop(stop: NearbyStop) {
    setTitle(stop.title);
    setPickedTitle(stop.title);
    setLocation(stop.location);
    setKind(stop.kind);
    setTags(stop.tags);
    if (stop.lengthMinutes === null) return;
    const option = DURATION_OPTIONS.find((o) => o.minutes === stop.lengthMinutes);
    if (option !== undefined) return setDurationLabel(option.label);
    setDrawnOption(extraDuration(stop.lengthMinutes));
    setDurationLabel(DRAWN);
  }

  // `days` (and therefore `defaultDayId`) can arrive empty on first render —
  // activeTrip loads asynchronously in ActivityEditorSheet — so the default
  // selection is applied once a real defaultDayId shows up, not just at
  // mount. Guarded on `selectedDayId === ""` so it never overwrites a user's
  // own choice. Deliberately does NOT fall back to the first day when there
  // is no prefill at all (e.g. TripHeader's bare "Add stop", openCreate()
  // with no dayId): that is the header's own create-unscheduled trigger —
  // AGENTS.md's "real" feature list names the unscheduled rack "incl. drag
  // both ways", and e2e (m1-board.spec.ts, m2-history.spec.ts) asserts stops
  // created this way land in the rack, not on Day 1. Leaving selectedDayId
  // at "" surfaces the Day select's own "Unscheduled" option instead, and
  // the resulting dayId: null / undefined round-trips through AddActivity
  // exactly as it did before this task.
  //
  // **And it follows the stop until the user picks a day** (CodeRabbit, PR 392):
  // when another editor moves the stop while this one is open, `defaultDayId`
  // changes, and a field still showing the old day would make a save of some
  // other field move the stop back.
  useEffect(() => {
    if (dayPicked) return;
    const next = defaultDayId ?? "";
    if (selectedDayId !== next) setSelectedDayId(next);
  }, [defaultDayId, selectedDayId, dayPicked]);

  const selectedDay = days.find((d) => d.dayId === selectedDayId);

  // The window the availability Banner below reports on — must match what
  // submit() below actually saves (start + selected duration in create
  // mode, the explicit End time in edit mode), not some other window a
  // separate suggestion algorithm might prefer (CodeRabbit, PR #32).
  const actualEnd =
    mode === "edit" ? end : start !== "" ? toTimeString(toMinutes(start) + lengthMinutes) : "";
  const overlapsExisting =
    selectedDay !== undefined &&
    start !== "" &&
    actualEnd !== "" &&
    selectedDay.existing.some((w) => toMinutes(start) < toMinutes(w.end) && toMinutes(w.start) < toMinutes(actualEnd));

  // The form as it would be saved, or the reason it cannot be yet.
  function build(): ActivityFormValue | string {
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return "Title is required";

    let timeWindow: TimeWindow | null = null;
    if (mode === "edit") {
      if ((start === "") !== (end === "")) return "Provide both start and end times";
      if (start !== "" && start >= end) return "End time must be after start time";
      timeWindow = start !== "" ? { start, end } : null;
    } else if (start !== "") {
      const computedEnd = toTimeString(toMinutes(start) + lengthMinutes);
      timeWindow = { start, end: computedEnd };
    }

    return {
      title: trimmedTitle,
      dayId: selectedDayId !== "" ? selectedDayId : null,
      timeWindow,
      location,
      notes: notes.trim() !== "" ? notes.trim() : null,
      anchors,
      kind,
      // Always the complete set: `UpdateActivity.tags` is a whole-array
      // replace, not a delta (packages/contracts/src/activity.ts).
      tags,
      bookedBy,
      // Always the complete list, for the same reason `tags` is: the command
      // replaces the array wholesale rather than adding to it.
      participants,
      cost,
      mode: kind === "transit" ? travelMode : null,
      endLocation: kind === "transit" ? endLocation : null,
      pendingReason: kind === "pending" ? pendingReason : null,
      flightNumber: savedFlightNumber(),
    };
  }

  // Moved off a flight, the number is cleared with the rest of the leg's
  // answers. A transit stop that was never a flight can still carry one (the
  // API and the assistant allow it); while the field has not been shown that
  // number is kept, since null here would erase it unseen. Once shown, the
  // user may have cleared or changed it, and the stored one must not return.
  function savedFlightNumber(): string | null {
    if (kind !== "transit") return null;
    if (travelMode === "flight") return flightNumber.trim() !== "" ? flightNumber.trim() : null;
    return flightFieldShown ? null : (initial?.flightNumber ?? null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const built = build();
    if (typeof built === "string") return setError(built);
    void onSave(built);
  }

  // Edit mode saves itself: a change is sent after a short pause, so there is
  // no Save to forget. An invalid form (empty title, half a time window) is
  // simply not sent until it is valid. The first render's value is the baseline.
  const built = build();
  const builtKey = typeof built === "string" ? null : JSON.stringify(built);
  const savedKey = useRef(builtKey);
  const latest = useRef({ built, onSave });
  latest.current = { built, onSave };
  useEffect(() => {
    if (mode !== "edit" || builtKey === null || builtKey === savedKey.current) return;
    const timer = setTimeout(() => {
      savedKey.current = builtKey;
      const { built: value, onSave: save } = latest.current;
      if (typeof value !== "string") void save(value, { stay: true });
    }, 600);
    return () => clearTimeout(timer);
  }, [mode, builtKey]);

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3">
      <FormField
        id="activity-title"
        label="What or where"
      >
        <Input
          id="activity-title"
          // A new stop starts with its name, so the field takes focus: ⌘K
          // *New stop* is typed straight into (M41 D9). Not when editing, where
          // a phone would raise its keyboard over a stop opened to be read.
          autoFocus={mode === "create"}
          aria-label="What or where"
          placeholder="e.g. Dinner at Kikunoi Roan"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormField>

      {nearby.length > 0 && <NearbyStopsList stops={nearby} onPick={pickNearbyStop} />}

      <LocationInput value={location} onChange={setLocation} />

      <div className="activity-editor-grid">
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-day">Day</Label>
          <NativeSelect
            id="activity-day"
            value={selectedDayId}
            onChange={(e) => {
              setDayPicked(true);
              setSelectedDayId(e.target.value);
            }}
          >
            {/* An edit can park a stop as well as move it (M41 D3), so the
                rack is always on offer there. Create keeps it only while
                nothing is picked: a stop made for a day is made for it. */}
            {(mode === "edit" || selectedDayId === "") && <option value="">Unscheduled</option>}
            {days.map((day) => (
              <option key={day.dayId} value={day.dayId}>
                {day.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-start">Start</Label>
          <Input
            id="activity-start"
            aria-label="Start"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        {mode === "edit" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="activity-end-time">End time</Label>
            <Input
              id="activity-end-time"
              aria-label="End time"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="activity-duration">How long</Label>
            <NativeSelect
              id="activity-duration"
              value={durationLabel}
              onChange={(e) => setDurationLabel(e.target.value as DurationLabel | typeof DRAWN)}
            >
              {drawnOption !== null && <option value={DRAWN}>{drawnOption.label}</option>}
              {DURATION_OPTIONS.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {selectedDay && start !== "" && actualEnd !== "" ? (
        overlapsExisting ? null : (
          // "success" only when the window actually about to be saved is
          // clear — describing start+How-long (or the explicit edit-mode
          // end), not some other window fitIntoDay might have suggested
          // instead. fitIntoDay picks its OWN duration from the day's free
          // gaps, ignoring the user's own "How long" choice, so calling it
          // here could report a slot that fits while a Half day selection
          // actually saves a longer, conflicting one (CodeRabbit, PR #32).
          // A real overlap still isn't blocked — Invariant 3, conflicts are
          // data, not errors — it just doesn't get a false "Fits" banner;
          // the domain's own time-overlap conflict surfaces it after save.
          <Banner variant="success">
            {selectedDay.existing.length === 0
              ? `Open day — fits ${toClockRange(start, actualEnd, clock)} with room to spare.`
              : `Fits ${toClockRange(start, actualEnd, clock)}, alongside ${selectedDay.existing.length} other stop${selectedDay.existing.length === 1 ? "" : "s"} already on this day.`}
          </Banner>
        )
      ) : null}

      {/* SPEC §36.9: a three-way segmented Kind, then ONE second row for the
          kind that has a detail — why a pending stop is pending, or how a
          transit stop travels. Both rows are the same icon-radio shape
          (Mitchell, 2026-09-26: "I prefer the icon buttons so use that for
          both places it has a kind"). Without a picker every kind surface
          (the card badge, the Calendar's split and its `N to book`, the home
          hero's tile) would render on seeded trips only. */}
      <div className="flex flex-col gap-2">
        {/* No visible "Kind" over it (Mitchell's preview comment, 2026-10-04:
            "Drop Kind, and leave just the description"): the control's own
            options say what it is, and it keeps "Kind" as its name. */}
        <Text variant="muted">{KIND_HELP[kind]}</Text>
        <SegmentedControl
          aria-label="Kind"
          fullWidth
          value={kind}
          onValueChange={setKind}
          options={KIND_OPTIONS.map((option) => ({ value: option, label: KIND_LABEL[option] }))}
        />
        {kind === "pending" && <PendingReasonPicker value={pendingReason} onChange={setPendingReason} />}
        {kind === "transit" && (
          <TravelModePicker
            value={travelMode}
            onChange={(next) => {
              setTravelMode(next);
              if (next === "flight") setFlightFieldShown(true);
            }}
          />
        )}
      </div>

      {kind === "transit" && (
        // The place above is where the leg starts; this is where it ends.
        <LocationInput id="end-location-search" label="Going to" value={endLocation} onChange={setEndLocation} />
      )}

      {kind === "transit" && travelMode === "flight" && (
        <FormField id="activity-flight-number" label="Flight number">
          <Input
            id="activity-flight-number"
            placeholder="e.g. TP 1234"
            maxLength={20}
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value)}
          />
        </FormField>
      )}

      {/* ADR-060: a typed price is for ONE person, and the trip multiplies it
          by who is going. The label says so, and the line under it does the
          multiplication with the Who-is-in picks below, live, so a shared bill
          typed here shows up as the wrong number before it is saved. */}
      <div className="flex flex-col gap-1">
        <FormField
          id="activity-cost"
          label="Cost per person"
        >
          <MoneyInput id="activity-cost" value={cost} currency={tripCurrency} onChange={setCost} placeholder="e.g. 120" />
        </FormField>
        {/* Always rendered, a no-break space holding its line when there is
            no cost. MoneyInput commits on blur, so a line that only appeared
            once a cost existed appeared on the mousedown that blurred the
            field — usually on "Add stop" — and pushed that button out from
            under the pointer, so the click saved nothing. */}
        <Text variant="muted" data-testid="activity-cost-total" aria-hidden={stopLine === null ? true : undefined}>
          {stopLine ?? "\u00a0"}
        </Text>
      </div>

      {/* ADR-070's two groups: what a stop IS, then what it NEEDS. The design
          pairs each chip with the "power" it grants — "Pins where you sleep
          that night", "the assistant keeps asking until there is a booking
          date". None of those powers exists yet, so the copy that promises
          them is left out rather than shipped ahead of the behaviour. */}
      <div role="group" aria-label="Tags" className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <Text variant="muted">Tags</Text>
        </div>
        {TAG_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            {group.label !== "What it is" && <Text variant="muted">{group.label}</Text>}
            <div role="group" aria-label={group.label} className="flex flex-wrap gap-1.5">
              {group.tags.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <Button
                    key={tag}
                    variant={on ? "primary" : "secondary"}
                    size="sm"
                    aria-pressed={on}
                    className="rounded-full px-3"
                    onClick={() => setTags((current) => toggleTag(current, tag))}
                  >
                    {TAG_LABEL[tag]}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* M13 link 5. Two controls because they answer two questions — who
          BOOKED this stop, and who is GOING to it. A single "who" would read
          fine here and be wrong for every cost split later built on it
          (M19 link 3). */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <Text variant="muted">Who is in</Text>
        </div>
        {members.length === 0 && guests.length === 0 ? (
          <Text variant="muted">Invite someone to the trip to say who a stop is for.</Text>
        ) : (
          <>
            <div role="group" aria-label="Who is going" className="flex flex-wrap gap-1.5">
              {members.filter((member) => travelling.has(member.userId)).map(personChip)}
              {goingGuests.map(guestChip)}
              {departedIds.map((id, index) => {
                const label = departedLabel(id, index);
                return participants.includes(id) ? (
                  <Button
                    key={id}
                    variant="primary"
                    size="sm"
                    aria-pressed
                    className="rounded-full px-3"
                    onClick={() => setParticipants((current) => current.filter((p) => p !== id))}
                  >
                    {label.name} <span className="opacity-80">{label.note}</span>
                  </Button>
                ) : null;
              })}
              {(notTravelling.length > 0 || idleGuests.length > 0) && (
                <div className="flex basis-full flex-col gap-1.5 pt-1">
                  <Text variant="muted">Not travelling</Text>
                  <div role="group" aria-label="Not travelling" className="flex flex-wrap gap-1.5">
                    {notTravelling.map(personChip)}
                    {idleGuests.map(guestChip)}
                  </div>
                </div>
              )}
            </div>
            <FormField
              id="activity-booked-by"
              label="Booked by"
            >
              {/* Still a native select (ADR-010): an option cannot hold an
                  icon, so the chosen person's chip sits beside it (M38). */}
              <div data-testid="booked-by" className="flex items-center gap-2">
                {booker !== undefined && (
                  <PersonChip name={booker.name} avatar={booker.avatar ?? null} color={booker.color ?? null} size="sm" />
                )}
                <NativeSelect
                  id="activity-booked-by"
                  className="min-w-0 flex-1"
                  value={bookedBy ?? ""}
                  onChange={(e) => setBookedBy(e.target.value === "" ? null : e.target.value)}
                >
                  <option value="">Nobody yet</option>
                  {/* Shown only while it is the value, so choosing anything else
                      drops it for good — same rule as Who is in above. */}
                  {departedBookedBy !== null && <option value={departedBookedBy}>Former member (left the trip)</option>}
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </FormField>
          </>
        )}
      </div>

      <FormField id="activity-notes" label="Notes" hint="Confirmation numbers, what to order, who to ask for.">
        <Textarea
          id="activity-notes"
          aria-label="Notes"
          rows={3}
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </FormField>

      {error !== null && (
        <Text as="p" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-hairline pt-4">
        {/* Remove lives here rather than on each rack card (M41 D4). Undone
            like any other change, so it asks nothing first. */}
        {onRemove !== undefined ? (
          <Button type="button" variant="ghost" className="text-danger-ink" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {mode === "edit" ? "Save" : "Add stop"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// The design's list-of-matches markup, from the placeholder it replaces. The
// badge is the design's own decoration (`m.kind` is a glyph there, not data).
function NearbyStopsList({ stops, onPick }: { stops: readonly NearbyStop[]; onPick: (stop: NearbyStop) => void }) {
  const unit = useDistanceUnit();
  return (
    <ul
      aria-label="Nearby stops from the library"
      className="m-0 list-none divide-y divide-hairline rounded-lg border border-hairline p-0"
    >
      {stops.map((stop) => (
        <li key={`${stop.savedDayId}:${stop.title}:${stop.location.name}`}>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-3 py-2 text-left"
            onClick={() => onPick(stop)}
          >
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-moss text-xs text-ink">
              ◈
            </span>
            <span className="flex flex-col">
              <Text as="span" className="text-sm text-ink">
                {stop.title}
              </Text>
              <Text as="span" variant="muted">
                {nearbyStopDetail(stop, unit)}
              </Text>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

// `<place> · <length> · from "<day>"`, then how many playbooks carry it when
// more than one does (D9), then how far it is when it was ranked by distance (D1).
function nearbyStopDetail(stop: NearbyStop, unit: DistanceUnit): string {
  const parts = [displayPlace(stop.location) ?? stop.location.name];
  if (stop.lengthMinutes !== null) parts.push(formatDuration(stop.lengthMinutes, "").trim());
  parts.push(`from “${stop.savedDayName}”`);
  if (stop.playbookCount > 1) parts.push(`in ${stop.playbookCount} playbooks`);
  if (stop.distanceKm !== null) parts.push(kmLabel(stop.distanceKm, unit));
  return parts.join(" · ");
}
