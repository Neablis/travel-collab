import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Money, TripCommand, TripDetail, TripRole } from "@tc/contracts";
import type { TripCounts } from "./TripMetaPill";
import type { TripSpend } from "@/lib/cost";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const duplicateTripMock = vi.fn();
// The sheet mounts a real ShareButton now (under "Who is invited"), and that
// component reads four more exports off this module. A factory mock replaces
// the WHOLE module, so a missing export is a runtime throw the first time the
// share panel is opened — these are stubbed rather than the component being
// mocked out, because "Share is really there and really gated" is the thing
// these tests exist to say.
const fetchTripSharesMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
  duplicateTrip: (...args: unknown[]) => duplicateTripMock(...args),
  fetchTripShares: (...args: unknown[]) => fetchTripSharesMock(...args),
  createTripShare: vi.fn(),
  revokeTripShare: vi.fn(),
  shareLink: (token: string) => `http://test/s/${token}`,
}));

// The Travelers section is TravelersPanel's own surface (and its own test
// file) as of M11 link 3; it fetches /api/trips/:id/access on mount, which
// this file's tests neither stub nor care about.
vi.mock("@/components/trip/TravelersPanel", () => ({
  TravelersPanel: ({ tripId }: { tripId: string }) => <div data-testid="travelers-panel">{tripId}</div>,
}));

import { SettingsSheet } from "./SettingsSheet";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

afterEach(cleanup);

beforeEach(() => {
  pushMock.mockReset();
  sendTripCommandMock.mockReset();
  duplicateTripMock.mockReset();
  fetchTripSharesMock.mockReset().mockResolvedValue({ ok: true, value: [] });
});

const defaultSpend: TripSpend = {
  total: 150_000,
  unpriced: 2,
  budget: 500_000,
  remaining: 350_000,
  over: false,
};

// Existing A15 helper, extended (not replaced) with the two new required
// props (#5, controller ruling) — every existing call site below keeps
// working unchanged since both take defaults. Further extended (this task)
// with an optional onCommand override so the Dates-row wiring tests can
// capture what the sheet forwards, without inventing a second render helper.
function renderSheet(
  onDeleted = vi.fn(),
  overrides: {
    spend?: TripSpend;
    forkedFrom?: TripDetail["forkedFrom"];
    myRole?: TripRole | null;
    // Defaults to null. The money controls that only exist once a trip HAS a
    // budget — the clear-X, and a currency select worth changing — cannot be
    // exercised without this.
    budget?: Money | null;
    /** The trip's genesis — for a copy, the moment it was taken. */
    createdAt?: string;
    onCommand?: (command: TripCommand) => void;
    // The header's meta-pill figures, restated in the sheet so hiding that
    // pill below 768px loses nothing (TripHeader).
    counts?: TripCounts;
  } = {},
) {
  const onCommand = overrides.onCommand ?? vi.fn();
  render(
    <SettingsSheet
      tripId={tripId}
      tripName="Japan"
      open
      onOpenChange={vi.fn()}
      startDate={null}
      endDate={null}
      dayCount={0}
      counts={overrides.counts ?? { days: 3, stops: 12, cities: 2 }}
      currency="USD"
      budget={overrides.budget ?? null}
      spend={overrides.spend ?? defaultSpend}
      forkedFrom={overrides.forkedFrom ?? null}
      createdAt={overrides.createdAt ?? "2026-08-31T14:20:00.000Z"}
      {...{ myRole: "myRole" in overrides ? overrides.myRole! : "owner" }}
      onCommand={onCommand}
      onDeleted={onDeleted}
    />,
  );
  return { onDeleted, onCommand };
}

// New helper for the redesign's own coverage (brief's Step 1 snippets) — a
// thin wrapper around renderSheet that makes the budget-remaining override
// (the thing every new test below actually varies) a one-liner.
function renderSettings(
  opts: { open?: boolean; budgetRemaining?: number | null } = {},
) {
  const remaining = "budgetRemaining" in opts ? opts.budgetRemaining! : defaultSpend.remaining;
  const spend: TripSpend = {
    ...defaultSpend,
    remaining,
    over: remaining !== null && remaining < 0,
  };
  renderSheet(vi.fn(), { spend });
}

// Renaming lives here now: PR #55's preview feedback removed the header's
// pencil and made the title open this sheet, so this field went from readOnly
// to being the only way to rename a trip.
describe("SettingsSheet rename", () => {
  it("dispatches SetTripName on blur", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    await userEvent.type(field, "Japan 2027");
    await userEvent.tab();

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripName", name: "Japan 2027" }),
    );
  });

  // CodeRabbit, PR #55: the trimmed name was dispatched but the raw text was
  // left in the field, so the input disagreed with the trip it had just
  // renamed.
  it("shows the saved name, not the raw text, when the input had surrounding whitespace", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    await userEvent.type(field, "  Japan 2027  ");
    await userEvent.tab();

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripName", name: "Japan 2027" }),
    );
    expect((field as HTMLInputElement).value).toBe("Japan 2027");
  });

  it.each([
    ["unchanged", "Japan"],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("sends nothing and restores the field when the name is %s", async (_label, typed) => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    if (typed !== "") await userEvent.type(field, typed);
    await userEvent.tab();

    expect(onCommand).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("Japan");
  });
});

describe("SettingsSheet redesign (Task 4.2)", () => {
  it("shows the trip name, the dates row and the budget fields", () => {
    renderSettings({ open: true });

    expect(screen.getByLabelText("Trip name")).toBeTruthy();
    expect(screen.getByText("Dates")).toBeTruthy();
    expect(screen.getByLabelText("Total for the trip")).toBeTruthy();
    expect(screen.getByLabelText("Currency")).toBeTruthy();
  });

  it("warns when the trip is over budget", () => {
    renderSettings({ open: true, budgetRemaining: -82_000 });
    // No @testing-library/jest-dom in this repo (grep confirms no other test
    // uses toHaveTextContent) — match textContent directly, same pattern as
    // TripDateControl.test.tsx's dialog-text assertion.
    expect(screen.getByRole("status").textContent).toMatch(/over/i);
  });

  it("does not warn when the trip is within budget", () => {
    renderSettings({ open: true, budgetRemaining: 731_500 });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("counts stops with no cost", () => {
    renderSettings({ open: true });
    expect(screen.getByText(/no cost yet/i)).toBeTruthy();
  });

  it("hides the budget meter (but still shows the status line) when no budget is set", () => {
    const noBudgetSpend: TripSpend = {
      total: 150_000,
      unpriced: 2,
      budget: null,
      remaining: null,
      over: false,
    };
    renderSheet(vi.fn(), { spend: noBudgetSpend });
    expect(screen.queryByTestId("budget-meter-fill")).toBeNull();
    expect(screen.getByText("No budget set")).toBeTruthy();
  });

  // M11 link 3 moved the member list into TravelersPanel (mocked above), so
  // what this sheet is still responsible for is mounting it for THIS trip.
  it("mounts the Travelers panel for this trip", () => {
    renderSettings({ open: true });
    expect(screen.getByTestId("travelers-panel").textContent).toBe(tripId);
  });
});

describe("SettingsSheet Dates row (restored, M10 Phase 4)", () => {
  // Not asserting Popover/TripDateControl's own mechanics — those are
  // Popover's and TripDateControl.test.tsx's tested territory — just that
  // the wiring here is real: clicking the row actually mounts
  // TripDateControl.
  it("opens TripDateControl when the Dates row is clicked", async () => {
    renderSheet();

    expect(screen.queryByLabelText("Trip start date")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));

    expect(await screen.findByLabelText("Trip start date")).toBeTruthy();
  });

  // Task 8b.6: the end is derived, never picked — TripDateControl commits
  // the start alone, via SetTripStartDate, not SetTripDates. Selecting a
  // date now commits immediately (feedback fix, 2026-08-24) — no Done click,
  // and the commit closes the Dates popover itself (same onCommand wrapper
  // the Clear-date X used before this change).
  it("forwards a committed date change to the sheet's own onCommand as SetTripStartDate", async () => {
    const { onCommand } = renderSheet(vi.fn(), { onCommand: vi.fn() });

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));
    await userEvent.type(await screen.findByLabelText("Trip start date"), "2027-01-05");

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId, startDate: "2027-01-05" }),
    );
  });
});

describe("SettingsSheet delete/duplicate (A15)", () => {
  it("confirms before deleting, then reports success (with the outcome) via onDeleted", async () => {
    const outcome = { detail: { status: "deleted" }, history: {} };
    sendTripCommandMock.mockResolvedValue({ ok: true, value: outcome });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    // Confirmation gate: the command isn't sent until the dialog is confirmed.
    expect(sendTripCommandMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId }),
    );
    // A15-fix: the outcome is forwarded alongside the summary so the caller
    // (TripHeader) can feed it into applyOutcome and reconcile trip.status
    // immediately, rather than only after the toast closes.
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({ tripId, name: "Japan" }, outcome));
  });

  it("does not report success when the delete command fails", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 400, message: "nope" } });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("duplicates the trip and navigates to the copy", async () => {
    const newTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";
    duplicateTripMock.mockResolvedValue({ ok: true, value: { tripId: newTripId } });
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /duplicate trip/i }));

    await waitFor(() => expect(duplicateTripMock).toHaveBeenCalledWith(tripId));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${newTripId}`));
  });
});


// M11 link 5 — the visible half of clone-with-lineage.
describe("SettingsSheet lineage", () => {
  it("says nothing about provenance for a trip that started from nothing", () => {
    renderSheet();
    expect(screen.queryByText("Where this came from")).toBeNull();
  });

  // The ancestor and the DATE, never the ancestor's sequence number: "as it was
  // at change 14" was an internal coordinate on a settings screen, and nobody
  // outside this codebase knows what change 14 was (Mitchell, 2026-09-01).
  // `atSeq` is still carried on `forkedFrom`; it is simply not rendered.
  it("names the ancestor and the day it was copied", () => {
    renderSheet(vi.fn(), {
      forkedFrom: { tripId, atSeq: 14, name: "Kyoto in spring" },
      // Midday UTC so the rendered local date is the 31st in every zone the
      // suite might run in — a midnight instant would be the 30th west of
      // Greenwich and make this assertion depend on TZ.
      createdAt: "2026-08-31T12:00:00.000Z",
    });
    expect(screen.getByText("Where this came from")).toBeTruthy();
    // The copy is split across text nodes by the JSX interpolation, so match
    // on the containing span's own text rather than on a text node.
    const line = screen
      .getAllByText(/Copied from/)
      .map((node) => node.textContent)
      .join(" ");
    expect(line).toContain("Kyoto in spring");
    expect(line).toContain("on August 31st 2026");
    expect(line).not.toContain("change");
  });
});

// M11 link 3, found by CodeRabbit on PR #70 and confirmed against the code:
// `handleDelete`/`handleDuplicate` call the API directly rather than through
// TripProvider's optimistic queue (the A15 decision), so TripProvider's
// read-only gate never sees them. A viewer could open this sheet, click
// Delete, confirm, and get silence — the server refused it and `handleDelete`
// only acts `if (result.ok)`.
describe("SettingsSheet role gating", () => {
  it("offers Delete to an owner", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Delete trip" })).toBeTruthy();
  });

  // Gated on `owner`, the rank accessPolicy.ts actually enforces for
  // DeleteTrip — an editor clicking it got the same silent nothing.
  it("does not offer Delete to an editor or a viewer", () => {
    for (const myRole of ["editor", "viewer"] as const) {
      cleanup();
      renderSheet(vi.fn(), { myRole });
      expect(screen.queryByRole("button", { name: "Delete trip" })).toBeNull();
    }
  });

  // A viewer may still clone: a copy takes nothing from the source and grants
  // nothing on it (ADR-028).
  it("still offers Duplicate to a viewer", () => {
    renderSheet(vi.fn(), { myRole: "viewer" });
    expect(screen.getByRole("button", { name: "Duplicate trip" })).toBeTruthy();
  });

  it("disables the rename field for a viewer, and leaves it live for an editor", () => {
    renderSheet(vi.fn(), { myRole: "viewer" });
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(true);
    cleanup();
    renderSheet(vi.fn(), { myRole: "editor" });
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(false);
  });

  // The sheet's comment claims a viewer executes no planning command from
  // here. The rename field alone did not enforce that — Dates and the money
  // controls were still live (CodeRabbit, PR #70). Every mutating control is
  // covered, and dispatch is severed at the source so a control added later
  // is covered too.
  it("offers a viewer no live mutating control at all", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { myRole: "viewer", onCommand });

    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Dates" }).hasAttribute("disabled")).toBe(true);
    // The money controls are disabled by their enclosing <fieldset>, which
    // disables descendants without stamping the attribute on each one — so
    // the fieldset is what carries it.
    expect(screen.getByLabelText("Total for the trip").closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByLabelText("Currency").closest("fieldset")?.disabled).toBe(true);

    // And the behavioural claim, which is the one that actually matters:
    // nothing reachable from this sheet dispatches for a viewer.
    await userEvent.click(screen.getByRole("button", { name: "Dates" })).catch(() => undefined);
    expect(screen.queryByLabelText("Trip start date")).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("leaves every one of those live for an editor", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { myRole: "editor", onCommand });

    expect(screen.getByRole("button", { name: "Dates" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByLabelText("Total for the trip").closest("fieldset")?.disabled).toBe(false);
    expect(screen.getByLabelText("Currency").closest("fieldset")?.disabled).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));
    expect(await screen.findByLabelText("Trip start date")).toBeTruthy();
  });

  // The two tests above render with no budget, which is the default. That
  // leaves the money half proven only structurally — `fieldset.disabled` is
  // asserted, but nothing behavioural is, and the clear-X does not exist to
  // be asserted about at all: it renders only when `budget !== null`, behind
  // its own `&& !disabled` guard. So the guard, and the fieldset's actual
  // hold on the currency select, were both untested (CodeRabbit, PR #70).
  const withBudget: Money = { amountMinor: 500_000, currency: "USD" };

  it("offers a viewer with a budget no way to clear or change it", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { myRole: "viewer", budget: withBudget, onCommand });

    // Not merely disabled — not rendered. A disabled clear-X beside a figure
    // still reads as an offer.
    expect(screen.queryByRole("button", { name: "Clear budget" })).toBeNull();

    // …and neither of the controls that DO render dispatches. `.catch` on
    // both because user-event refuses to drive a disabled control, which is
    // the outcome under test rather than a failure of it.
    await userEvent
      .selectOptions(screen.getByLabelText("Currency"), "EUR")
      .catch(() => undefined);
    await userEvent.type(screen.getByLabelText("Total for the trip"), "42{Enter}").catch(() => undefined);
    await userEvent.tab().catch(() => undefined);

    expect(onCommand).not.toHaveBeenCalled();
  });

  // The mirror image, so the assertions above are known to be about the role
  // and not about a control that never worked for anyone.
  it("lets an editor clear and re-currency that same budget", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { myRole: "editor", budget: withBudget, onCommand });

    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripCurrency", tripId, currency: "EUR" });

    await userEvent.click(screen.getByRole("button", { name: "Clear budget" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripBudget", tripId, budget: null });
  });

  // Null while the role read is still in flight or failed. The client is not
  // the security boundary, so an unknown role must not lock the board — but it
  // must not offer a destructive action it cannot vouch for either.
  it("withholds Delete while the role is unknown", () => {
    renderSheet(vi.fn(), { myRole: null });
    expect(screen.queryByRole("button", { name: "Delete trip" })).toBeNull();
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(false);
  });
});

// Mitchell, Vercel toolbar comment on `/trips/:id?lens=Map&view=Calendar` at
// 411x760: "all three columns from share, trip overview to budget are really
// crowded and ugly on mobile, if we hid them here would they still be
// accessible in trip settings?" — the honest answer was "budget and dates yes,
// Share and the stop/city counts no". This block is the "no" half being made
// true, and it is the half worth pinning: TripHeader hides the pill, the
// budget chip and Share below 768px, and a regression that quietly dropped
// either of these from the sheet would make those things unreachable on a
// phone rather than merely relocated.
describe("SettingsSheet trip overview (the hidden meta pill's counts)", () => {
  it("states the day, stop and city counts the header pill states", () => {
    renderSheet(vi.fn(), { counts: { days: 5, stops: 14, cities: 3 } });

    expect(screen.getByText("5 days")).toBeTruthy();
    expect(screen.getByText("14 stops")).toBeTruthy();
    expect(screen.getByText("3 cities")).toBeTruthy();
  });

  // Read-only by design: every figure is derived from the plan, so it is a
  // statement rather than a field. Asserted so "make them editable" is a
  // deliberate decision rather than an accident.
  it("shows them to a viewer too, since they are a statement and not a control", () => {
    renderSheet(vi.fn(), { myRole: "viewer", counts: { days: 5, stops: 14, cities: 3 } });

    expect(screen.getByText("5 days")).toBeTruthy();
    expect(screen.getByText("14 stops")).toBeTruthy();
    expect(screen.getByText("3 cities")).toBeTruthy();
  });
});

describe("SettingsSheet share", () => {
  // The whole point of mounting it here: below 768px this is the ONLY Share
  // in the app for the trip you are looking at (ShareButton has exactly two
  // mount points, this sheet and TripHeader, and the header's is hidden on a
  // phone).
  it("offers Share, and it opens its own panel inside the sheet", async () => {
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    // Nested Radix overlays: the popover portals out of the sheet's own
    // subtree, so this also pins that it renders and stays operable at all.
    expect(await screen.findByTestId("share-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a share link" })).toBeTruthy();
  });

  // Same rule as the header's `!readOnly`, which is TripProvider's identical
  // `myRole === "viewer"` — withheld, not disabled, exactly as Delete is for a
  // non-owner (a disabled Share still reads as an offer, KI-64). This is also
  // what keeps /demo honest: a demo visitor resolves as a `viewer`
  // server-side (ADR-031, server/access/trip-access.ts), so they lose Share in
  // the sheet exactly as they already lose it in the header.
  it("withholds Share from a viewer and offers it to an editor and an owner", () => {
    renderSheet(vi.fn(), { myRole: "viewer" });
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();

    for (const myRole of ["editor", "owner"] as const) {
      cleanup();
      renderSheet(vi.fn(), { myRole });
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    }
  });
});
