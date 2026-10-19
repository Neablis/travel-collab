import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { followHistory } from "@/test-support/nextHistory";

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
  // M11 link 3: TripProvider reads the caller's role alongside detail and
  // history. `owner` keeps this file's board fully editable, which is what
  // every assertion below was written against.
  fetchTripAccess: vi.fn().mockResolvedValue({
    ok: true,
    value: { tripId: "italy-trip", myRole: "owner", members: [], invites: [], guests: [] },
  }),
  // The command only; the unit's key (ADR-066) is asserted in TripProvider.test.tsx.
  sendTripCommand: (command: unknown) => dispatchSpy(command),
  sendTripCommandBatch: vi.fn(),
  // An owner's board also reads the trip's suggestions; none here.
  fetchTripSuggestions: vi.fn().mockResolvedValue({ ok: true, value: { changes: [], rev: "r" } }),
}));

// Mock next/navigation: URL is the store.
let search = new URLSearchParams("");
let pathname = "/trips/x";
const replaceSpy = vi.fn();
// The URL, as Next's patched `history` moves it (`followHistory`): a view
// change re-renders whoever reads the search params.
const urlListeners = new Set<() => void>();
const setUrl = (url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
  urlListeners.forEach((l) => l());
};
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    useSyncExternalStore(
      (onChange) => {
        urlListeners.add(onChange);
        return () => urlListeners.delete(onChange);
      },
      () => search,
    ),
  usePathname: () => pathname,
  useRouter: () => ({ replace: replaceSpy }),
}));

import { TripProvider, useTrip } from "./TripProvider";
import { EditorHost, useEditor } from "./EditorHost";
import { LensRouter, useLens } from "./LensRouter";

let restoreHistory: () => void = () => {};
beforeEach(() => {
  search = new URLSearchParams("");
  pathname = "/trips/x";
  replaceSpy.mockClear();
  dispatchSpy.mockClear();
  restoreHistory = followHistory(setUrl);
});
afterEach(() => restoreHistory());

function Consumer() {
  const { activeTrip, dispatch } = useTrip();
  const { openCreate, state } = useEditor();
  const { view, setView } = useLens();
  return (
    <div>
      <span data-testid="trip">{activeTrip?.name}</span>
      <span data-testid="lens">{view}</span>
      <span data-testid="editor">{state.mode ?? "closed"}</span>
      <button onClick={() => setView("Map")}>go map</button>
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

  // SPEC §24: a trip with no view in its URL lands on **Overview** — *"You read
  // a trip before you change it."* It used to land on Board.
  //
  // PR 486 review: a tab change writes the URL natively and never through the
  // router, whose navigation would fetch the trip page from the server again
  // (every first-data read, for an answer nothing uses).
  it("setView writes the URL, and the view derives from it (unidirectional)", async () => {
    // The entry carries Next's own state, as in the browser: a write that
    // passes it on is taken for Next's own and never moves the view.
    window.history.replaceState({ __NA: true }, "");
    const written = vi.spyOn(window.history, "replaceState");
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("lens").textContent).toBe("Overview"));
    fireEvent.click(screen.getByRole("button", { name: "go map" }));
    expect(String(written.mock.calls.at(-1)?.[2])).toContain("view=Map");
    expect(replaceSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("lens").textContent).toBe("Map"));
  });

  // A demo lands on Plan instead (Mitchell, 2026-10-11): a visitor is there to
  // see the planning. A view in the URL still wins, and a notebook link
  // (`?page=`) is still Overview's.
  it.each([
    ["", "Plan"],
    ["view=Overview", "Overview"],
    ["lens=Map", "Map"],
    ["page=p1", "Overview"],
  ])("a demo at /demo/japan?%s opens on %s", (query, expected) => {
    pathname = "/demo/japan";
    search = new URLSearchParams(query);
    function View() {
      return <span data-testid="lens">{useLens().view}</span>;
    }
    render(
      <LensRouter>
        <View />
      </LensRouter>,
    );
    expect(screen.getByTestId("lens").textContent).toBe(expected);
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

  // PR 398 review: ⌘K over an open sheet reopens it with focus on the sheet's
  // own field, which is gone once it closes. The control that first opened it
  // is where focus goes back to; after a close, the next opening records anew.
  it("remembers where focus was only when the editor opens from outside it", () => {
    let api: ReturnType<typeof useEditor> | undefined;
    function Probe() {
      api = useEditor();
      return null;
    }
    render(
      <EditorHost>
        <Probe />
        <button>opener</button>
        <button>in the sheet</button>
      </EditorHost>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    const inSheet = screen.getByRole("button", { name: "in the sheet" });
    act(() => opener.focus());
    act(() => api!.openEdit("a-1"));
    act(() => inSheet.focus());
    act(() => api!.openCreate({ dayId: "d1" }));
    expect(api!.returnFocus.current).toBe(opener);

    act(() => api!.close());
    act(() => api!.openCreate());
    expect(api!.returnFocus.current).toBe(inSheet);
  });
});
