import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

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
