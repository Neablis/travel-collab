import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture, historyFixture } from "@tc/factories";
import type { TripMemberProfile } from "@tc/contracts";

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
let myRole: "viewer" | "suggester" | "editor" | "owner" | null = "owner";
// Drives the access READ itself failing, which is a different state from any
// role: TripProvider keeps the board live and reports `accessUnknown` instead
// (docs/reviews/2026-08-28-m11-pr71-review.md §5's PLAUSIBLE edge).
let accessReadFails = false;
// Who the access read lists. Empty by default, which draws no avatar stack.
let accessMembers: TripMemberProfile[] = [];
const setTravellingMock = vi.fn();

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
        : { ok: true as const, value: { tripId: "x", myRole, members: accessMembers, invites: [] } },
    ),
    setTravelling: (...args: unknown[]) => setTravellingMock(...args),
    // The command only. The unit's key (ADR-066) is the sender's business,
    // asserted in TripProvider.test.tsx.
    sendTripCommand: (command: unknown) => sendTripCommandMock(command),
    sendTripCommandBatch: (...args: unknown[]) => sendTripCommandBatchMock(...args),
  };
});

// TripHeader reads everything from useTrip(), so it's rendered under a real
// TripProvider (apiClient mocked, per TripProvider.test.tsx's pattern) rather
// than a mocked context — this exercises the real dispatch -> sendTripCommand
// path, matching how the header's SetTripName dispatch actually resolves.
import { fetchTripDetail, fetchTripDetailAt } from "@/lib/apiClient";
import { TripProvider, useTrip } from "@/components/trip/context/TripProvider";
// Task 9: TripHeader's new "Add stop" button calls useEditor().openCreate(),
// so it now needs an EditorHost ancestor (the real app tree provides one —
// trips/[tripId]/page.tsx wraps TripBoardScreen, which mounts TripHeader, in
// <EditorHost>). Same StateSpy pattern board.test.tsx uses to observe
// openCreate's effect on EditorHost's state without mocking useEditor.
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { TripHeader } from "./TripHeader";
import { tripCounts } from "./TripMetaPill";
import { clearQueryCache } from "@/lib/queryCache";
import { setViewportMatches } from "../../../vitest.setup";

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
  accessMembers = [];
  setTravellingMock.mockReset();
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

  // axe on `/demo`: the trip page had no h1. The trip's name is the page's
  // title, so it is the one.
  it("is the page's level-one heading", async () => {
    await renderHeader();
    expect(screen.getByRole("heading", { level: 1, name: /Japan/i })).toBeTruthy();
  });
});

// **M26 link 6a: there is no delete on this screen, so there is no toast.**
//
// A15 built this level's undo toast because `SettingsSheet`'s own subtree
// unmounts on a successful delete and could not host one. With Delete moved to
// the trip card's popover on Home (SPEC §34.2, §27, DRIFT D13), Home's own
// toast — which has always been there, one level up — is the only one, and the
// four tests that stood here went with the feature.
//
// They are replaced by the claim worth holding rather than simply deleted: a
// reader who puts Delete back in the settings sheet would otherwise get a
// silently toastless screen, which is the A15 defect in reverse.
//
// The A15-fix reconciliation those tests also covered (applying the delete's
// own `CommandOutcome` so `trip.status` does not stay "active" against deleted
// server state) is not lost, only out of reach: nothing on this screen can
// delete this trip any more, so there is no window for the staleness to open.
describe("TripHeader — deleting is not done from here (M26 link 6a)", () => {
  it("offers no Delete inside Trip settings, and raises no delete toast", async () => {
    await renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));

    expect(screen.queryByRole("button", { name: /^delete trip$/i })).toBeNull();
    expect(screen.queryByTestId("toast")).toBeNull();
    // The trip is still active, and nothing asked the server otherwise.
    expect(screen.getByTestId("tripStatus").textContent).toBe("active");
    expect(sendTripCommandMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "DeleteTrip" }),
    );
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
  // **Share is not in this header any more, at any width.** Mitchell,
  // 2026-09-06: *"Put share in the trip settings under invite someone, both
  // here and in mobile"*. `SettingsSheet` mounts the only `ShareButton` on a
  // trip now, and `SettingsSheet.test.tsx` owns the assertions about it.
  //
  // Asserted as an absence, in the owner case, because a reader-only assertion
  // would pass on a header that still showed it to owners — which is exactly
  // the state this replaced.
  it("does not offer Share — that lives in Trip settings now", async () => {
    await renderHeader();

    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    // The actions that have nowhere else to live are untouched.
    expect(screen.getByRole("button", { name: "Add stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });

  // The day chips used to be asserted here too. SPEC §35.3 moved them into the
  // Plan tab's body, and `TripBoardScreen.test.tsx` owns where they render now.
  it("keeps the view tabs inside the sticky header", async () => {
    await renderHeader(<div role="tablist" aria-label="Trip view" />);

    const header = screen.getByRole("banner", { name: "Trip" });
    expect(header.contains(screen.getByRole("tablist", { name: "Trip view" }))).toBe(true);
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
    // sheet.
    // Absent, not disabled (KI-64). This asserted `disabled === true` until
    // the header was the last greyed control on a board ADR-031 had otherwise
    // gone quiet: same reasoning as Share one line up, applied to the button
    // beside it.
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();
    // The dates pill moves the trip (M27 D5), so a viewer gets its text only.
    expect(screen.queryByRole("button", { name: /^Trip dates:/ })).toBeNull();
    expect(within(screen.getByTestId("trip-meta-row")).getByText("No dates set")).toBeTruthy();

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
    expect(screen.getByRole("button", { name: "Add stop" }).hasAttribute("disabled")).toBe(false);

    // And the pill's popover reaches the log through the provider's dispatch,
    // the same road Trip settings' Dates row takes.
    await userEvent.click(screen.getByRole("button", { name: /^Trip dates:/ }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-14" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({
        type: "SetTripStartDate",
        tripId: "x",
        startDate: "2027-03-14",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect((await screen.findAllByTestId("history-entry")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
  });

  // `runDispatch` enqueues against the LIVE trip whatever is on screen, so a
  // date picked while an old seq is previewed would move the present — and
  // its no-op check would compare against the preview's start date.
  it("gives an owner the dates as text only while previewing an old seq", async () => {
    vi.mocked(fetchTripDetailAt).mockResolvedValueOnce({
      ok: true,
      value: tripDetailFixture({ tripId: "x", name: "Japan", startDate: "2027-01-05" }),
    });
    await renderHeader();
    expect(screen.getByRole("button", { name: /^Trip dates:/ })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(within((await screen.findAllByTestId("history-entry"))[0]!).getAllByRole("button")[0]!);

    // The preview's own range, proving the preview is what is on screen.
    expect(await within(screen.getByTestId("trip-meta-row")).findByText("Tue, Jan 5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Trip dates:/ })).toBeNull();
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

// Review of #309, finding 2.5: Trip settings recomputed `readOnly` from
// `myRole` with its own copy of TripProvider's rule. It takes the provider's
// `readOnly` from this header now, so these go through the real provider: the
// two ends of that rule, as the sheet sees them.
describe("TripHeader — Trip settings is gated by the provider's readOnly", () => {
  // A suggester is `readOnly` and may edit the board (W8, W35): the sheet
  // withholds Share and leaves the trip fields, whose edits join the draft.
  it("withholds Share from a suggester and leaves them the trip fields (W8)", async () => {
    myRole = "suggester";
    await renderHeader();
    expect(await screen.findByText("Suggester")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    // The sheet rendered, so an absent Share is the gate and not an empty tree.
    expect(screen.getByRole("link", { name: "Download Trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(false);
  });

  it("leaves the sheet live when the access read failed (W21)", async () => {
    accessReadFails = true;
    await renderHeader();
    expect(await screen.findByText("Access unknown")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    expect(screen.getByLabelText("Trip name").hasAttribute("disabled")).toBe(false);
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
  it("puts the meta/budget row behind the 768px breakpoint, and nothing else", async () => {
    await renderHeader(<div role="tablist" aria-label="Trip view" />);

    // `md:` IS 768px — the line globals.css already draws between "narrow but
    // still a shrinkable plan" and "phone" (`.assistant-rail`,
    // `.unscheduled-rack`) and the one `useIsPhone` reads.
    //
    // Share used to be the other half of this assertion, at `hidden md:block`.
    // It is not behind the breakpoint any more — it is out of this header
    // entirely, which the owner-case test above asserts.
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("trip-meta-row").className).toMatch(/(^| )hidden( |$)/);
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("trip-meta-row").className).toMatch(/md:flex/);

    // The other half of the decision, and the half a "hide it all" regression
    // would quietly break: navigation is NOT in the cut. "Add stop" and
    // History used to be asserted here too; M39 D6 moved them into the phone's
    // overflow menu on purpose, which the menu's own tests below reach by
    // using it. (The day chips are no longer the header's — SPEC §35.3.)
    // eslint-disable-next-line testing-library/no-node-access, testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByRole("tablist", { name: "Trip view" }).closest("[class*='hidden']")).toBeNull();
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
    // The counts, from `tripCounts` over the trip this header was given —
    // derived rather than hardcoded, so the fixture can change without this
    // going stale. The pill used to be the other side of this comparison; it
    // states only the dates since SPEC §35.3, so the sheet is their one home.
    const counts = tripCounts(tripDetailFixture({ tripId: "x", name: "Japan" }));
    for (const unit of ["days", "stops", "cities"] as const) {
      expect(within(sheet).getByText(`${counts[unit]} ${unit}`)).toBeTruthy();
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
// `md:hidden` is not asserted here at all. jsdom loads no stylesheet, so the
// breakpoint is inert and a class-name match would only prove a string is in an
// attribute. The phone half is pinned in a browser by
// e2e/m16-mobile-assistant.spec.ts, which has the pill visible at 411px and the
// board's `Assistant` launcher hidden at the same width.
describe("TripHeader — the phone Ask pill (SPEC §23)", () => {
  it("puts the pill last in the top row, and reports its open state", async () => {
    const onOpen = vi.fn();
    await renderHeader(undefined, { open: false, onOpen });

    const nav = screen.getByRole("navigation");
    const pill = within(nav).getByRole("button", { name: "Ask" });

    // LAST in the row — "same pill, same label, same position, so it never
    // moves as you change tabs" only holds if it is pinned to one end, and
    // `← Your trips` … `Ask` is the order §23 draws.
    //
    // Stated as TAB ORDER rather than `nav.lastElementChild`, and driven by
    // the keyboard rather than by reading `document.activeElement` — the wall
    // bans both node access and that property, and neither route was needed:
    // a keyboard reader meets these controls in the order they are drawn in,
    // so "the second stop is the one that opens the assistant, and the first
    // is not" IS the position claim, said in what the user experiences.
    //
    // Space, not Enter, because the discrimination is the point: a link does
    // not activate on Space and a button does. So the first probe fires only
    // if the pill has moved to the front of the row, which is the regression
    // this exists to catch, and it does not navigate away from the header on
    // the way past.
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
    await userEvent.tab();
    await userEvent.keyboard("[Space]");
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.tab();
    await userEvent.keyboard("[Space]");
    expect(onOpen).toHaveBeenCalledTimes(1);

    expect(pill.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(pill);
    expect(onOpen).toHaveBeenCalledTimes(2);
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
  // Phone-only is `md:hidden`, and it is not asserted here for the same reason
  // as the pill above: no stylesheet in jsdom, so there is nothing to evaluate.
  // What this pins is the half that is real without one — the line says the
  // same range the desktop meta pill says, and none of what §23 trimmed.
  it("shows the trip's date range under the title, and nothing else from the meta row", async () => {
    await renderHeader();

    const line = screen.getByTestId("trip-date-line");

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

// M39 D6 (KI-2026-09-24-i): below 768px the pinned header is one row, and what
// the desktop lays out beside the title is behind its `⋯`. Driven through the
// menu, because the claim is that each item reaches what it names. Where the
// row is drawn, and that it stays on screen, is measured at 411px in a browser
// by e2e/m39-phone-header.spec.ts; jsdom has no layout to ask.
describe("TripHeader — the phone's overflow menu (M39 D6)", () => {
  beforeEach(() => setViewportMatches({ "(max-width: 767px)": true }));
  afterEach(() => setViewportMatches({}));

  const openMenu = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Trip actions" }));
    return screen.findByRole("menu");
  };
  const itemNames = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((item) => item.textContent);

  it("holds Add stop, History and Trip settings, and each opens what it names", async () => {
    const { getEditorState } = await renderHeader();

    expect(itemNames(await openMenu())).toEqual(["Add stop", "History", "Trip settings"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Add stop" }));
    await waitFor(() => expect(getEditorState()).toEqual({ mode: "create", prefill: undefined }));

    // History with its undo and redo, which stay in it (Mitchell, 2026-10-09).
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "History" }));
    expect((await screen.findAllByTestId("history-entry")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByTestId("history-entry")).toHaveLength(0));
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Trip settings" }));
    expect(await screen.findByRole("dialog", { name: /trip settings/i })).toBeTruthy();
  });

  // History's own button is `display: none` on a phone, so closing the panel
  // must hand focus back to the `⋯` it was opened from, not to that hidden
  // button (where a browser drops it to <body>). PR #364's preview walk.
  it("returns focus to the menu button when History closes", async () => {
    await renderHeader();
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "History" }));
    await screen.findAllByTestId("history-entry");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByTestId("history-entry")).toHaveLength(0));
    // Said through the keyboard, as the Ask pill's order above is (the wall
    // bans reading focus directly): Enter on `⋯` opens the menu, where Enter
    // on History's own button would open History again.
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(screen.queryAllByTestId("history-entry")).toHaveLength(0);
  });

  // Absent, not disabled, as the desktop's button is (KI-64).
  it("offers a viewer no Add stop", async () => {
    myRole = "viewer";
    await renderHeader();
    await screen.findByText("Viewer");

    expect(itemNames(await openMenu())).toEqual(["History", "Trip settings"]);
  });

  it("puts the badges and the dates under the pinned header, where they scroll away", async () => {
    myRole = "viewer";
    await renderHeader();

    const header = screen.getByRole("banner", { name: "Trip" });
    const viewer = await screen.findByText("Viewer");
    expect(header.contains(viewer)).toBe(false);
    expect(header.contains(screen.getByText("Active"))).toBe(false);
    expect(header.contains(screen.getByTestId("trip-date-line"))).toBe(false);
  });

  it("keeps the badges beside the title above the breakpoint", async () => {
    setViewportMatches({});
    myRole = "viewer";
    await renderHeader();

    const header = screen.getByRole("banner", { name: "Trip" });
    expect(header.contains(await screen.findByText("Viewer"))).toBe(true);
    expect(screen.getAllByText("Active")).toHaveLength(1);
  });
});

const person = (userId: string, name: string, travelling = true): TripMemberProfile => ({
  userId,
  role: userId === "dev-alice" ? "owner" : "editor",
  name,
  email: null,
  image: null,
  travelling,
  displayName: null,
  avatar: null,
  color: null,
  colorShifted: false,
});

// Travellers spec D10: the header's door to People. Who is travelling, as
// faces beside the title, and the sheet opened at the People section.
describe("TripHeader — the avatar stack (D10)", () => {
  let scrolled: Element[];
  beforeEach(() => {
    scrolled = [];
    // jsdom has no `scrollIntoView`; recording `this` is the whole assertion.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("draws three travellers and a count of the rest, leaving out who is not travelling", async () => {
    accessMembers = [
      person("dev-alice", "Alice Ames"),
      person("dev-bob", "Bob Burns"),
      person("dev-cy", "Cy Cole"),
      person("dev-dee", "Dee Dunn"),
      person("dev-eve", "Eve Ellis", false),
    ];
    await renderHeader();
    const stack = await screen.findByRole("button", { name: "Travellers on this trip" });
    expect(stack.textContent).toBe("AABBCC+1");
    // Hidden below `sm` (640px); jsdom loads no stylesheet, so the class is the assertion.
    // eslint-disable-next-line no-restricted-syntax -- the breakpoint is the claim, as in "TripHeader on a phone" above
    expect(stack.className).toMatch(/\bhidden\b.*\bsm:inline-flex\b/);
  });

  // M38: each face is the person's chip — the glyph they picked, or initials
  // from the name they chose — not initials from their sign-in name.
  it("draws each traveller's chosen avatar, or the initials of their display name", async () => {
    accessMembers = [
      { ...person("dev-alice", "Alice Ames"), avatar: "mountain", color: "plum" },
      { ...person("dev-bob", "Bob Burns"), displayName: "Kenji Watanabe" },
    ];
    await renderHeader();
    const stack = await screen.findByRole("button", { name: "Travellers on this trip" });
    expect(stack.innerHTML).toContain("lucide-mountain");
    expect(stack.textContent).toBe("KW");
  });

  it("opens Trip settings scrolled to People", async () => {
    accessMembers = [person("dev-alice", "Alice Ames"), person("dev-bob", "Bob Burns")];
    await renderHeader();
    await userEvent.click(await screen.findByRole("button", { name: "Travellers on this trip" }));

    expect(screen.getByRole("dialog", { name: /trip settings/i })).toBeTruthy();
    expect(scrolled.map((el) => el.id)).toEqual(["people"]);
  });

  it("does not scroll when the sheet is opened from the title", async () => {
    accessMembers = [person("dev-alice", "Alice Ames")];
    await renderHeader();
    await screen.findByRole("button", { name: "Travellers on this trip" });
    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));

    // Witness: the sheet and its People section are there to be scrolled to.
    expect(within(screen.getByRole("dialog", { name: /trip settings/i })).getByTestId("people-section")).toBeTruthy();
    expect(scrolled).toEqual([]);
  });

  // Absence alone passed with the label misspelt, so the same setup is drawn
  // again with one person travelling, and the stack must then be found.
  it("draws nothing while nobody is travelling", async () => {
    accessMembers = [person("dev-alice", "Alice Ames", false)];
    await renderHeader();
    // Witness: the access read has answered, and the header rendered.
    await screen.findByRole("button", { name: "Add stop" });
    expect(screen.queryByRole("button", { name: "Travellers on this trip" })).toBeNull();

    // As between tests (`vitest.setup.ts`), so the second mount reads afresh.
    cleanup();
    clearQueryCache();
    accessMembers = [person("dev-alice", "Alice Ames")];
    await renderHeader();
    expect(await screen.findByRole("button", { name: "Travellers on this trip" })).toBeTruthy();
  });
});

// M37: Home's *Invite who's coming* and *Choose a cover photo* link here with
// `?settings=people|cover`, which opens the sheet where the avatar stack does.
describe("TripHeader — a link into Trip settings", () => {
  let scrolled: Element[];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    window.history.replaceState(null, "", "/");
  });

  it.each(["cover", "people"] as const)("opens the sheet at %s from ?settings=", async (section) => {
    window.history.replaceState(null, "", `/trips/x?view=Plan&settings=${section}`);
    await renderHeader();

    expect(await screen.findByRole("dialog", { name: /trip settings/i })).toBeTruthy();
    // Only ever at that section: People is landed on again once Cover settles
    // (SettingsSheet.test.tsx), so how many times is not this test's claim.
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));
    expect(new Set(scrolled.map((el) => el.id))).toEqual(new Set([section]));
  });

  it("drops the param when the sheet closes, and keeps the rest of the URL", async () => {
    window.history.replaceState(null, "", "/trips/x?view=Plan&settings=cover");
    await renderHeader();
    await screen.findByRole("dialog", { name: /trip settings/i });

    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /trip settings/i })).toBeNull());
    expect(window.location.search).toBe("?view=Plan");
  });

  it("opens nothing for a section it does not have", async () => {
    window.history.replaceState(null, "", "/trips/x?settings=budget");
    await renderHeader();
    // Witness: the header rendered, so the sheet had its chance to open.
    await screen.findByRole("button", { name: "Add stop" });
    expect(screen.queryByRole("dialog", { name: /trip settings/i })).toBeNull();
  });
});

// Travellers spec W15: a member write in Trip settings recosts the board for
// the person who made it, without waiting for a poll a solo trip never runs.
describe("TripHeader — a change in People re-reads the trip", () => {
  it("re-reads access and the trip after a travelling toggle", async () => {
    const alice = person("dev-alice", "Alice Ames");
    const bob = person("dev-bob", "Bob Burns");
    accessMembers = [alice, bob];
    setTravellingMock.mockResolvedValue({
      ok: true,
      value: { tripId: "x", myRole: "owner", members: [alice, { ...bob, travelling: false }], invites: [] },
    });
    await renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /trip settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Bob Burns" }));
    const detailReads = vi.mocked(fetchTripDetail).mock.calls.length;
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as not travelling" }));

    await waitFor(() => expect(setTravellingMock).toHaveBeenCalledWith("x", "dev-bob", false));
    await waitFor(() => expect(vi.mocked(fetchTripDetail).mock.calls.length).toBe(detailReads + 1));
  });
});
