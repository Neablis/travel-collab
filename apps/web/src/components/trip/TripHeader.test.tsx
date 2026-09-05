import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";

// A15: TripHeader now reads useRouter() (for the delete toast's post-dismiss
// navigation) — not exercised by the rename tests below, but the component
// calls it unconditionally on every render, so it needs a mount-time stub.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const sendTripCommandBatchMock = vi.fn();
// Settable so the viewer-gating tests can drive the role the header sees.
// Defaults to owner in `beforeEach`, which is what every pre-existing test
// here assumes.
let myRole: "viewer" | "editor" | "owner" | null = "owner";
// Drives the access READ itself failing, which is a different state from any
// role: TripProvider keeps the board live and reports `accessUnknown` instead
// (docs/reviews/2026-08-28-m11-pr71-review.md §5's PLAUSIBLE edge).
let accessReadFails = false;

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: tripDetailFixture({ tripId: "x", name: "Japan" }) }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: historyFixture("x") }),
    fetchTripDetailAt: vi.fn(),
    // M11 link 3: SettingsSheet withholds Delete unless the caller is the
    // OWNER, so the delete/undo tests below need a role read that says so.
    // Without this the spread above supplies the real `fetchTripAccess`, whose
    // fetch has no handler here — it resolves `ok:false`, `myRole` stays null,
    // and Delete is (correctly) not rendered at all.
    fetchTripAccess: vi.fn(async () =>
      accessReadFails
        ? { ok: false as const, error: { status: 500, message: "boom" } }
        : { ok: true as const, value: { tripId: "x", myRole, members: [], invites: [] } },
    ),
    sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

// TripHeader reads everything from useTrip(), so it's rendered under a real
// TripProvider (apiClient mocked, per TripProvider.test.tsx's pattern) rather
// than a mocked context — this exercises the real dispatch -> sendTripCommand
// path, matching how the header's SetTripName dispatch actually resolves.
import { fetchTripDetail } from "@/lib/apiClient";
import { TripProvider, useTrip } from "@/components/trip/context/TripProvider";
// Task 9: TripHeader's new "Add stop" button calls useEditor().openCreate(),
// so it now needs an EditorHost ancestor (the real app tree provides one —
// trips/[tripId]/page.tsx wraps TripBoardScreen, which mounts TripHeader, in
// <EditorHost>). Same StateSpy pattern board.test.tsx uses to observe
// openCreate's effect on EditorHost's state without mocking useEditor.
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { TripHeader } from "./TripHeader";

// A15-fix regression probe: mounted alongside TripHeader under the same
// TripProvider so the test can observe trip.status directly (there's no
// dedicated "deleted" banner in the UI yet to assert against instead — the
// bug this guards against is TripProvider's own local state staying stale,
// which is exactly what this exposes).
function TripStatusProbe() {
  const { trip } = useTrip();
  return <span data-testid="tripStatus">{trip?.status ?? "none"}</span>;
}

afterEach(cleanup);

beforeEach(() => {
  pushMock.mockReset();
  sendTripCommandMock.mockReset();
  sendTripCommandBatchMock.mockReset();
  myRole = "owner";
  accessReadFails = false;
  sendTripCommandMock.mockResolvedValue({
    ok: true,
    value: { detail: tripDetailFixture({ tripId: "x", name: "Japan 2027" }), history: historyFixture("x") },
  });
});

// `assistant` is the SPEC §23 pair TripBoardScreen passes down (the Ask pill's
// open flag and its opener). Omitted by default so the pre-existing tests below
// keep rendering the header they were written against, and so the "no opener,
// no pill" case — /demo, where `/api/trips/:id/ask` refuses the trip — is the
// default rather than something a test has to construct.
async function renderHeader(
  children?: React.ReactNode,
  assistant?: { open: boolean; onOpen: () => void },
) {
  let editorState: ReturnType<typeof useEditor>["state"] | undefined;
  function EditorStateSpy() {
    editorState = useEditor().state;
    return null;
  }
  render(
    <TripProvider tripId="x">
      <EditorHost>
        <EditorStateSpy />
        <TripHeader tripId="x" assistantOpen={assistant?.open} onOpenAssistant={assistant?.onOpen}>
          {children}
        </TripHeader>
      </EditorHost>
      <TripStatusProbe />
    </TripProvider>,
  );
  // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await waitFor(() => expect(screen.getByText("Japan")).toBeTruthy());
  return { getEditorState: () => editorState };
}

// Renaming moved into the Trip settings sheet (PR #55 preview feedback: the
// pencil is gone and the title opens the sheet). The dispatch behaviour is
// covered where it now lives, in SettingsSheet.test.tsx — what belongs here
// is the door: that the title IS the way in, and that the controls it
// replaced are really gone rather than merely hidden.
describe("TripHeader trip settings entry point", () => {
  it("opens Trip settings from the trip title, and offers no pencil or cog", async () => {
    await renderHeader();

    expect(screen.queryByRole("button", { name: /rename trip/i })).toBeNull();
    // The cog carried this exact accessible name on its own; the title now
    // carries it alongside the trip's name, so an exact match finds nothing.
    expect(screen.queryByRole("button", { name: "Trip settings" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    expect(screen.getByRole("dialog", { name: /trip settings/i })).toBeTruthy();
  });

  it("keeps the trip name in the title's accessible name, not just the action", async () => {
    await renderHeader();
    // A bare aria-label="Trip settings" would have announced the control and
    // swallowed which trip it belongs to.
    expect(screen.getByRole("button", { name: /Japan/i })).toBeTruthy();
  });
});

describe("TripHeader delete/undo (A15)", () => {
  async function deleteViaSettings() {
    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
  }

  it("raises an undo toast after a confirmed delete", async () => {
    await renderHeader();
    await deleteViaSettings();

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId: "x" }),
    );
    const toast = await screen.findByTestId("toast");
    expect(toast.textContent).toMatch(/deleted "japan"/i);
  });

  it("undo dispatches RestoreTrip and dismisses the toast", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByTestId("toast");
    // Scoped to the toast: TripHeader's own UndoRedoControls also has a
    // button named "Undo" for history undo, unrelated to this toast's action.
    await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "RestoreTrip", tripId: "x" }),
    );
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("dismissing without undo navigates back to the trip list", async () => {
    await renderHeader();
    await deleteViaSettings();

    const toast = await screen.findByTestId("toast");
    await userEvent.click(within(toast).getByRole("button", { name: /dismiss/i }));

    expect(pushMock).toHaveBeenCalledWith("/");
  });

  // A15-fix: SettingsSheet.handleDelete() only forwarded {tripId, name} to
  // onDeleted, never the DeleteTrip CommandOutcome — TripHeader never called
  // applyOutcome for the delete itself (only for RestoreTrip/undo above), so
  // TripProvider's trip.status stayed "active" in local state for the whole
  // toast window even though the trip was already deleted server-side, and
  // the board (rename, undo/redo, day/activity edits, Settings) stayed fully
  // interactive against that stale state. Confirming this reconciles
  // immediately — not deferred until the toast closes — is the point of this
  // test.
  it("reconciles trip.status to \"deleted\" immediately after a confirmed delete, before the toast closes", async () => {
    sendTripCommandMock.mockImplementation((command: { type: string }) => {
      if (command.type === "DeleteTrip") {
        return Promise.resolve({
          ok: true,
          value: {
            detail: tripDetailFixture({ tripId: "x", name: "Japan", status: "deleted" }),
            history: historyFixture("x"),
          },
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          detail: tripDetailFixture({ tripId: "x", name: "Japan 2027" }),
          history: historyFixture("x"),
        },
      });
    });

    await renderHeader();
    expect(screen.getByTestId("tripStatus").textContent).toBe("active");

    await deleteViaSettings();

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId: "x" }),
    );
    // The undo toast is still up (its 8s auto-dismiss hasn't fired, and this
    // test never advances any timers) — but trip.status already reflects the
    // delete, proving the reconciliation isn't waiting on the toast to close.
    expect(await screen.findByTestId("toast")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("tripStatus").textContent).toBe("deleted"));
  });
});

// Task 9: restyled header adds a neutral state Badge next to the trip name
// and a real "Add stop" trigger alongside the Task 18 Share/Add-a-saved-day
// placeholder slots. This only covers the new markup/wiring — every
// pre-existing behavior above (rename, sync, undo/redo, history, delete/
// undo-delete) is untouched by the restyle and stays covered by the
// describe blocks above.
describe("TripHeader restyle (Task 9)", () => {
  it("renders a neutral status Badge with the trip's status", async () => {
    await renderHeader();

    const badge = screen.getByText("Active");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(badge.className).toMatch(/bg-moss/);
  });

  it("Add stop opens the portable editor with no dayId prefill", async () => {
    const { getEditorState } = await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(getEditorState()).toEqual({ mode: "create", prefill: undefined });
  });

  // Share (ShareButton, Task 18) is self-wrapped in its own <Preview> —
  // genuinely pointer-events shielded, not just an unwired Button, so a click
  // must actually fail to land (same assertion shape as preview.test.tsx/
  // KeepDayDialog.test.tsx's inert-control tests) and nothing downstream
  // fires: no dispatch, no navigation, no editor state change. Add a saved
  // day moved out of the header entirely (Task 1.4, M10 Wave 2 — the design
  // moved it into the plan flow; Phase 6 rebuilds it there), so it's no
  // longer part of this component to assert on.
  // M11 link 4 made Share real. What this header is still responsible for is
  // mounting it for THIS trip and not letting it touch the board — the panel's
  // own behaviour is ShareButton.test.tsx's territory.
  it("Share opens its own panel and changes nothing about the trip", async () => {
    const { getEditorState } = await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByTestId("share-panel")).toBeTruthy();
    expect(sendTripCommandMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(getEditorState()).toEqual({ mode: null });
  });

  it("keeps the view tabs and day chips inside the sticky header", async () => {
    await renderHeader(
      <>
        <div role="tablist" aria-label="Trip view" />
        <div role="group" aria-label="Days" />
      </>,
    );

    const header = screen.getByRole("banner", { name: "Trip" });
    expect(header.contains(screen.getByRole("tablist", { name: "Trip view" }))).toBe(true);
    expect(header.contains(screen.getByRole("group", { name: "Days" }))).toBe(true);
  });
});

// The "Viewer" badge was, until CodeRabbit read PR #71, the entire viewer
// treatment in this header — its own comment claimed the UI was what stopped
// a viewer clicking into a write, and Share, Add stop, undo/redo and Revert
// were all still live. The server refused them, so nothing was writable; what
// a viewer got instead was silence, which is the papercut the badge exists to
// prevent. Each control is asserted with its owner mirror so these stay
// statements about the ROLE and not about a control that never worked.
describe("TripHeader viewer gating", () => {
  it("shows the badge and withholds every write from a viewer", async () => {
    myRole = "viewer";
    await renderHeader();

    expect(await screen.findByText("Viewer")).toBeTruthy();
    // Sharing is an editor capability (ADR-027), so it is absent rather than
    // disabled — the way Delete is absent for a non-owner in the settings
    // sheet. A disabled Share still reads as an offer.
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    // Absent, not disabled (KI-64). This asserted `disabled === true` until
    // the header was the last greyed control on a board ADR-031 had otherwise
    // gone quiet: same reasoning as Share one line up, applied to the button
    // beside it.
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();

    // Undo/redo and Revert live inside the History popover. Assert the panel
    // actually OPENED first: `queryByRole` returns null for a popover that
    // never rendered, so without this the two absences below passed on a
    // closed popover — my own vacuous witness, caught by CodeRabbit on #71.
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect((await screen.findAllByTestId("history-entry")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redo" })).toBeNull();
  });

  it("leaves all of them live for an owner", async () => {
    await renderHeader();

    expect(screen.queryByText("Viewer")).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add stop" }).hasAttribute("disabled")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect((await screen.findAllByTestId("history-entry")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
  });
});

// The review's §5 edge: when `fetchTripAccess` fails, `myRole` stays null and
// the whole board goes live on an assumption rather than an answer. That is
// the deliberate choice (TripProvider's `load` says why — a false "view only"
// would lock an owner out of their own trip over one failed secondary read),
// so the header states the unknown rather than acting on it: a later refusal
// then reads as a known consequence rather than as the app breaking.
describe("TripHeader — the access read failed", () => {
  it("says the access is unknown, and keeps the board live", async () => {
    accessReadFails = true;
    await renderHeader();

    expect(await screen.findByText("Access unknown")).toBeTruthy();
    // Not "Viewer": an unknown role is not a viewer.
    expect(screen.queryByText("Viewer")).toBeNull();
    expect(screen.getByRole("button", { name: "Add stop" }).hasAttribute("disabled")).toBe(false);
  });

  it("says nothing when the read succeeded", async () => {
    await renderHeader();

    expect(await screen.findByRole("button", { name: "Add stop" })).toBeTruthy();
    expect(screen.queryByText("Access unknown")).toBeNull();
  });
});

// Mitchell, Vercel toolbar comment on `/trips/:id?lens=Map&view=Calendar` at
// 411x760 (a phone): "all three columns from share, trip overview to budget
// are really crowded and ugly on mobile, if we hid them here would they still
// be accessible in trip settings?".
//
// jsdom loads no stylesheet, so `hidden md:block` is inert here and these
// assert the CLASSES rather than a computed style — the same trade the status
// Badge test above makes. What is actually rendered at 411px is asserted for
// real in `e2e/responsive.spec.ts` ("the trip header sheds ... on a phone"),
// which runs in a browser; these are the cheap regression guard for the
// breakpoint itself, which a browser test would not tell you the number of.
describe("TripHeader on a phone", () => {
  it("puts Share and the meta/budget row behind the 768px breakpoint, and nothing else", async () => {
    await renderHeader(
      <>
        <div role="tablist" aria-label="Trip view" />
        <div role="group" aria-label="Days" />
      </>,
    );

    // `md:` IS 768px — the line globals.css already draws between "narrow but
    // still a shrinkable plan" and "phone" (`.assistant-rail`,
    // `.unscheduled-rack`) and the one `useIsPhone` reads.
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("trip-header-share").className).toBe("hidden md:block");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("trip-meta-row").className).toMatch(/(^| )hidden( |$)/);
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("trip-meta-row").className).toMatch(/md:flex/);

    // The other half of the decision, and the half a "hide it all" regression
    // would quietly break: actions and navigation are NOT in the cut. "Add
    // stop" and History have no home in Trip settings, and the tab strip and
    // day chips are the phone's primary navigation.
    for (const name of ["Add stop", "History"]) {
      // eslint-disable-next-line testing-library/no-node-access, testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
      expect(screen.getByRole("button", { name }).closest("[class*='hidden']")).toBeNull();
    }
    // eslint-disable-next-line testing-library/no-node-access, testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByRole("tablist", { name: "Trip view" }).closest("[class*='hidden']")).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access, testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByRole("group", { name: "Days" }).closest("[class*='hidden']")).toBeNull();
    // And the door to everything that IS hidden.
    // eslint-disable-next-line testing-library/no-node-access, testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByRole("button", { name: /trip settings/i }).closest("[class*='hidden']")).toBeNull();
  });

  // The reachability half, at this level: whatever the header stops showing
  // has to be behind the title. A test that only asserted the disappearances
  // above would pass on a regression that lost them altogether.
  it("reaches Share and the counts through the title, where the header hides them", async () => {
    await renderHeader();

    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    const sheet = screen.getByRole("dialog", { name: /trip settings/i });

    expect(within(sheet).getByRole("button", { name: "Share" })).toBeTruthy();
    // The same figures the hidden pill states, from the same `tripCounts`
    // call — asserted against the pill's own rendering rather than against a
    // hardcoded number, so the fixture can change without this going stale.
    const pill = screen.getByTestId("trip-meta-row");
    for (const unit of ["days", "stops", "cities"] as const) {
      const inPill = within(pill).getByText(new RegExp(`\\d+ ${unit}$`)).textContent!;
      expect(within(sheet).getByText(inPill)).toBeTruthy();
    }
    // Budget was already fully editable in the sheet before this change; the
    // chip is a shortcut to it, not the only way in.
    expect(within(sheet).getByLabelText("Total for the trip")).toBeTruthy();
  });
});

// SPEC §23. Two additions, and they are a pair: the pill is the phone's only
// route to the assistant now (TripBoardScreen's launcher went `hidden
// md:inline-flex` in the same change), and the date line is the meta row's one
// survivor coming back on its own.
//
// Same jsdom caveat as the block above — no stylesheet, so `md:hidden` is inert
// and these assert the class. What is actually on screen at 411px is pinned in
// a browser by e2e/m16-mobile-assistant.spec.ts.
describe("TripHeader — the phone Ask pill (SPEC §23)", () => {
  it("puts the pill last in the top row, phone-only, and reports its open state", async () => {
    const onOpen = vi.fn();
    await renderHeader(undefined, { open: false, onOpen });

    const nav = screen.getByRole("navigation");
    const pill = within(nav).getByRole("button", { name: "Ask" });
    // LAST in the row — "same pill, same label, same position, so it never
    // moves as you change tabs" only holds if it is pinned to one end, and
    // `‹ Trips` … `Ask` is the order §23 draws. Reached by element position
    // because ordering within a row is exactly what no role query can express.
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(nav.lastElementChild).toBe(pill);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(nav.firstElementChild).toBe(within(nav).getByRole("link"));
    // Phone-only, and by CSS: the desktop entry point is the board's own fixed
    // launcher, and both on screen at once is what §23 removes.
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(pill.className).toMatch(/(^| )md:hidden( |$)/);

    expect(pill.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(pill);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says the assistant is open when it is", async () => {
    await renderHeader(undefined, { open: true, onOpen: vi.fn() });
    expect(screen.getByRole("button", { name: "Ask" }).getAttribute("aria-expanded")).toBe("true");
  });

  // The header does not decide whether there is an assistant — the board does,
  // and on /demo there is none (`/api/trips/:id/ask` refuses the demo trip,
  // KI-79). No opener, no pill: a control whose only outcome is an error is
  // worse than no control.
  it("renders no pill when there is no assistant to open", async () => {
    await renderHeader();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });
});

describe("TripHeader — the phone date line (SPEC §23)", () => {
  it("shows the trip's date range under the title, phone-only, and nothing else from the meta row", async () => {
    await renderHeader();

    const line = screen.getByTestId("trip-date-line");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(line.className).toMatch(/(^| )md:hidden( |$)/);

    // The same string the meta pill states, from the same `tripDateRange` —
    // asserted against the pill's own rendering rather than a literal, so the
    // fixture can change without this going stale. That is the point of the
    // shared function: the header below 768px and the pill above it cannot
    // disagree about the same trip.
    const pillDate = within(screen.getByTestId("trip-meta-row")).getByText(line.textContent!);
    expect(pillDate).toBeTruthy();

    // "Stops and cities came out." The counts the pill carries beside the range
    // are the whole of what §23 trims, so their absence is the assertion.
    expect(line.textContent).not.toMatch(/days|stops|cities/);
  });

  it("states a real range when the trip has one", async () => {
    vi.mocked(fetchTripDetail).mockResolvedValueOnce({
      ok: true,
      value: tripDetailFixture({
        tripId: "x",
        name: "Japan",
        startDate: "2027-10-09",
        days: [
          { dayId: "d1", activityIds: [], date: "2027-10-09", costSubtotal: 0 },
          { dayId: "d2", activityIds: [], date: "2027-10-11", costSubtotal: 0 },
        ],
      }),
    });
    await renderHeader();

    // First day to last day, en dash, and no year — `formatTripDate`'s shape,
    // reached through the pill's function rather than restated here.
    expect(screen.getByTestId("trip-date-line").textContent).toBe("Sat, Oct 9 – Mon, Oct 11");
  });
});
