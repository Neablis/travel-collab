import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the API client the provider wraps. The detail must be a
// contract-complete TripDetail (not just the fields this test happens to
// read) because dispatch now runs the client-side predictor (hydrate +
// decide) against it before ever reaching the network mock below.
// `vi.mock` factories are hoisted above top-level consts, so the fixture
// lives inside `vi.hoisted` to be safely referenced from the factory.
const { italyTripDetail, dispatchSpy } = vi.hoisted(() => {
  const italyTripDetail = {
    tripId: "italy-trip",
    name: "Italy",
    startDate: null,
    currency: "USD",
    budget: null,
    members: [{ userId: "dev-alice", role: "owner" }],
    days: [],
    backlog: [],
    activities: {},
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-07-08T12:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
  };
  return {
    italyTripDetail,
    dispatchSpy: vi.fn().mockResolvedValue({
      ok: true,
      value: { detail: italyTripDetail, history: { tripId: "italy-trip", entries: [], canUndo: false, canRedo: false } },
    }),
  };
});
vi.mock("@/lib/apiClient", () => ({
  fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: italyTripDetail }),
  fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: { tripId: "italy-trip", entries: [], canUndo: false, canRedo: false } }),
  fetchTripDetailAt: vi.fn(),
  sendTripCommand: (...a: unknown[]) => dispatchSpy(...a),
  sendTripCommandBatch: vi.fn(),
}));

// Mock next/navigation: URL is the store.
let search = new URLSearchParams("");
const replaceSpy = vi.fn((url: string) => { search = new URLSearchParams(url.split("?")[1] ?? ""); });
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: replaceSpy }),
}));

import { TripProvider, useTrip } from "./TripProvider";
import { EditorHost, useEditor } from "./EditorHost";
import { LensRouter, useLens } from "./LensRouter";

beforeEach(() => { search = new URLSearchParams(""); replaceSpy.mockClear(); dispatchSpy.mockClear(); });

function Consumer() {
  const { activeTrip, dispatch } = useTrip();
  const { openCreate, state } = useEditor();
  const { lens, setLens } = useLens();
  return (
    <div>
      <span data-testid="trip">{activeTrip?.name}</span>
      <span data-testid="lens">{lens}</span>
      <span data-testid="editor">{state.mode ?? "closed"}</span>
      <button onClick={() => setLens("Map")}>go map</button>
      <button onClick={() => openCreate({ dayId: "d1" })}>add</button>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d9" } as never)}>day</button>
    </div>
  );
}

function Harness() {
  return (
    <TripProvider tripId="x">
      <EditorHost>
        <LensRouter>
          <Consumer />
        </LensRouter>
      </EditorHost>
    </TripProvider>
  );
}

describe("trip context spine", () => {
  it("TripProvider exposes the fetched read-model", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Italy"));
  });

  it("dispatch calls the command API (server-cache, not a store)", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Italy"));
    fireEvent.click(screen.getByRole("button", { name: "day" }));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "AddDay" })));
  });

  it("setLens writes the URL, and lens derives from it (unidirectional)", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("lens").textContent).toBe("Board"));
    fireEvent.click(screen.getByRole("button", { name: "go map" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("lens=Map"), { scroll: false });
  });

  it("openCreate opens the editor with prefill", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByTestId("editor").textContent).toBe("create");
  });

  it("openCreate/openEdit/close keep a stable identity across editor-state changes (F1)", () => {
    const seen: Array<ReturnType<typeof useEditor>> = [];
    function Probe() {
      const api = useEditor();
      seen.push(api);
      return null;
    }
    render(
      <EditorHost>
        <Probe />
      </EditorHost>,
    );
    const first = seen[seen.length - 1]!;
    act(() => first.openEdit("a-1")); // changes state → re-render
    const second = seen[seen.length - 1]!;
    expect(second.state).toEqual({ mode: "edit", activityId: "a-1" });
    expect(second.openCreate).toBe(first.openCreate);
    expect(second.openEdit).toBe(first.openEdit);
    expect(second.close).toBe(first.close);
  });
});
