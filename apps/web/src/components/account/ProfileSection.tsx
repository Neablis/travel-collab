"use client";

import { useEffect, useRef, useState } from "react";
import type { DistanceUnit, UpdateUserPreferences } from "@tc/contracts";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { DataText } from "@/components/ui/data-text";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsCard, SettingsRow, SETTINGS_MEASURE } from "@/components/ui/settings-card";
import { useAccountPreferences } from "./PreferencesProvider";

const UNIT_OPTIONS = [
  { value: "km" as const, label: "Kilometres" },
  { value: "mi" as const, label: "Miles" },
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
export function ProfileSection({ email }: { email: string }) {
  const { preferences, loaded, save } = useAccountPreferences();
  const [name, setName] = useState(preferences.displayName ?? "");
  const [airport, setAirport] = useState(preferences.homeAirport ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [airportError, setAirportError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  // Set the moment someone types, cleared once their value is committed or
  // reverted. It is what stops the resync below from overwriting an edit in
  // progress — see the comment there.
  const editing = useRef({ name: false, airport: false });

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

  return (
    <div className={`flex flex-col gap-4 ${SETTINGS_MEASURE}`}>
      <SettingsCard heading="You">
        <SettingsRow label="Your name" htmlFor="account-display-name">
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

        {/* Read-only, and deliberately not labelled with a `<label for>`: the
            address comes from the identity provider and this app has no way to
            change it, so there is nothing to point at. A disabled Input would
            offer an edit that does not exist. The artboard says "Signed in as"
            rather than "Email" for the same reason — it states a fact instead
            of naming a field. */}
        <SettingsRow label="Signed in as">
          <DataText size="base" className="text-ink">
            {email === "" ? "Not provided by your sign-in" : email}
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

      <SettingsCard heading="Display">
        <SettingsRow
          label="Distance"
          description="How far apart two stops are, everywhere it is shown."
        >
          {/* Account scope, not trip scope — "a trip does not have a unit, a
              person does" (SPEC §12). Saved immediately: there is one choice
              of two and nothing to blur out of. */}
          <div className="flex flex-col items-start gap-2">
            <SegmentedControl<DistanceUnit>
              aria-label="Distance units"
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
      </SettingsCard>
    </div>
  );
}
