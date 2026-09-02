"use client";

import { useEffect, useRef, useState } from "react";
import type { DistanceUnit, UpdateUserPreferences } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { DataText } from "@/components/ui/data-text";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAccountPreferences } from "./PreferencesProvider";

const UNIT_OPTIONS = [
  { value: "km" as const, label: "Kilometres" },
  { value: "mi" as const, label: "Miles" },
];

// SPEC §12's Account settings Sheet (C5/C6), modelled on the trip
// `SettingsSheet` it sits beside in the app: sections, `SectionHeading`,
// `FormField`, `Input`. Opened from the avatar menu's "Your account".
//
// **Sign out is deliberately not here.** It stays in the avatar popover only —
// SPEC §12: "Putting it in both was Rule 4."
//
// Home airport is stored and shown; it does not yet drive anything. SPEC §12's
// home-time-on-hover needs a timezone for the code and a `trip.tz` to compare
// it against, and the app has neither — that box was amended out of M17's exit
// gate on 2026-09-01 (see the milestone file). Collecting the code now is what
// makes it a placed item rather than a blocked one.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text as="span" className="mb-2.5 block text-xs font-semibold uppercase tracking-wider text-slate">
      {children}
    </Text>
  );
}

export function AccountSettingsSheet({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From the session, and read-only here — Identity owns it, the provider sets it. */
  email: string;
}) {
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
  // The pre-fetch case is the same defect from the other end: the Sheet seeds
  // from the provider's DEFAULTS, so opening it before the first fetch lands
  // showed empty fields and then overwrote whatever had been typed into them.
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
    patch: UpdateUserPreferences,
    setError: (message: string | null) => void,
    revert: () => void,
  ) {
    const result = await save(patch);
    // Committed or rejected, the field is no longer an edit in progress: either
    // the stored value now matches it, or `revert()` below is about to put the
    // stored value back. Cleared before both so the resync above is free again.
    editing.current = { name: false, airport: false };
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
    <Sheet title="Your account" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-5 pt-1">
        <div className="flex flex-col gap-4">
          <FormField
            id="account-display-name"
            label="Your name"
            description="What this app calls you — on the avatar menu and anywhere your name appears."
            error={nameError}
          >
            <Input
              id="account-display-name"
              disabled={!loaded}
              value={name}
              placeholder="Your name"
              onChange={(e) => {
                editing.current.name = true;
                setName(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
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
                void commit({ displayName: next }, setNameError, () =>
                  setName(stored ?? ""),
                );
              }}
            />
          </FormField>

          {/* Read-only, and deliberately not a FormField: the address comes
              from the identity provider and this app has no way to change it,
              so there is nothing for a <label for> to point at. A disabled
              Input would offer an edit that does not exist. Same
              label-over-DataText shape the trip sheet's read-only rows use. */}
          <div className="flex flex-col gap-1.5">
            <Text as="span" className="text-xs text-slate">
              Email
            </Text>
            <DataText size="base" className="text-ink">
              {email === "" ? "Not provided by your sign-in" : email}
            </DataText>
          </div>

          <FormField
            id="account-home-airport"
            label="Home airport"
            hint="Three letters, like SFO. Leave empty if you would rather not say."
            error={airportError}
          >
            <Input
              id="account-home-airport"
              disabled={!loaded}
              value={airport}
              placeholder="SFO"
              maxLength={3}
              autoCapitalize="characters"
              onChange={(e) => {
                editing.current.airport = true;
                setAirport(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
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
                void commit({ homeAirport: airport.trim() || null }, setAirportError, () =>
                  setAirport(stored ?? ""),
                );
              }}
            />
          </FormField>
        </div>

        <div>
          <SectionHeading>Display</SectionHeading>
          <div className="flex items-center justify-between gap-3">
            <Text variant="secondary">Distance</Text>
            {/* Account scope, not trip scope — "a trip does not have a unit, a
                person does" (SPEC §12). Saved immediately: there is one choice
                of two and nothing to blur out of. */}
            <SegmentedControl<DistanceUnit>
              aria-label="Distance units"
              value={preferences.distanceUnit}
              options={UNIT_OPTIONS}
              onValueChange={(distanceUnit) => {
                // Not before the first fetch resolves: until then
                // `preferences` is the provider's DEFAULTS, and saving from
                // that state would write a default over a value this Sheet has
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
          </div>
          {unitError !== null && (
            // `text-danger-ink`, the same token `FormField` renders its own
            // error with — not a hand-rolled colour. The colour wall exists to
            // catch exactly the arbitrary value this line first carried.
            <Text variant="muted" className="mt-2 text-danger-ink">
              {unitError}
            </Text>
          )}
        </div>
      </div>
    </Sheet>
  );
}
