import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { historyFixture, tripDetailFixture } from "@tc/factories";
import { ActivityEditorSheet } from "./ActivityEditorSheet";

// Same mocking pattern TripHeader.test.tsx uses for a component that reads
// everything through useTrip()/useEditor(): a real TripProvider/EditorHost
// tree with only the network layer (apiClient) mocked, so dispatch runs its
// real optimistic-predict path (client-side decide/evolve) rather than a
// hand-rolled fake. sendTripCommand is what a successful client-side predict
// forwards a command to, so it doubles as the "was dispatch called with X"
// spy the Step-1 tests below assert against.
const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn(),
    fetchTripHistory: vi.fn(),
    fetchTripDetailAt: vi.fn(),
    // Owner by default in `beforeEach` — every pre-existing test here was
    // written against a sheet its user can save. The viewer block at the
    // bottom drives it to "viewer". Mocked rather than left to the real
    // helper: unmocked it resolves ok:false, which leaves `myRole` null, and
    // "the role read failed" is a different state from "the role is owner"
    // (TripProvider's `accessUnknown`).
    fetchTripAccess: (...args: unknown[]) => fetchTripAccessMock(...args),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});
const fetchTripAccessMock = vi.fn();

import { fetchTripDetail, fetchTripHistory } from "@/lib/apiClient";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";

const TRIP_ID = "10000000-0000-4000-8000-000000000000";
const DAY_1 = "day-1";
const DAY_2 = "day-2";
// On Day 1 already, with a real time window — used for "keeps an explicit
// end time in edit mode" and as the general edit-mode fixture activity.
const SCHEDULED_ACTIVITY_ID = "activity-1";
// In the backlog: no day, no time window — the "edit mode on a never-
// scheduled stop" edge case the phase's own tests don't cover.
const UNSCHEDULED_ACTIVITY_ID = "activity-2";

function fixture() {
  return tripDetailFixture({
    tripId: TRIP_ID,
    name: "Japan",
    startDate: "2026-10-03",
    currency: "USD",
    days: [
      { dayId: DAY_1, activityIds: [SCHEDULED_ACTIVITY_ID], date: "2026-10-03", costSubtotal: 0 },
      { dayId: DAY_2, activityIds: [], date: "2026-10-04", costSubtotal: 0 },
    ],
    backlog: [UNSCHEDULED_ACTIVITY_ID],
    activities: {
      [SCHEDULED_ACTIVITY_ID]: {
        activityId: SCHEDULED_ACTIVITY_ID,
        title: "Existing stop",
        timeWindow: { start: "10:00", end: "11:00" },
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [UNSCHEDULED_ACTIVITY_ID]: {
        activityId: UNSCHEDULED_ACTIVITY_ID,
        title: "Never scheduled",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
    },
  });
}

// Opens the sheet in the given mode as soon as EditorHost mounts — the real
// app does this via a lens's "Add stop" button / row click (openCreate) or
// an activity click (openEdit); this stands in for that trigger.
function Opener({ mode, activityId }: { mode: "create" | "edit"; activityId?: string }) {
  const { openCreate, openEdit } = useEditor();
  useEffect(() => {
    if (mode === "edit" && activityId !== undefined) openEdit(activityId);
    else openCreate();
    // Fire once on mount only — openCreate/openEdit are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderEditorSheet({ mode, activityId }: { mode: "create" | "edit"; activityId?: string }) {
  render(
    <TripProvider tripId={TRIP_ID}>
      <EditorHost>
        <Opener mode={mode} activityId={activityId} />
        <ActivityEditorSheet />
      </EditorHost>
    </TripProvider>,
  );
  return sendTripCommandMock;
}

beforeEach(() => {
  sendTripCommandMock.mockReset();
  sendTripCommandBatchMock.mockReset();
  fetchTripAccessMock.mockReset().mockResolvedValue({
    ok: true,
    value: { tripId: TRIP_ID, myRole: "owner", members: [], invites: [] },
  });
  vi.mocked(fetchTripDetail).mockResolvedValue({ ok: true, value: fixture() });
  vi.mocked(fetchTripHistory).mockResolvedValue({ ok: true, value: historyFixture(TRIP_ID) });
  sendTripCommandMock.mockResolvedValue({
    ok: true,
    value: { detail: fixture(), history: historyFixture(TRIP_ID) },
  });
});
afterEach(cleanup);

describe("ActivityEditorSheet", () => {
  it("is titled Add a stop in create mode", () => {
    renderEditorSheet({ mode: "create" });
    expect(screen.getByRole("heading", { name: "Add a stop" })).toBeTruthy();
  });

  it("offers day, start and duration rather than two raw times", () => {
    renderEditorSheet({ mode: "create" });

    expect(screen.getByLabelText("Day")).toBeTruthy();
    expect(screen.getByLabelText("Start")).toBeTruthy();
    expect(screen.getByLabelText("How long")).toBeTruthy();
    expect(screen.queryByLabelText("End time")).toBeNull();
  });

  it("derives the time window from start plus duration", async () => {
    const dispatch = renderEditorSheet({ mode: "create" });

    await userEvent.type(screen.getByLabelText("What or where"), "Dinner at Gonpachi");
    await userEvent.selectOptions(screen.getByLabelText("Day"), "day-1");
    await userEvent.type(screen.getByLabelText("Start"), "19:00");
    await userEvent.selectOptions(screen.getByLabelText("How long"), "1.5 hours");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "AddActivity",
      dayId: "day-1",
      title: "Dinner at Gonpachi",
      timeWindow: { start: "19:00", end: "20:30" },
    }));
  });

  // M18, and the reason this test exists rather than a type: both branches of
  // `handleSave` hand-enumerate the form's fields, so a new one is dropped
  // SILENTLY — an extra property on `value` is not read and not flagged, and
  // every test in this file passed while the user's kind and tags went
  // nowhere. Only an assertion on the dispatched command catches it.
  // Mitchell, 2026-08-29: a stop being created is more likely to need booking
  // than not, so the picker preselects "hold" rather than an empty control or
  // the contract's "planned" zero value — and a save that never touches the
  // control still carries that choice.
  it("preselects Holding for a new stop, and saves it untouched", async () => {
    const dispatch = renderEditorSheet({ mode: "create" });

    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("hold");

    await userEvent.type(screen.getByLabelText("What or where"), "Gora Kadan");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "AddActivity", kind: "hold" }));
  });

  it("carries the chosen kind and tags into AddActivity", async () => {
    const dispatch = renderEditorSheet({ mode: "create" });

    await userEvent.type(screen.getByLabelText("What or where"), "Kaiseki dinner");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "booked" } });
    await userEvent.click(screen.getByRole("button", { name: "Meal", pressed: false }));
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AddActivity", kind: "booked", tags: ["meal"] }),
    );
  });

  it("carries the chosen kind and tags into UpdateActivity", async () => {
    const dispatch = renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    // Wait for the real activity before touching anything. `renderEditorSheet`
    // returns synchronously, but TripProvider's fetch has not resolved yet, so
    // the first paint is edit mode over `initial === null` — and the sheet's
    // `${activityId}-${loaded|pending}` key deliberately REMOUNTS
    // ActivityEditor when the fetch lands, re-seeding every field from the
    // activity that just arrived. Anything set before that point is discarded
    // by design (the key exists so a blank first paint can never overwrite
    // real fields on save — see the sheet's own comment). Not reachable in the
    // app: the sheet is mounted inside TripBoardScreen, past its
    // `activeTrip === null` early return, so edit mode never opens pending.
    // This wait puts the test in the same state the user is always in.
    await screen.findByDisplayValue("Existing stop");

    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "hold" } });
    await userEvent.click(screen.getByRole("button", { name: "Lodging", pressed: false }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "UpdateActivity", kind: "hold", tags: ["lodging"] }),
    );
  });

  it("treats Half day as four hours", async () => {
    const dispatch = renderEditorSheet({ mode: "create" });
    await userEvent.type(screen.getByLabelText("What or where"), "Museum");
    await userEvent.type(screen.getByLabelText("Start"), "09:00");
    await userEvent.selectOptions(screen.getByLabelText("How long"), "Half day");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      timeWindow: { start: "09:00", end: "13:00" },
    }));
  });

  it("keeps an explicit end time in edit mode", () => {
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });
    expect(screen.getByLabelText("End time")).toBeTruthy();
  });

  // Not one of the phase's own given tests, but exactly the edge case a
  // human reviewer would ask about: editing a stop that was never scheduled
  // (no day, no timeWindow) must not crash, and must not fabricate a
  // Start/End or an availability banner for a day it isn't on.
  it("edits an unscheduled stop without crashing or fabricating a time or banner", () => {
    renderEditorSheet({ mode: "edit", activityId: UNSCHEDULED_ACTIVITY_ID });

    expect(screen.getByRole("heading", { name: "Edit activity" })).toBeTruthy();
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("status")).toBeNull(); // Banner uses role="status"
  });

  // Regression: TripHeader's bare "Add stop" (openCreate() with no prefill
  // at all — Opener's default here) is the trigger e2e (m1-board.spec.ts,
  // m2-history.spec.ts) and AGENTS.md's "real" feature list both document as
  // creating an UNSCHEDULED stop that lands in the rack, not one pinned to
  // Day 1. An earlier draft of this task had the Day select silently
  // default to the first day whenever there was no prefill, which changed
  // that real, tested behavior rather than just relabeling a field.
  it("stays Unscheduled and dispatches no dayId when opened with no day context", async () => {
    const dispatch = renderEditorSheet({ mode: "create" });

    expect((screen.getByLabelText("Day") as HTMLSelectElement).value).toBe("");
    await userEvent.type(screen.getByLabelText("What or where"), "Airport transfer");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AddActivity", title: "Airport transfer" }),
    );
    const call = dispatch.mock.calls.find((args) => args[0]?.type === "AddActivity");
    expect(call?.[0].dayId).toBeUndefined();
  });
});

// KI-43's remaining half. The board-level ConflictBanner list was the only
// place a distance conflict's words existed, and it filters dismissed ids out
// — so dismissing one left a warning triangle on the card with no copy behind
// it anywhere. Mitchell's call ("All conflicts should still show up in the ui
// when editing the activity") puts that copy here, unfiltered, which is also
// what makes overlapData's "a dismissal suppresses the badge for every kind"
// a quieting rather than a loss.
describe("ActivityEditorSheet conflicts", () => {
  const OTHER_ACTIVITY_ID = "activity-3";
  const DISTANCE_ID = `impossible-geography:${DAY_1}:${SCHEDULED_ACTIVITY_ID}:${OTHER_ACTIVITY_ID}`;
  const DISTANCE_COPY =
    '"Existing stop" (Tokyo) and "Far stop" (Kanazawa) are ~309 km apart on the same day.';
  const UNRELATED_ID = `impossible-geography:${DAY_1}:${OTHER_ACTIVITY_ID}:activity-4`;
  const UNRELATED_COPY = '"Far stop" (Kanazawa) and "Other stop" (Osaka) are ~91 km apart on the same day.';

  function withConflicts(dismissedConflictIds: string[]) {
    const base = fixture();
    vi.mocked(fetchTripDetail).mockResolvedValue({
      ok: true,
      value: {
        ...base,
        conflicts: [
          {
            id: DISTANCE_ID,
            kind: "impossible-geography",
            severity: "warn",
            subjects: [SCHEDULED_ACTIVITY_ID, OTHER_ACTIVITY_ID],
            description: DISTANCE_COPY,
            resolutions: [],
          },
          {
            id: UNRELATED_ID,
            kind: "impossible-geography",
            severity: "warn",
            subjects: [OTHER_ACTIVITY_ID, "activity-4"],
            description: UNRELATED_COPY,
            resolutions: [],
          },
        ],
        dismissedConflictIds,
      },
    });
  }

  it("shows a live conflict naming the stop being edited, in the conflict's own words", async () => {
    withConflicts([]);
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    expect(await screen.findByText(DISTANCE_COPY)).toBeTruthy();
  });

  it("still shows a dismissed conflict, marked as dismissed rather than hidden", async () => {
    withConflicts([DISTANCE_ID]);
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    // The whole point: the board stops showing this one (its banner row is
    // filtered, its triangle is now suppressed too) — the editor does not.
    expect(await screen.findByText(DISTANCE_COPY)).toBeTruthy();
    expect(screen.getByText("Dismissed")).toBeTruthy();
  });

  it("leaves an undismissed conflict unmarked", async () => {
    withConflicts([]);
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    await screen.findByText(DISTANCE_COPY);
    expect(screen.queryByText("Dismissed")).toBeNull();
  });

  it("shows only the conflicts that name this stop", async () => {
    withConflicts([]);
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    await screen.findByText(DISTANCE_COPY);
    expect(screen.queryByText(UNRELATED_COPY)).toBeNull();
  });

  it("shows nothing in create mode, where the stop has no id to be named by", async () => {
    withConflicts([]);
    renderEditorSheet({ mode: "create" });

    expect(await screen.findByLabelText("What or where")).toBeTruthy();
    expect(screen.queryByText(DISTANCE_COPY)).toBeNull();
    expect(screen.queryByText(UNRELATED_COPY)).toBeNull();
  });
});

// docs/reviews/2026-08-28-m11-pr71-review.md §5: the sheet took `dispatch`
// ungated, so a viewer opened a full editable form and typed into it — every
// save refused at dispatch with "You have view-only access". This gate is also
// the backstop for the lenses that raise the sheet and are outside the board
// surface (MapLens, TimelineLens, CalendarLens all call openEdit): whichever
// one opened it, a viewer gets the read-only presentation. NOT the security
// boundary — the server refuses UpdateActivity/AddActivity from a viewer on
// its own.
describe("ActivityEditorSheet — a viewer gets no form", () => {
  const asViewer = () =>
    fetchTripAccessMock.mockResolvedValue({
      ok: true,
      value: { tripId: TRIP_ID, myRole: "viewer", members: [], invites: [] },
    });

  it("shows the stop read-only instead of the editor, and dispatches nothing", async () => {
    asViewer();
    const dispatch = renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    // The activity is still legible — the sheet is the only surface that shows
    // a stop's notes at all, so withholding it would hide content, not an
    // affordance.
    expect(await screen.findByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(screen.getByText("Existing stop")).toBeTruthy();
    expect(screen.getByText("You have view-only access to this trip.")).toBeTruthy();

    // …and every writable control is gone.
    expect(screen.queryByLabelText("What or where")).toBeNull();
    expect(screen.queryByLabelText("Day")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("gives an owner the editable form at the same call site", async () => {
    renderEditorSheet({ mode: "edit", activityId: SCHEDULED_ACTIVITY_ID });

    expect(await screen.findByRole("heading", { name: "Edit activity" })).toBeTruthy();
    expect(screen.getByLabelText("What or where")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("refuses create mode too", async () => {
    asViewer();
    const dispatch = renderEditorSheet({ mode: "create" });

    expect(await screen.findByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByLabelText("What or where")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
