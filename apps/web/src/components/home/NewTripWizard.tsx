"use client";

import { useState } from "react";
import type { Money } from "@tc/contracts";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { Sheet } from "@/components/ui/sheet";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { MoneyInput } from "@/components/board/MoneyInput";
import { addDaysIso } from "@/lib/dates";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";

const STEP_LABELS = ["Where", "When", "Who & Money", "Shape"] as const;
const TOTAL_STEPS = STEP_LABELS.length;

// The length chips, verbatim (`Trip Planner Redesign.dc.html:3440`'s
// lengthChips): four real day counts read off the labels themselves and off
// the design's New Orleans card ("Long weekend, four days"). `Longer` has no
// day count the design implies (Mitchell, 2026-08-23 decision) — it ships as
// an inert Preview badge below, not one of these.
const LENGTH_CHIPS: { label: string; days: number }[] = [
  { label: "Long weekend", days: 4 },
  { label: "A week", days: 7 },
  { label: "10 days", days: 10 },
  { label: "2 weeks", days: 14 },
];

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"] as const;
const DEFAULT_CURRENCY = "USD";

// Illustrative only (Preview id="wizard-destination-chips", M11 — no
// destination field exists on TripSummary/TripDetail, so there is nothing
// real "recent and nearby" could read from). Copy lifted verbatim from the
// design's own destChips fixture.
const DESTINATION_CHIP_SHAPE = ["Lisbon", "Mexico City", "Seoul", "Copenhagen", "Big Sur", "Back to Kyoto"] as const;

// Illustrative only (Preview id="wizard-pace-tags", M9 — pace and tags exist
// only to feed the assistant's draft, which doesn't exist yet).
const PACE_OPTIONS = [
  { value: "slow", label: "Slow" },
  { value: "balanced", label: "Balanced" },
  { value: "packed", label: "Packed" },
] as const;
type PaceValue = (typeof PACE_OPTIONS)[number]["value"];
const TAG_CHIP_SHAPE = ["Food", "Art", "Hiking", "Nightlife", "Markets", "Architecture"] as const;

// A native <input type="date">'s `value` is spec'd to be either "" or a
// complete valid date, but was observed (manual verification, Phase 7) to
// briefly carry a non-empty, not-yet-complete string while a day segment is
// mid-edit (e.g. typing month/day/year one keystroke at a time) — `arrive`'s
// onChange fires on that intermediate value before it settles. Same shape as
// packages/contracts/src/trip.ts's private ISO_DATE; UI can't import that
// (module map, AGENTS.md), and this is a plain regex literal, not domain
// logic.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Inclusive-length day arithmetic below uses lib/dates.ts's addDaysIso: a chip
// picking N days from arrival A gives endDate = A + (N-1) days. Every call is
// gated on ISO_DATE.test(arrive) first (see above) — addDaysIso throws on an
// incomplete intermediate value rather than returning garbage.

export type NewTripWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createTrip: (input: { name: string }) => Promise<ApiResult<{ tripId: string }>>;
  // Awaited, not fire-and-forget (CodeRabbit, PR #32): submit() waits for
  // each dispatched command to confirm — or report a real failure — before
  // navigating, rather than racing an in-flight SetTripDates/Budget/Currency
  // against the trip page's own first load.
  dispatch: (command: BoardCommand) => Promise<ApiResult<CommandOutcome>>;
  // Called once the trip exists AND every dispatched command it needed has
  // confirmed. `navigate` is true only for the full wizard's "Create trip"
  // (step 4) — the phase doc's own sequence is "create... apply dates and
  // budget... then navigate." "Create empty" is explicitly the old
  // single-field dialog's escape hatch, and that dialog never navigated —
  // it closed and left the user on the trip list to open the new (still
  // otherwise-identical) card themselves. Every pre-Phase-7 e2e spec is
  // built on that: they all click Create-empty-or-equivalent, then click
  // the trip's own list link to navigate — a version of this that always
  // navigated broke every one of them (CI, PR #32) by leaving the home
  // page (and that link) before the click ever ran.
  onCreated?: (tripId: string, opts: { navigate: boolean }) => void;
};

export function NewTripWizard({ open, onOpenChange, createTrip, dispatch, onCreated }: NewTripWizardProps) {
  return (
    <Sheet title="New trip" open={open} onOpenChange={onOpenChange}>
      {/* Mirrors ActivityEditorSheet's `{open && (...)}` guard: forces a
          fresh mount (and so fresh local state) every time the wizard is
          reopened, rather than reusing whatever was left over from a
          previous open/cancel. */}
      {open && (
        <WizardBody
          createTrip={createTrip}
          dispatch={dispatch}
          onDone={(tripId, navigate) => {
            onOpenChange(false);
            if (tripId !== null) onCreated?.(tripId, { navigate });
          }}
        />
      )}
    </Sheet>
  );
}

function WizardBody({
  createTrip,
  dispatch,
  onDone,
}: {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [arrive, setArrive] = useState("");
  const [selectedDays, setSelectedDays] = useState<number | null>(null);
  const [budget, setBudget] = useState<Money | null>(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [pace, setPace] = useState<PaceValue>(PACE_OPTIONS[1].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once createTrip succeeds, so a retry after a failed dates/budget
  // dispatch re-sends only the failed commands rather than calling
  // createTrip again and minting a second trip (CodeRabbit, PR #32 — the
  // original version fired every dispatch without awaiting it and navigated
  // regardless of whether any of them actually confirmed).
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);

  const trimmedName = name.trim();

  // Shared by both submit paths. On success, applies whatever real dates/
  // budget/currency the user staged (only for the full wizard path — the
  // caller decides whether to call this with those fields populated) and
  // hands the new tripId back. On failure, surfaces the error inline and
  // keeps the sheet open, same as the single-field dialog this replaces.
  async function submit(applyDatesAndBudget: boolean) {
    if (trimmedName === "" || submitting) return;
    setError(null);
    setSubmitting(true);

    let tripId = createdTripId;
    if (tripId === null) {
      const result = await createTrip({ name: trimmedName });
      if (!result || !result.ok) {
        setError(result?.error?.message ?? "Something went wrong");
        setSubmitting(false);
        return;
      }
      tripId = result.value.tripId;
      setCreatedTripId(tripId);
    }

    if (applyDatesAndBudget) {
      // Sequence per the plan: create with the name, then apply dates and
      // budget to the returned tripId. Each only fires if the user actually
      // gave it something — a fresh trip already has no dates and USD/no
      // budget, so an untouched field needs no command at all. Awaited and
      // checked in turn — a failed command stops here with an inline error
      // rather than navigating past it, and the trip (already real at this
      // point) is left exactly as far along as it got.
      if (ISO_DATE.test(arrive) && selectedDays !== null) {
        const endDate = addDaysIso(arrive, selectedDays - 1);
        const newDayIds = Array.from({ length: selectedDays }, () => crypto.randomUUID());
        const result = await dispatch({ type: "SetTripDates", tripId, startDate: arrive, endDate, newDayIds });
        if (!result.ok) {
          setError(`Trip created, but setting dates failed: ${result.error.message}. Try again.`);
          setSubmitting(false);
          return;
        }
      }
      if (budget !== null) {
        const result = await dispatch({ type: "SetTripBudget", tripId, budget });
        if (!result.ok) {
          setError(`Trip created, but setting the budget failed: ${result.error.message}. Try again.`);
          setSubmitting(false);
          return;
        }
      }
      if (currency !== DEFAULT_CURRENCY) {
        const result = await dispatch({ type: "SetTripCurrency", tripId, currency });
        if (!result.ok) {
          setError(`Trip created, but setting the currency failed: ${result.error.message}. Try again.`);
          setSubmitting(false);
          return;
        }
      }
    }
    setSubmitting(false);
    onDone(tripId, applyDatesAndBudget);
  }

  const nextDisabled = step === 1 && trimmedName === "";
  const createEmptyDisabled = trimmedName === "" || submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber <= step;
          return (
            <div key={label} data-testid="wizard-step" className="flex flex-1 flex-col gap-1">
              <span aria-hidden className={cn("block h-1 rounded-full", isActive ? "bg-brand" : "bg-hairline")} />
              <Text variant="muted" className={cn(stepNumber === step && "font-medium text-ink")}>
                {label}
              </Text>
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-3.5">
          <FormField id="wizard-trip-name" label="Trip name">
            <Input
              id="wizard-trip-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Japan"
              aria-label="Trip name"
            />
          </FormField>
          <div>
            <Text variant="muted" className="mb-1.5">
              Recent and nearby
            </Text>
            <Preview id="wizard-destination-chips" size="container" className="flex flex-wrap gap-1.5 p-1.5">
              {DESTINATION_CHIP_SHAPE.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-hairline bg-surface px-3 py-1 text-sm text-ink"
                >
                  {label}
                </span>
              ))}
            </Preview>
          </div>
          <Preview id="wizard-playbook-panel" size="container" className="p-3.5">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Text className="font-semibold text-ink">Start from a Playbook</Text>
                <Text variant="secondary" className="mt-0.5">
                  You have 5 saved days. Build the trip around one.
                </Text>
              </div>
              <Button type="button" variant="secondary" size="sm">
                Browse
              </Button>
            </div>
          </Preview>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3.5">
          <div>
            <Text variant="muted" className="mb-1.5">
              How long?
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {LENGTH_CHIPS.map((chip) => (
                <Button
                  key={chip.label}
                  type="button"
                  variant={selectedDays === chip.days ? "primary" : "secondary"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setSelectedDays(chip.days)}
                >
                  {chip.label}
                </Button>
              ))}
              {/* Longer: an escape hatch to a manual day count the design
                  implies but never gives a number for (Mitchell, 2026-08-23
                  — see the plan's decision note). Ships inert, no click
                  handler, rather than inventing a length. */}
              <Preview id="wizard-longer-chip" size="compact">
                <span className="rounded-full border border-hairline bg-surface px-3 py-1 text-sm text-ink">
                  Longer
                </span>
              </Preview>
            </div>
          </div>
          <FormField id="wizard-arrive" label="Arrive">
            <Input
              id="wizard-arrive"
              type="date"
              value={arrive}
              onChange={(e) => setArrive(e.target.value)}
              aria-label="Arrive"
            />
          </FormField>
          {/* Real, not Preview: both start and length come from real state
              above, so this is honest derived data, not a fabricated note. */}
          {ISO_DATE.test(arrive) && selectedDays !== null && (
            <Banner variant="info">
              {selectedDays} days — {formatTripDate(arrive)} to {formatTripDate(addDaysIso(arrive, selectedDays - 1))}.
            </Banner>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <Text variant="muted" className="mb-1.5">
              Who is coming?
            </Text>
            {/* M11 link 3 retired <Preview id="wizard-invite-list"> — the
                mocked "You / Owner" row it showed. Inviting is real now, but
                it needs a trip to invite someone TO: an invite is a row
                against a tripId (packages/contracts/src/access.ts), and this
                step runs before CreateTrip. Collecting addresses here and
                replaying them after creation would be a second, hidden invite
                path with its own failure mode (the trip exists, the invites
                silently did not), for a wizard step that is one click from the
                real one. So this says where invites live instead of pretending
                to be them — honest, and not a shell. */}
            <Text as="span" className="text-sm text-ink">
              Just you, for now — invite people from Trip settings once the trip
              exists.
            </Text>
          </div>
          <div
            className="grid gap-2.5"
            // eslint-disable-next-line no-restricted-syntax -- same 1fr/130px budget-input split as TripMoneySettings, no token equivalent
            style={{ gridTemplateColumns: "1fr 130px" }}
          >
            {/* `hint` (renders below the input), not `description` (renders
                between the label and the input) — the Currency field beside
                this one has no description, so a description here pushed this
                row's input down out of alignment with Currency's select
                (Mitchell, preview comment on PR #60). This is the identical
                defect that TripMoneySettings already carries for the same
                two fields — see the matching comment there. Neither field
                has helper copy now: "Used for the over-budget warning across
                lenses." was dropped from both in the 2026-08-30 design pass,
                which keeps their Label→input distance identical. */}
            <FormField id="wizard-budget" label="Total for the trip">
              <MoneyInput id="wizard-budget" value={budget} currency={currency} onChange={setBudget} />
            </FormField>
            <FormField id="wizard-currency" label="Currency">
              <NativeSelect
                id="wizard-currency"
                aria-label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <Preview id="wizard-pace-tags" size="container" className="p-3.5">
            <div className="flex flex-col gap-4">
              <div>
                <Text variant="muted" className="mb-1.5">
                  Pace
                </Text>
                <SegmentedControl value={pace} onValueChange={setPace} options={PACE_OPTIONS} aria-label="Pace" />
              </div>
              <div>
                <Text variant="muted" className="mb-1.5">
                  What the trip is about
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_CHIP_SHAPE.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-hairline bg-surface px-3 py-1 text-sm text-ink"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Preview>
          <Preview id="wizard-assistant-draft" size="container" className="bg-brand-tint p-3.5">
            <Text className="font-semibold text-brand-pressed">Let the assistant draft it</Text>
            <Text variant="secondary" className="mt-0.5 text-brand-pressed">
              Once you say go, the assistant lays out your days at the pace you pick, leaves the bookings to you, and
              flags anything that needs a decision.
            </Text>
          </Preview>
        </div>
      )}

      {error !== null && (
        <Text as="p" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}

      <DialogFooter>
        {step > 1 && (
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Back
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={createEmptyDisabled} onClick={() => void submit(false)}>
          Create empty
        </Button>
        {step < TOTAL_STEPS ? (
          <Button
            type="button"
            variant="primary"
            disabled={nextDisabled}
            onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
          >
            Next
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled={submitting} onClick={() => void submit(true)}>
            Create trip
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
