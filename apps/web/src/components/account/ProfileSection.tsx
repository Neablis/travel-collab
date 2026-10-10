"use client";

import { useEffect, useRef, useState } from "react";
import type { DistanceUnit, TimeFormat, UpdateUserPreferences, UserPreferences } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { DataText } from "@/components/ui/data-text";
import { PersonChip } from "@/components/ui/person-chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsCard, SettingsRow } from "@/components/ui/settings-card";
import { displayNameFor, publicNameFor } from "@/lib/displayName";
import { initialsFor } from "@/lib/initials";
import { AvatarPicker, ColorPicker } from "./PersonaPickers";
import { useAccountPreferences } from "./PreferencesProvider";

/** A full stop, unless the text already ends in one — "Dana R." does, a one-word name does not. */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** The M38 choices, each saved the moment it is made. */
type PersonaPatch = Partial<Pick<UserPreferences, "avatar" | "color" | "publicDisplayName">>;

// One setting for every unit, not only distance: temperature and rain are
// derived from it (ADR-052's 2026-09-24 amendment), and "Distance" hid that
// from Mitchell himself (reviewed 2026-09-27). The options stay one word and
// the units go in the row's description — "Metric (km, °C, mm)" beside
// "Imperial (mi, °F, in)" is ~40 characters in a pill that cannot wrap, and a
// stacked phone row's measure is ~290px at 360px wide (`SettingsRow`'s clip).
const UNIT_OPTIONS = [
  { value: "km" as const, label: "Metric" },
  { value: "mi" as const, label: "Imperial" },
];

// Each label carries its own example, so the choice reads without knowing
// what "24-hour" means to this app (minutes always shown, hour zero-padded).
const TIME_FORMAT_OPTIONS = [
  { value: "12h" as const, label: "12-hour (2:30 pm)" },
  { value: "24h" as const, label: "24-hour (14:30)" },
];

// The Profile tab of `/account` (SPEC §34.4): who you are, and how the app
// reads to you. **Lifted out of `AccountSettingsSheet` unchanged in substance**
// — the commit-on-blur shape and every one of the PR-112 guards below came with
// it, because re-implementing the move without them reintroduces the wipe bug
// they fix. What changed is the presentation: §34.5's cards, label column and
// content-sized controls instead of a stack of full-bleed `FormField`s.
//
// **Sign out is deliberately not here**, and not anywhere on `/account`. It
// stays in the avatar popover — SPEC §12, "putting it in both was Rule 4" — and
// the design's own desktop `/account` artboard has none either. §34.4's "Sign
// out sits below [the tabs]" is about the PHONE account screen, which is a task
// screen with no avatar popover to hold it (§34.3). M26 link 1 records the
// decision.
//
// **Home time on hover is not here, and that is not an omission.** The artboard
// draws it as a second Display row; it needs a timezone for the home airport
// and a `trip.tz` to compare against, and the app has neither. It was amended
// out of M17's exit gate on 2026-09-01 for that reason and stays a placed item
// blocked on data. The design is ahead here, not this build behind.
//
// **There is no account-level currency**, and that was decided rather than
// forgotten (M26 link 1). Every other field here is a property of the reader
// with no per-trip counterpart; a currency is a property of where the trip
// happens, and a trip already carries one (`SetTripCurrency`).
/**
 * `email` is `undefined` while the session probe is still in flight, `""` when
 * the provider genuinely supplied no address, and the address otherwise. The
 * three are deliberately distinct: "Not provided by your sign-in" is a claim
 * about the reader's own account, and it must not be made before anyone knows.
 *
 * `signIn` is the identity provider's side of the name, `undefined` until the
 * session answers: what an empty display name falls back to on trips, and
 * what public pages say while the display name is kept off them (M38).
 *
 * `onOpenTokens` opens the API tokens sub-view. The URL is `AccountScreen`'s to
 * own (`?tab=`), so the section asks rather than navigating itself.
 */
export function ProfileSection({
  email,
  signIn,
  onOpenTokens,
}: {
  email: string | undefined;
  signIn: { userId: string; name: string | null } | undefined;
  onOpenTokens: () => void;
}) {
  const { preferences, loaded, save, defaultColor } = useAccountPreferences();
  // A pick shows at once, before its save answers (optimistic), and falls back
  // to the stored value when it fails. Keyed per field so a colour save
  // landing cannot drop an avatar pick still in flight.
  const [picked, setPicked] = useState<PersonaPatch>({});
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const avatar = picked.avatar !== undefined ? picked.avatar : preferences.avatar;
  const color = picked.color !== undefined ? picked.color : preferences.color;
  const publicDisplayName = picked.publicDisplayName ?? preferences.publicDisplayName;
  const [name, setName] = useState(preferences.displayName ?? "");
  const [airport, setAirport] = useState(preferences.homeAirport ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [airportError, setAirportError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [timeFormatError, setTimeFormatError] = useState<string | null>(null);
  // Set the moment someone types, cleared once their value is committed or
  // reverted. It is what stops the resync below from overwriting an edit in
  // progress — see the comment there.
  const editing = useRef({ name: false, airport: false });
  // The newest persona pick per field, by issue order — `choose` below.
  const picks = useRef<{ issued: number; latest: Partial<Record<keyof PersonaPatch, number>> }>({ issued: 0, latest: {} });

  // Controlled fields seeded from stored state, resynced whenever it moves.
  // The server NORMALIZES `homeAirport` (trim + uppercase) and refuses a
  // display name it cannot store, so the field has to be able to show what was
  // actually saved rather than what was typed — someone entering `sfo` sees
  // `SFO` land, which is the only way the normalization is visible as a
  // decision rather than as the client and the server quietly disagreeing.
  //
  // **Guarded on the field being untouched, found by review on pull request 112.** The
  // resync fires on any `preferences` change, not only this field's own save,
  // and the provider replaces the whole object — so typing a name and then
  // flipping the distance unit saved the unit, pushed new preferences, and
  // wiped the half-typed name out of the box underneath the person's cursor.
  // The pre-fetch case is the same defect from the other end: this seeds from
  // the provider's DEFAULTS, so mounting before the first fetch lands showed
  // empty fields and then overwrote whatever had been typed into them.
  useEffect(() => {
    if (!editing.current.name) setName(preferences.displayName ?? "");
  }, [preferences.displayName]);
  useEffect(() => {
    if (!editing.current.airport) setAirport(preferences.homeAirport ?? "");
  }, [preferences.homeAirport]);

  // Commit on blur, not per keystroke — the same shape the trip settings sheet
  // uses for the trip name, and for the same reason: a PATCH per character is
  // a lot of writes to say one thing.
  async function commit(
    field: "name" | "airport",
    patch: UpdateUserPreferences,
    setError: (message: string | null) => void,
    revert: () => void,
  ) {
    const result = await save(patch);
    // Committed or rejected, THIS field is no longer an edit in progress:
    // either the stored value now matches it, or `revert()` below is about to
    // put the stored value back. Cleared before both so the resync above is
    // free again.
    //
    // Only this field, found by review on pull request 112. Clearing both meant
    // committing one marked the OTHER untouched while its text was still being
    // edited — no wipe at that moment, because the resync effects are per
    // field, but the next change to that field's stored value would then be
    // free to replace text still in the box. The flag's lifetime has to match
    // the field that owns it.
    editing.current[field] = false;
    if (result.ok) {
      setError(null);
      return;
    }
    setError(result.error.message);
    // Put the field back to what is actually stored. A rejected value left in
    // the box reads as saved, which is the one thing a settings form must never
    // do (`useEffect` above cannot do it: `preferences` did not change).
    revert();
  }

  // The units control's shape — saved at once, the same pre-fetch guard, the
  // failure surfaced — plus the optimistic pick above. The pick is dropped
  // only if it is still this call's: a second pick made while the first was in
  // flight must not flash back to the first one's answer.
  //
  // The same holds for its error: a refusal answering a pick that a newer pick
  // of the same field has since replaced is about a choice nobody holds any
  // more, so it is dropped rather than shown under the newer one (self-review
  // of pull request 359). The newer pick clears the old message as it starts.
  async function choose(patch: PersonaPatch, setError: (message: string | null) => void) {
    if (!loaded) return;
    const keys = Object.keys(patch) as (keyof PersonaPatch)[];
    const ticket = ++picks.current.issued;
    for (const key of keys) picks.current.latest[key] = ticket;
    setError(null);
    setPicked((current) => ({ ...current, ...patch }));
    const result = await save(patch);
    setPicked((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as (keyof PersonaPatch)[]) {
        if (next[key] === patch[key]) delete next[key];
      }
      return next;
    });
    if (keys.every((key) => picks.current.latest[key] === ticket)) setError(result.ok ? null : result.error.message);
  }

  // As trips print it (`displayNameFor`, the one seam), following the field as
  // it is typed — the canvas's preview is live. `initialsFor` is what the chip
  // and the Initials option both draw from the same name.
  const shownName = displayNameFor({
    userId: signIn?.userId ?? "",
    displayName: name.trim() === "" ? null : name.trim(),
    name: signIn?.name,
    email: email === "" ? null : email,
  });

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard heading="You">
        {/* The only place you see yourself (M38 canvas, artboard 1). A testid
            because the chip is `aria-hidden` beside the printed name, so the
            line has no accessible identity of its own to be found by. */}
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-moss px-3 py-2.5" data-testid="persona-preview">
          <PersonChip name={shownName} avatar={avatar} color={color ?? defaultColor} size="lg" />
          <span className="flex min-w-0 flex-col">
            <Text as="span" className="truncate text-sm font-semibold text-ink">
              {shownName}
            </Text>
            <Text as="span" variant="muted">
              How you appear on your trips
            </Text>
          </span>
        </div>

        <SettingsRow
          label="Display name"
          htmlFor="account-display-name"
          // While the session probe is out, the long sentence with the name
          // still to come ("…", as the email row below says it): the short
          // one became the long one when the probe answered, wrapped, and
          // pushed every row under it down (a layout-shift probe on /account).
          description={
            signIn === undefined
              ? "What people on your trips see. Empty, it is your sign-in name, …"
              : signIn.name
                ? `What people on your trips see. Empty, it is your sign-in name, ${signIn.name}.`
                : "What people on your trips see."
          }
        >
          {/* 240px, because a name is not a paragraph (§34.5: controls are
              sized to their content). `w-full` inside the fixed box so it
              shrinks with the measure on a narrow window rather than
              overflowing it. */}
          <div className="w-60 max-w-full">
            <Input
              id="account-display-name"
              className="w-full"
              disabled={!loaded}
              value={name}
              placeholder="Your name"
              aria-describedby={nameError === null ? undefined : "account-display-name-error"}
              onChange={(e) => {
                editing.current.name = true;
                setName(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  // Escape puts the stored value back, so this field stops
                  // being an edit in progress — without clearing the flag it
                  // would never resync again until the next commit (review,
                  // pull request 112).
                  editing.current.name = false;
                  setName(preferences.displayName ?? "");
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                const typed = name.trim();
                const stored = preferences.displayName;
                // Empty means "clear it" — an explicit null, which is a
                // different operation from omitting the field
                // (`UpdateUserPreferences`). Unchanged sends nothing at all.
                const next = typed === "" ? null : typed;
                if (next === stored) {
                  setName(stored ?? "");
                  setNameError(null);
                  return;
                }
                void commit("name", { displayName: next }, setNameError, () => setName(stored ?? ""));
              }}
            />
            {nameError !== null && (
              <Text id="account-display-name-error" variant="muted" className="mt-1.5 text-danger-ink">
                {nameError}
              </Text>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label="Avatar" description="Shown beside your name. Initials if you choose none.">
          <div className="flex flex-col items-start gap-2">
            <AvatarPicker
              value={avatar}
              initials={initialsFor(shownName)}
              disabled={!loaded}
              onValueChange={(next) => void choose({ avatar: next }, setAvatarError)}
            />
            {avatarError !== null && (
              <Text variant="muted" className="text-danger-ink">
                {avatarError}
              </Text>
            )}
          </div>
        </SettingsRow>

        {/* The stored choice only: with none stored no swatch is checked, and
            the preview draws the colour a trip derives, which the server
            sends as `defaultColor` (canvas question 3) — Account does not
            guess it, and no longer draws slate where every trip does not. */}
        <SettingsRow
          label="Colour"
          description="If someone on a trip chose it first, you show in another colour there."
        >
          <div className="flex flex-col items-start gap-2">
            <ColorPicker
              value={color}
              disabled={!loaded}
              onValueChange={(next) => void choose({ color: next }, setColorError)}
            />
            {colorError !== null && (
              <Text variant="muted" className="text-danger-ink">
                {colorError}
              </Text>
            )}
          </div>
        </SettingsRow>

        {/* Read-only, and deliberately not labelled with a `<label for>`: the
            address comes from the identity provider and this app has no way to
            change it, so there is nothing to point at. A disabled Input would
            offer an edit that does not exist. The artboard says "Signed in as"
            rather than "Email" for the same reason — it states a fact instead
            of naming a field. */}
        <SettingsRow label="Signed in as">
          <DataText size="base" className="text-ink">
            {email === undefined ? "…" : email === "" ? "Not provided by your sign-in" : email}
          </DataText>
        </SettingsRow>

        <SettingsRow
          label="Home airport"
          htmlFor="account-home-airport"
          description="Where a trip starts from, when you have not said otherwise. Three letters, like SFO — leave it empty if you would rather not say."
        >
          {/* 96px: three characters, and the artboard's own width. */}
          <div className="w-24">
            <Input
              id="account-home-airport"
              className="w-full"
              disabled={!loaded}
              value={airport}
              placeholder="SFO"
              maxLength={3}
              autoCapitalize="characters"
              aria-describedby={airportError === null ? undefined : "account-home-airport-error"}
              onChange={(e) => {
                editing.current.airport = true;
                setAirport(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  editing.current.airport = false;
                  setAirport(preferences.homeAirport ?? "");
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                const typed = airport.trim().toUpperCase();
                const stored = preferences.homeAirport;
                const next = typed === "" ? null : typed;
                if (next === stored) {
                  setAirport(stored ?? "");
                  setAirportError(null);
                  return;
                }
                // Sent as typed, NOT as the upcased local copy: the server is
                // what normalizes (the contract carries no transform), and a
                // client that tidied first would hide a server that had
                // stopped doing it.
                void commit("airport", { homeAirport: airport.trim() || null }, setAirportError, () =>
                  setAirport(stored ?? ""),
                );
              }}
            />
          </div>
          {airportError !== null && (
            <Text id="account-home-airport-error" variant="muted" className="mt-1.5 text-danger-ink">
              {airportError}
            </Text>
          )}
        </SettingsRow>
      </SettingsCard>

      {/* Its own card so it reads as a privacy choice (canvas, artboard 1),
          off by default. The description names the exact fallback a stranger
          gets — `publicNameFor` of the sign-in name, the server's own rule. */}
      <SettingsCard heading="Public pages">
        <SettingsRow label="Your name in the library">
          <div className="flex flex-col items-start gap-2">
            <CheckboxField
              checked={publicDisplayName}
              disabled={!loaded}
              onCheckedChange={(next) => void choose({ publicDisplayName: next }, setPublicError)}
              title="Show my display name on public pages"
              description={
                signIn === undefined
                  ? "While this is off, days you publish say your sign-in name, shortened."
                  : sentence(`While this is off, days you publish say ${publicNameFor({ userId: signIn.userId, name: signIn.name })}`)
              }
            />
            {publicError !== null && (
              <Text variant="muted" className="text-danger-ink">
                {publicError}
              </Text>
            )}
          </div>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard heading="Display">
        <SettingsRow
          label="Units"
          description="Distances, temperatures and rainfall across your trips. Metric is km, °C and mm; imperial is mi, °F and in."
        >
          {/* Account scope, not trip scope — "a trip does not have a unit, a
              person does" (SPEC §12). Saved immediately: there is one choice
              of two and nothing to blur out of. */}
          <div className="flex flex-col items-start gap-2">
            <SegmentedControl<DistanceUnit>
              aria-label="Units"
              value={preferences.distanceUnit}
              options={UNIT_OPTIONS}
              onValueChange={(distanceUnit) => {
                // Not before the first fetch resolves: until then
                // `preferences` is the provider's DEFAULTS, and saving from
                // that state would write a default over a value this screen has
                // never seen. The text fields are disabled for the same window;
                // this control has no `disabled` prop, so the guard lives here
                // rather than widening a shared primitive for one caller.
                if (!loaded) return;
                void (async () => {
                  // Surfaced, not swallowed. The other two fields show
                  // `result.error.message`; this one discarded the result, so a
                  // 401/404/500 left the toggle looking switched with nothing
                  // stored behind it — a settings control that lies about
                  // having saved. Found by review on pull request 112.
                  const result = await save({ distanceUnit });
                  setUnitError(result.ok ? null : result.error.message);
                })();
              }}
            />
            {unitError !== null && (
              // `text-danger-ink`, the same token `FormField` renders its own
              // error with — not a hand-rolled colour. The colour wall exists to
              // catch exactly the arbitrary value this line first carried.
              <Text variant="muted" className="text-danger-ink">
                {unitError}
              </Text>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label="Time" description="How clock times are written across your trips.">
          {/* The units control's twin: account scope, saved at once, the
              same pre-fetch guard and the same surfaced failure, for the
              reasons recorded there. Rendering only — every stored time stays
              24-hour "HH:MM" whichever is picked. */}
          <div className="flex flex-col items-start gap-2">
            <SegmentedControl<TimeFormat>
              aria-label="Time format"
              value={preferences.timeFormat}
              options={TIME_FORMAT_OPTIONS}
              onValueChange={(timeFormat) => {
                if (!loaded) return;
                void (async () => {
                  const result = await save({ timeFormat });
                  setTimeFormatError(result.ok ? null : result.error.message);
                })();
              }}
            />
            {timeFormatError !== null && (
              <Text variant="muted" className="text-danger-ink">
                {timeFormatError}
              </Text>
            )}
          </div>
        </SettingsRow>
      </SettingsCard>

      {/* **API tokens left the tab strip for this line** (SPEC §35.4, M27
          D7): a rarely used action demoted to a quiet link (project rule 5). One
          responsive screen, so a phone gets it too — the design's phone
          artboard never drew a way to the tokens, and without this line a
          phone would have none. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-0.5 py-1">
        <Text variant="secondary" className="min-w-0 grow basis-70 leading-normal text-pretty">
          Writing your own program against your trips? That needs an API token.
        </Text>
        <Button variant="ghost" size="sm" onClick={onOpenTokens}>
          API tokens &rarr;
        </Button>
      </div>
    </div>
  );
}
