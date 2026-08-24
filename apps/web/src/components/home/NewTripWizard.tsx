"use client";

import { useState } from "react";
import type { Money } from "@tc/contracts";
import type { ApiResult, BoardCommand } from "@/lib/apiClient";
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

// Illustrative only (Preview id="wizard-invite-list", M13 — TripMember.role
// is the literal string "owner", so there is no one else to list yet).
const INVITE_SHAPE = [{ name: "You", role: "Owner" }] as const;

// Illustrative only (Preview id="wizard-pace-tags", M9 — pace and tags exist
// only to feed the assistant's draft, which doesn't exist yet).
const PACE_OPTIONS = [
  { value: "slow", label: "Slow" },
  { value: "balanced", label: "Balanced" },
  { value: "packed", label: "Packed" },
] as const;
type PaceValue = (typeof PACE_OPTIONS)[number]["value"];
const TAG_CHIP_SHAPE = ["Food", "Art", "Hiking", "Nightlife", "Markets", "Architecture"] as const;

// Inclusive-length day arithmetic, the reverse of lib/dates.ts's daySpan: a
// chip picking N days from arrival A gives endDate = A + (N-1) days. Same
// pure-UTC style as that file's daySpan/dayLabel (the domain never reads
// dates, so this stays local Date.UTC arithmetic, never a bare `new Date()`
// parse of a date string) — no packages/domain import allowed here.
function addDaysIso(startIso: string, days: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type NewTripWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createTrip: (input: { name: string }) => Promise<ApiResult<{ tripId: string }>>;
  dispatch: (command: BoardCommand) => void;
  // Called once the trip exists, after any dates/budget dispatches have been
  // fired — the caller's hook for navigating to the new trip.
  onCreated?: (tripId: string) => void;
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
          onDone={(tripId) => {
            onOpenChange(false);
            if (tripId !== null) onCreated?.(tripId);
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
  onDone: (tripId: string | null) => void;
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
    const result = await createTrip({ name: trimmedName });
    if (!result || !result.ok) {
      setError(result?.error?.message ?? "Something went wrong");
      setSubmitting(false);
      return;
    }
    const { tripId } = result.value;
    if (applyDatesAndBudget) {
      // Sequence per the plan: create with the name, then apply dates and
      // budget to the returned tripId. Each only fires if the user actually
      // gave it something — a fresh trip already has no dates and USD/no
      // budget, so an untouched field needs no command at all.
      if (arrive !== "" && selectedDays !== null) {
        const endDate = addDaysIso(arrive, selectedDays - 1);
        const newDayIds = Array.from({ length: selectedDays }, () => crypto.randomUUID());
        dispatch({ type: "SetTripDates", tripId, startDate: arrive, endDate, newDayIds });
      }
      if (budget !== null) {
        dispatch({ type: "SetTripBudget", tripId, budget });
      }
      if (currency !== DEFAULT_CURRENCY) {
        dispatch({ type: "SetTripCurrency", tripId, currency });
      }
    }
    setSubmitting(false);
    onDone(tripId);
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
          {arrive !== "" && selectedDays !== null && (
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
            <Preview id="wizard-invite-list" size="container" className="p-1.5">
              <div className="flex flex-col gap-1.5">
                {INVITE_SHAPE.map((member) => (
                  <div key={member.name} className="flex items-center gap-2.5 px-1.5 py-1">
                    <span className="size-6 shrink-0 rounded-full bg-moss" aria-hidden />
                    <Text as="span" className="flex-1 text-sm text-ink">
                      {member.name}
                    </Text>
                    <Text as="span" variant="muted">
                      {member.role}
                    </Text>
                  </div>
                ))}
              </div>
            </Preview>
          </div>
          <div
            className="grid gap-2.5"
            // eslint-disable-next-line no-restricted-syntax -- same 1fr/130px budget-input split as TripMoneySettings, no token equivalent
            style={{ gridTemplateColumns: "1fr 130px" }}
          >
            <FormField
              id="wizard-budget"
              label="Total for the trip"
              description="Used for the over-budget warning across lenses."
            >
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
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))}>
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
