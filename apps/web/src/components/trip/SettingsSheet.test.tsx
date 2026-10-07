import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Money, TripCommand, TripDetail } from "@tc/contracts";
import type { TripCounts } from "./TripMetaPill";
import type { TripSpend } from "@/lib/cost";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const duplicateTripMock = vi.fn();
// The sheet mounts a real ShareButton now (under "Read-only snapshots"), and that
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

// The People section is its own surface with its own suites
// (`people/*.test.tsx`); it fetches /api/trips/:id/access on mount, which this
// file's tests neither stub nor care about.
vi.mock("@/components/trip/people/PeopleSection", () => ({
  PeopleSection: ({ tripId }: { tripId: string }) => <div data-testid="people-section">{tripId}</div>,
}));

// The cover section likewise has its own suite (`cover/CoverSection.test.tsx`)
// and its own reads. What this file says about it is where it sits and who
// may edit it, so the stub reports exactly that.
// *Settle cover* stands for its opening reads landing (`onSettled`).
vi.mock("@/components/trip/cover/CoverSection", () => ({
  CoverSection: ({ canEdit, onSettled }: { canEdit: boolean; onSettled?: () => void }) => (
    <>
      <div data-testid="cover-section">{canEdit ? "editable" : "read-only"}</div>
      <button type="button" onClick={() => onSettled?.()}>
        Settle cover
      </button>
    </>
  ),
}));

import { SettingsSheet } from "./SettingsSheet";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

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
  estimated: 0,
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
  overrides: {
    spend?: TripSpend;
    forkedFrom?: TripDetail["forkedFrom"];
    // TripProvider's `readOnly`, which the header hands the sheet: true for a
    // viewer and a suggester. Which role maps to which is the provider's rule,
    // asserted through it in TripHeader.test.tsx, not restated here.
    readOnly?: boolean;
    // TripProvider's `canEditBoard`. Defaults to `!readOnly` — a viewer or a
    // writer; a suggester is the one pair that differs (readOnly and may edit).
    canEditBoard?: boolean;
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
    /** Which trip the sheet is for. The demo trip's id is the one that matters. */
    tripId?: string;
    /** The section the sheet was opened at. */
    scrollTo?: "people" | "cover" | null;
  } = {},
) {
  const onCommand = overrides.onCommand ?? vi.fn();
  render(
    <SettingsSheet
      tripId={overrides.tripId ?? tripId}
      tripName="Japan"
      open
      onOpenChange={vi.fn()}
      startDate={null}
      endDate={null}
      counts={overrides.counts ?? { days: 3, stops: 12, cities: 2 }}
      currency="USD"
      budget={overrides.budget ?? null}
      spend={overrides.spend ?? defaultSpend}
      forkedFrom={overrides.forkedFrom ?? null}
      createdAt={overrides.createdAt ?? "2026-08-31T14:20:00.000Z"}
      readOnly={overrides.readOnly ?? false}
      canEditBoard={overrides.canEditBoard ?? !(overrides.readOnly ?? false)}
      scrollTo={overrides.scrollTo ?? null}
      onCommand={onCommand}
    />,
  );
  return { onCommand };
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
  renderSheet({ spend });
}

// Renaming lives here now: PR #55's preview feedback removed the header's
// pencil and made the title open this sheet, so this field went from readOnly
// to being the only way to rename a trip.
describe("SettingsSheet rename", () => {
  it("dispatches SetTripName on blur", async () => {
    const onCommand = vi.fn();
    renderSheet({ onCommand });

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
    renderSheet({ onCommand });

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
    renderSheet({ onCommand });

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

  // ADR-060 decision 5: a pending stop's cost is an estimate, and the budget
  // line says how much of the total that is. The figures are `tripSpend`'s;
  // what this sheet owns is printing the split, and only when there is one.
  it("splits the total into committed and estimated when part of it is pending", () => {
    renderSheet({ spend: { ...defaultSpend, estimated: 40_000 } });
    expect(screen.getByTestId("budget-committed").textContent).toBe("$1,100.00 committed · $400.00 estimated");
  });

  it("prints no split when nothing in the total is an estimate", () => {
    renderSheet();
    expect(screen.queryByTestId("budget-committed")).toBeNull();
  });

  it("counts stops with no cost", () => {
    renderSettings({ open: true });
    expect(screen.getByText(/no cost yet/i)).toBeTruthy();
  });

  it("hides the budget meter (but still shows the status line) when no budget is set", () => {
    const noBudgetSpend: TripSpend = {
      total: 150_000,
      estimated: 0,
      unpriced: 2,
      budget: null,
      remaining: null,
      over: false,
    };
    renderSheet({ spend: noBudgetSpend });
    expect(screen.queryByTestId("budget-meter-fill")).toBeNull();
    expect(screen.getByText("No budget set")).toBeTruthy();
  });

  // The member list is PeopleSection's (mocked above), so what this sheet is
  // still responsible for is mounting it for THIS trip, under the `#people`
  // anchor the header's avatar stack opens the sheet at (travellers D10).
  it("mounts the People section for this trip, at the people anchor", () => {
    renderSettings({ open: true });
    const section = screen.getByTestId("people-section");
    expect(section.textContent).toBe(tripId);
    // eslint-disable-next-line testing-library/no-node-access -- the anchor is an id on the wrapper, which no role or label reaches
    expect(section.closest("#people")).not.toBeNull();
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
    const { onCommand } = renderSheet({ onCommand: vi.fn() });

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));
    await userEvent.type(await screen.findByLabelText("Trip start date"), "2027-01-05");

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId, startDate: "2027-01-05" }),
    );
  });
});

// M26 link 6a, DRIFT D13, SPEC §34.2 and §27: lifecycle lives on the trip
// card's popover on Home, not inside the trip. What stood here were three A15
// tests asserting the opposite; they are replaced rather than deleted, because
// "Delete is gone" is a claim worth holding — a future tidy-up that puts a
// Delete back here would otherwise pass silently.
describe("SettingsSheet — lifecycle is not here (M26 link 6a)", () => {
  it("offers neither Delete nor Duplicate", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: /^delete trip$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /duplicate trip/i })).toBeNull();
  });

  // The confirm dialog went with them, and it was arguing against itself:
  // "You can undo this from the toast that follows" is a modal explaining that
  // the action it guards is reversible — §27's own reason for having no modal.
  it("has no confirm dialog left to argue with itself", () => {
    renderSheet();
    expect(screen.queryByText(/undo this from the toast/i)).toBeNull();
  });

  // Download is the one thing that stays. It was under a `Take it with you`
  // heading (link 6d); Mitchell asked for the heading and the sentence to go
  // and the button to say `Download Trip` (Vercel Toolbar, PR #196 preview,
  // 2026-09-20), so the heading is asserted ABSENT rather than present.
  it("keeps Download, and no longer under a heading", () => {
    renderSheet();
    expect(screen.getByRole("link", { name: /download trip/i })).toBeTruthy();
    expect(screen.queryByText(/take it with you/i)).toBeNull();
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
    renderSheet({
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
  // **No Delete for ANY role** — M26 link 6a moved it to Home's per-card menu,
  // where §27 and §34.2 put it. What stood here were two role-gating tests
  // (owner sees it, editor and viewer do not), and the role gate they asserted
  // is still enforced — on Home, by `viewerOwnsTrip`, and by the server in
  // both places. This asserts the absence across all three roles so a future
  // reader cannot restore it for one of them without noticing.
  it("offers Delete to nobody, whatever their role", () => {
    for (const readOnly of [false, true]) {
      cleanup();
      renderSheet({ readOnly });
      expect(screen.queryByRole("button", { name: "Delete trip" })).toBeNull();
    }
  });

  // Duplicate went the same way, and for a viewer specifically: they could
  // clone from here (ADR-028 — a copy takes nothing from the source and grants
  // nothing on it) and still can, from Home's menu, which offers Duplicate to
  // every role.
  it("offers Duplicate to nobody either", () => {
    for (const readOnly of [false, true]) {
      cleanup();
      renderSheet({ readOnly });
      expect(screen.queryByRole("button", { name: "Duplicate trip" })).toBeNull();
    }
  });

  // **M25 link 2.** The download is a link to the same `v1` endpoint an API
  // caller uses, and a viewer gets it for the same reason they get Duplicate:
  // a copy takes nothing from the source (ADR-028 decision 3).
  it("offers the download to every role, pointed at the v1 export endpoint", () => {
    for (const readOnly of [false, true]) {
      cleanup();
      renderSheet({ readOnly });
      const link = screen.getByRole("link", { name: "Download Trip" });
      expect(link.getAttribute("href")).toBe(`/api/v1/trips/${tripId}/export`);
      expect(link.hasAttribute("download")).toBe(true);
    }
  });

  // **Except on `/demo`** (Mitchell, 2026-10-01). The export is a `v1` route
  // that a session satisfies, and a demo visitor has none, so the link was a
  // 401 dressed as a download. HIDDEN rather than disabled, as every other
  // control the demo has no session for is (KI-64). A signed-in viewer keeps
  // it: the demo is decided by the trip, not by the role.
  it("hides the download on the demo trip, and only there", () => {
    renderSheet({ readOnly: true, tripId: DEMO_TRIP_ID });
    expect(screen.queryByRole("link", { name: "Download Trip" })).toBeNull();
    cleanup();
    renderSheet({ readOnly: true });
    expect(screen.getByRole("link", { name: "Download Trip" })).toBeTruthy();
  });

  // **This asserted the OPPOSITE until 2026-09-20, and the reversal is a
  // decision rather than a regression.** Link 6d added a `Take it with you`
  // heading and the sentence *"Its history does not travel: an imported trip
  // starts fresh, with no undo, redo or revert"*, because that fact was real
  // and buried in a comment (`bundle/fromTrip.ts`) only the next developer
  // would read. Mitchell, on the PR #196 preview: *"drop all the extra text
  // for download a trip, and just have button at bottom that says 'Download
  // Trip'"*. His call, and the surface is his.
  //
  // Kept as a test rather than deleted, pointing the other way, so the
  // sentence cannot drift back in without somebody meeting this and deciding
  // again. The fact itself is still true and still only in that comment —
  // flagged to him on the thread.
  it("says nothing about history beside the download", () => {
    renderSheet({ readOnly: false });
    expect(screen.getByRole("link", { name: "Download Trip" })).toBeTruthy();
    expect(screen.queryByText(/history does not travel/i)).toBeNull();
    expect(screen.queryByText(/no undo, redo or revert/i)).toBeNull();
  });

  it("disables the rename field for a viewer, and leaves it live for an editor", () => {
    renderSheet({ readOnly: true });
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(true);
    cleanup();
    renderSheet({ readOnly: false });
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(false);
  });

  // The sheet's comment claims a viewer executes no planning command from
  // here. The rename field alone did not enforce that — Dates and the money
  // controls were still live (CodeRabbit, PR #70). Every mutating control is
  // covered, and dispatch is severed at the source so a control added later
  // is covered too.
  it("offers a viewer no live mutating control at all", async () => {
    const onCommand = vi.fn();
    renderSheet({ readOnly: true, onCommand });

    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Dates" }).hasAttribute("disabled")).toBe(true);
    // The money controls are disabled by their enclosing <fieldset>, which
    // disables descendants without stamping the attribute on each one — so
    // the fieldset is what carries it.
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByLabelText("Total for the trip").closest("fieldset")?.disabled).toBe(true);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByLabelText("Currency").closest("fieldset")?.disabled).toBe(true);

    // And the behavioural claim, which is the one that actually matters:
    // nothing reachable from this sheet dispatches for a viewer.
    await userEvent.click(screen.getByRole("button", { name: "Dates" })).catch(() => undefined);
    expect(screen.queryByLabelText("Trip start date")).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("leaves every one of those live for an editor", async () => {
    const onCommand = vi.fn();
    renderSheet({ readOnly: false, onCommand });

    expect(screen.getByRole("button", { name: "Dates" }).hasAttribute("disabled")).toBe(false);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByLabelText("Total for the trip").closest("fieldset")?.disabled).toBe(false);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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
    renderSheet({ readOnly: true, budget: withBudget, onCommand });

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
    renderSheet({ readOnly: false, budget: withBudget, onCommand });

    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripCurrency", tripId, currency: "EUR" });

    await userEvent.click(screen.getByRole("button", { name: "Clear budget" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripBudget", tripId, budget: null });
  });

  // An unknown role (the access read in flight or failed) leaves the sheet
  // live, as it leaves the board (W21). That is the provider's call now, so it
  // is asserted through the provider: TripHeader.test.tsx, "Trip settings is
  // gated by the provider's readOnly". Delete is withheld from every reader
  // above.
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
  // Read-only by design, and shown to every role: every figure is derived from
  // the plan, so it is a statement rather than a field. The role table is what
  // says so — a viewer sees the same three counts as an owner, so "make them
  // editable" (or withhold them) has to be a deliberate change rather than an
  // accident of the gating above.
  it.each([
    ["writer", false],
    ["read-only reader", true],
  ] as const)(
    "states the day, stop and city counts the header pill states, to a %s",
    (_reader, readOnly) => {
      renderSheet({ readOnly, counts: { days: 5, stops: 14, cities: 3 } });

      expect(screen.getByText("5 days")).toBeTruthy();
      expect(screen.getByText("14 stops")).toBeTruthy();
      expect(screen.getByText("3 cities")).toBeTruthy();
    },
  );

  // Mitchell, PR #269 preview: "Can there be a more distinct seperator between
  // 14 days, 69 stops, x cities?" — a dot between each, and only between.
  it("separates the three counts with a dot between each", () => {
    renderSheet({ counts: { days: 14, stops: 69, cities: 4 } });
    expect(screen.getByTestId("trip-overview-counts").textContent).toBe("14 days·69 stops·4 cities");
  });
});

describe("SettingsSheet share", () => {
  // The whole point of mounting it here: this is the ONLY Share in the app for
  // the trip you are looking at, at every width. It used to be the only one
  // *below 768px* — the header carried a second copy for desktop — until
  // Mitchell, 2026-09-06: *"Put share in the trip settings under invite
  // someone, both here and in mobile"*.
  it("offers Share, and it opens its own panel inside the sheet", async () => {
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    // Nested Radix overlays: the popover portals out of the sheet's own
    // subtree, so this also pins that it renders and stays operable at all.
    expect(await screen.findByTestId("share-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a share link" })).toBeTruthy();
  });

  // **Under the invite controls, not above them.** Mitchell, 2026-09-06: *"Put
  // share in the trip settings under invite someone"*. The two are the same
  // question at different strengths — who can see this trip — and reading down
  // the section should go: who is already here, invite a named person, or hand
  // out a link that needs no name. On the heading row Share read as a control
  // for the heading, and someone looking for it found it above the thing it
  // belongs with.
  //
  // **Read off the sheet's text, not off `getAllByRole("button")`.** The first
  // cut of this compared the index of "Share" against the index of "Invite
  // someone" among the sheet's buttons — and the member list is MOCKED in this
  // file (top of the file, deliberately: it owns its own suite), so "Invite
  // someone" was never in that list at all. `indexOf` returned -1, every index
  // beat it, and the assertion passed with Share put straight back on the
  // heading row. Text order is document order, and the mock renders the tripId,
  // which is a position in the sheet that actually exists here.
  //
  // Since the travellers spec (§4) Share sits under its own heading, "Read-only
  // snapshots", below People rather than inside it, with one line on how a
  // snapshot differs from an invite.
  it("puts Share under its own Read-only snapshots heading, below People", () => {
    renderSheet();

    const sheet = screen.getByRole("dialog").textContent ?? "";
    const peopleAt = sheet.indexOf(tripId);
    const headingAt = sheet.indexOf("Read-only snapshots");
    const shareAt = sheet.indexOf("Share", headingAt);
    expect(peopleAt).toBeGreaterThan(-1);
    expect(headingAt).toBeGreaterThan(peopleAt);
    expect(shareAt).toBeGreaterThan(headingAt);
    expect(sheet).toContain("Unlike an invite, it adds nobody to the trip.");
  });

  // The header's own `!readOnly`, the one TripProvider value both read —
  // withheld, not disabled, exactly as Delete is for a
  // non-owner (a disabled Share still reads as an offer, KI-64). This is also
  // what keeps /demo honest: a demo visitor resolves as a `viewer`
  // server-side (ADR-031, server/access/trip-access.ts), so they lose Share in
  // the sheet — which is now the only place it could have been lost from.
  it("withholds Share from a read-only reader and offers it to a writer", () => {
    renderSheet({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    // …and its heading with it: a heading over nothing promises a control.
    expect(screen.queryByText("Read-only snapshots")).toBeNull();

    cleanup();
    renderSheet({ readOnly: false });
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  // W8, default closed: a suggester may suggest board edits but writes
  // nothing directly, so every control this sheet gates on `readOnly` stays
  // withheld unless it opts in to suggest mode. The provider hands a suggester
  // `readOnly` and `canEditBoard` both (asserted in TripHeader.test.tsx). The trip fields do (their
  // command joins the draft); Share never does.
  it("leaves a suggester the trip fields, whose edits go to the provider", async () => {
    const onCommand = vi.fn();
    renderSheet({ readOnly: true, canEditBoard: true, onCommand });

    expect(screen.getByRole("button", { name: "Dates" }).hasAttribute("disabled")).toBe(false);
    const name = screen.getByLabelText("Trip name");
    await userEvent.clear(name);
    await userEvent.type(name, "Japan in spring{Enter}");
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripName", tripId, name: "Japan in spring" });
  });

  it("withholds Share from a suggester", () => {
    renderSheet({ readOnly: true, canEditBoard: true });
    // The sheet rendered, so an absent Share is the gate and not an empty tree.
    expect(screen.getByRole("link", { name: "Download Trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});

// M37 part 4: the approved artboard puts Cover photo after the overview and
// before Budget, editable by whoever may write to the trip.
describe("SettingsSheet cover photo", () => {
  it("sits between the trip overview and Budget", () => {
    renderSheet();
    const sheet = screen.getByRole("dialog").textContent ?? "";
    const overviewAt = sheet.indexOf("Trip overview");
    const coverAt = sheet.indexOf("editable");
    expect(overviewAt).toBeGreaterThan(-1);
    expect(coverAt).toBeGreaterThan(overviewAt);
    expect(sheet.indexOf("Budget")).toBeGreaterThan(coverAt);
  });

  // A suggester may edit the trip fields into a draft, but a cover is not a
  // command, and the route refuses them: they read it, as a viewer does.
  it.each([
    ["a writer", { readOnly: false }, "editable"],
    ["a suggester", { readOnly: true, canEditBoard: true }, "read-only"],
    ["a viewer", { readOnly: true }, "read-only"],
  ] as const)("gives %s a cover section that is %s", (_label, gate, expected) => {
    renderSheet(gate);
    expect(screen.getByTestId("cover-section").textContent).toBe(expected);
  });

  it("is not on /demo, whose visitor has no session to read it with", () => {
    renderSheet({ readOnly: true, tripId: DEMO_TRIP_ID });
    // Witness: the sheet rendered its other sections.
    expect(screen.getByText("Trip overview")).toBeTruthy();
    expect(screen.queryByTestId("cover-section")).toBeNull();
  });

  // Cover changes height when its reads land, and the landing does not
  // survive it — People moves, and on a tall screen the scroll is clamped to
  // the top — so the section asked for is landed on again once Cover settles.
  describe("opened at a section", () => {
    // The id of each element landed on: the section anchors.
    const landed: string[] = [];
    beforeEach(() => {
      landed.length = 0;
      Element.prototype.scrollIntoView = function (this: Element) {
        landed.push(this.id);
      };
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it.each(["people", "cover"] as const)("lands on %s again once Cover has settled, and nowhere else", (section) => {
      renderSheet({ scrollTo: section });
      expect(landed).toEqual([section]);
      fireEvent.click(screen.getByRole("button", { name: "Settle cover" }));
      expect(landed).toEqual([section, section]);
    });

    // Opening the Dates popover re-renders the sheet; the landing is the
    // open's, not each render's.
    it("does not land again on an ordinary re-render", async () => {
      renderSheet({ scrollTo: "people" });
      await userEvent.click(screen.getByRole("button", { name: "Dates" }));
      expect(landed).toEqual(["people"]);
    });

    it("lands nowhere, before or after, when opened at its top", () => {
      renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "Settle cover" }));
      // Witness: the stub's settle was reachable.
      expect(screen.getByTestId("cover-section")).toBeTruthy();
      expect(landed).toEqual([]);
    });
  });
});
