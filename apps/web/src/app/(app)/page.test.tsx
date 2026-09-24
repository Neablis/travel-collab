import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripDetailFixture, historyFixture } from "@tc/factories";
import { formatMoney } from "@/lib/formatMoney";

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

// Who is reading, which is what decides whether a card's menu offers Delete or
// *Leave this trip* (M26 link 6b). `getSessionMock` is reset per test to the
// owner, so every existing test keeps the menu it was written against.
const getSessionMock = vi.fn();
vi.mock("next-auth/react", () => ({
  getSession: () => getSessionMock(),
  signOut: vi.fn(async () => {}),
}));

import Home from "./page";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import { rememberDemoClone } from "@/lib/pendingDemoClone";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    tripId,
    name: "Japan",
    status: "active",
    members: [{ userId: OWNER_ID, role: "owner" }],
    createdAt: "2026-07-08T12:00:00.000Z",
    startDate: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OWNER_ID = "dev-alice";

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: { id: OWNER_ID } });
});

describe("Home trip actions", () => {
  it("deletes a trip and offers an undo that restores it", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return jsonResponse({
          detail: tripDetailFixture({ tripId, name: "Japan" }),
          history: historyFixture(tripId),
        });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    // **No confirm dialog since SPEC §27**: the card goes on the click, and
    // the toast's Undo is the recovery. The step that used to follow here was
    // a modal whose own copy said the action was undoable.
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    // **Scoped, because deleting the last trip empties the list** — which
    // renders the first-run conversation (SPEC §31), and a transcript carries
    // its own `role="status"` announcer. Two status regions on one page is
    // correct here; addressing the toast by its text is what makes the
    // assertion say which one it means.
    const toast = (await screen.findAllByRole("status")).find((node) =>
      /deleted "japan"/i.test(node.textContent ?? ""),
    )!;
    expect(toast).toBeTruthy();

    await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/trips/${tripId}/commands`),
      expect.objectContaining({ body: expect.stringContaining('"RestoreTrip"') }),
    );
  });

  it("removes the row immediately on the click, before the delete request resolves", async () => {
    let resolveDelete: (r: Response) => void;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    // The DeleteTrip request is still in flight (we haven't resolved it yet),
    // but the row should already be gone from the list.
    await waitFor(() => expect(screen.queryByText("Japan")).toBeNull());

    resolveDelete!(
      jsonResponse({ detail: tripDetailFixture({ tripId, name: "Japan" }), history: historyFixture(tripId) }),
    );
    await screen.findByRole("status");
  });

  it("brings the row back and shows an error if the delete request fails", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return jsonResponse({ error: "concurrency-conflict" }, 409);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    await screen.findByRole("alert");
    // Two "Japan"s now render: the next-trip hero heading and the trip-list
    // row link — assert the row link specifically survived the failed
    // delete (the hero also renders "Japan" as its `Heading level={2}`,
    // making a bare `getByText("Japan")` ambiguous).
    expect(screen.getByRole("link", { name: "Japan" })).toBeTruthy();
  });

  it("duplicates a trip and navigates to the copy", async () => {
    const newTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${tripId}/duplicate`)) {
        return jsonResponse({ tripId: newTripId }, 201);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /duplicate/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/trips/${tripId}/duplicate`),
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${newTripId}`));
  });

  // Phase 7 Task 7.2 replaced the single-field New-trip Dialog with the
  // 4-step NewTripWizard, hosted in a Sheet titled "New trip" (same
  // accessible name the old Dialog had). *create an empty one* is the wizard's
  // still-reachable name-only path (NewTripWizard.tsx), so this exercises
  // the same createTrip-fails-and-the-overlay-stays-open behavior the old
  // test covered, through the new control.
  it("shows the create-trip error inside the still-open New-trip sheet on failure", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips") && init?.method === "POST") {
        return jsonResponse({ error: "name already taken" }, 400);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /^new trip$/i }));

    const dialog = await screen.findByRole("dialog", { name: /new trip/i });
    await userEvent.type(within(dialog).getByLabelText("Where are you going?"), "Iceland");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create an empty one$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/name already taken/i);
    // The error is rendered inside the sheet's content, not as a sibling
    // that would be visually stranded behind the overlay.
    expect(within(dialog).getByRole("alert").textContent).toMatch(/name already taken/i);
    // The sheet must still be open — createTrip does not close it on failure.
    expect(screen.getByRole("dialog", { name: /new trip/i })).toBeTruthy();
  });

  // Regression (CI, PR #32): an earlier draft had "Create empty" navigate
  // straight to the new trip, same as the full wizard's "Create trip". That
  // broke every e2e spec built on the old single-field dialog's actual
  // behavior — close, refresh the list, stay put, then click the new trip to
  // navigate. *create an empty one* (§35.2's link, which replaced the button)
  // is explicitly that dialog's escape hatch (NewTripWizard.tsx), so it keeps
  // that exact behavior; only the full wizard (dates/budget applied, "Create
  // trip") navigates. The new trip is the list's newest, so it lands as the
  // hero — a level-2 heading, not a card's level-3 one.
  it("stays on the trip list and shows the new trip after create an empty one, without navigating", async () => {
    const newTripId = "1a2b3c4d-5e6f-4789-9abc-def012345678";
    let listCallCount = 0;
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips") && init?.method === "POST") {
        return jsonResponse({ tripId: newTripId }, 201);
      }
      if (url.endsWith("/api/trips")) {
        listCallCount += 1;
        const trips = listCallCount === 1 ? [] : [tripSummaryFixture({ tripId: newTripId, name: "Reykjavik" })];
        return jsonResponse({ trips });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    // The list loads empty, so the conversation is inline rather than in a
    // sheet (SPEC §31) — same flow, same link, one fewer click.
    const firstRun = await screen.findByTestId("first-trip-start");
    await userEvent.type(within(firstRun).getByLabelText("Where are you going?"), "Reykjavik");
    await userEvent.click(within(firstRun).getByRole("button", { name: /^create an empty one$/i }));

    expect(await screen.findByRole("heading", { name: "Reykjavik", level: 2 })).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Task 18: "Start from a Playbook" — on the empty state since §35.2 took it
  // out of the page head — is a real navigation control. It must render
  // outside any Preview region and carry a real href, not merely appear in
  // the markup.
  it("renders a real, navigable Start from a Playbook link outside any Preview region", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips")) return jsonResponse({ trips: [] });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const link = await screen.findByRole("link", { name: /start from a playbook/i });
    expect(link.getAttribute("href")).toBe("/playbooks");
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(link.closest("[data-preview-id]")).toBeNull();
  });
});

// Task 4.1 (M10 Phase 4): TripCard's plannedOfBudget prop already renders
// correctly (TripCard.test.tsx) and NextTripHero already computes its own
// line from a real TripDetail fetch — but page.tsx is the caller for every
// grid card (NextTripHero and TripCard are siblings here, not caller/callee),
// so it must fetch each visible trip's own TripDetail and pass the computed
// line down itself.
describe("Home trip cards' planned-of-budget line", () => {
  const secondTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";

  it("gives each visible trip card its own real planned-of-budget line once its TripDetail fetch resolves", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        return jsonResponse({
          trip: tripDetailFixture({
            tripId: secondTripId,
            budget: { amountMinor: 50_000, currency: "USD" },
            tripCostTotal: 12_500,
            budgetRemaining: 37_500,
          }),
        });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [tripSummaryFixture(), tripSummaryFixture({ tripId: secondTripId, name: "Peru" })],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // Second trip only ever appears in the grid (the hero renders the
    // first trip), so this line proves the grid card computed it itself
    // from its own real TripDetail fetch, not something threaded through
    // NextTripHero (which never renders or calls TripCard).
    expect(await screen.findByText(`${formatMoney(12_500, "USD")} planned of ${formatMoney(50_000, "USD")}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/trips/${secondTripId}`), expect.anything());
  });

  it("renders a grid card without a planned-of-budget line while its own TripDetail fetch is still pending or has failed (no fabricated or stale line)", async () => {
    let resolveSecond: (r: Response) => void;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve;
        });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [tripSummaryFixture(), tripSummaryFixture({ tripId: secondTripId, name: "Peru" })],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // Scope to the Peru card's own block (not the whole page) — the first
    // trip's card and the hero both legitimately show "No budget yet" in
    // this fixture, which would otherwise make a page-wide assertion pass
    // for the wrong reason.
    const peruHeading = await screen.findByRole("heading", { name: "Peru" });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const peruBlock = peruHeading.closest("div");
    expect(peruBlock).not.toBeNull();
    expect(within(peruBlock!).queryByText(/planned of/)).toBeNull();
    expect(within(peruBlock!).queryByText("No budget yet")).toBeNull();

    // Resolving with an error afterward must not retroactively fabricate one.
    resolveSecond!(jsonResponse({ error: "boom" }, 500));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/trips/${secondTripId}`), expect.anything()));
    expect(within(peruBlock!).queryByText(/planned of/)).toBeNull();
    expect(within(peruBlock!).queryByText("No budget yet")).toBeNull();
  });

  // Regression test: a genuine network-level failure (fetch() itself
  // rejecting -- offline, DNS, CORS -- not an HTTP-level { ok: false })
  // must not leave an earlier round's real line stranded on screen looking
  // current. Promise.all is fail-fast, so one rejected per-trip fetch used
  // to abort the whole round's .then(...), leaving whatever was set by the
  // previous successful round untouched.
  it("clears a real planned-of-budget line rather than leaving it stale when a later round's fetch rejects at the network level", async () => {
    const thirdTripId = "11112222-3333-4444-5555-666677778888";
    let secondTripCallCount = 0;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${thirdTripId}/commands`)) {
        return jsonResponse({
          detail: tripDetailFixture({ tripId: thirdTripId, name: "Chile" }),
          history: historyFixture(thirdTripId),
        });
      }
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        secondTripCallCount += 1;
        if (secondTripCallCount === 1) {
          return jsonResponse({
            trip: tripDetailFixture({
              tripId: secondTripId,
              budget: { amountMinor: 50_000, currency: "USD" },
              tripCostTotal: 12_500,
              budgetRemaining: 37_500,
            }),
          });
        }
        // Second round: a network-level failure -- fetch() itself rejects,
        // not an HTTP error response.
        throw new Error("network down");
      }
      if (url.endsWith(`/api/trips/${thirdTripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId: thirdTripId, budget: null }) });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [
            tripSummaryFixture(),
            tripSummaryFixture({ tripId: secondTripId, name: "Peru" }),
            tripSummaryFixture({ tripId: thirdTripId, name: "Chile" }),
          ],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const peruHeading = await screen.findByRole("heading", { name: "Peru" });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const peruBlock = peruHeading.closest("div");
    expect(peruBlock).not.toBeNull();
    expect(
      await within(peruBlock!).findByText(`${formatMoney(12_500, "USD")} planned of ${formatMoney(50_000, "USD")}`),
    ).toBeTruthy();

    // Delete the third trip: this changes the visible trip-id set (Chile
    // drops out), triggering a new fetch round for the remaining trips --
    // the same kind of trip-added/removed/reordered trigger described in
    // the effect's own bug. Peru's own TripDetail fetch rejects in this
    // round.
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for chile/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    await waitFor(() => expect(secondTripCallCount).toBeGreaterThanOrEqual(2));
    // The stale line from round 1 must not survive a round whose fetch
    // rejected -- it must be cleared, not left showing outdated data.
    await waitFor(() => expect(within(peruBlock!).queryByText(/planned of/)).toBeNull());
  });
});

// Task 8.5: page head/rhythm — a date line above the title, and a real
// "All trips" heading + count above the grid.
describe("Home page head", () => {
  function renderHome(trips: TripSummary[] = [tripSummaryFixture()]) {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips")) return jsonResponse({ trips });
      if (/\/api\/trips\/[^/]+$/.test(url)) return jsonResponse({ trip: tripDetailFixture({ tripId }) });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    return render(<Home />);
  }

  it("heads the page with today's date above the title", () => {
    renderHome();
    expect(screen.getByTestId("page-date-line")).toBeTruthy();
  });

  // CodeRabbit (PR #35): the date line used to compute `new Date()` inline
  // during render, which — since Next.js still server-renders a "use
  // client" component's initial HTML — could disagree with the browser's
  // own clock across a timezone boundary and either throw a hydration
  // mismatch or, worse, silently show the WRONG day until some unrelated
  // re-render happened to overwrite it. The fix moves the computation into
  // a client-only effect (`dateLabel` starts `null`, so there's nothing for
  // a server render to get wrong), which this test can't observe directly
  // — React Testing Library's `render` flushes a synchronous, no-async-work
  // effect like this one before returning, so there's no "still empty"
  // window to catch here. What the test DOES lock in, which is the actual
  // property that matters: the label reflects the VIEWER's local calendar
  // date, not a UTC one, at an instant deliberately chosen to fall on
  // different calendar days in UTC vs. a real negative-offset timezone.
  it("renders the viewer's local date, not a UTC-shifted one, across a day boundary", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu"; // UTC-10, no DST -- far enough from UTC to guarantee a boundary crossing below
    try {
      vi.useFakeTimers();
      // 2026-03-02T05:00:00Z is already March 2nd in UTC, but still March
      // 1st in Honolulu -- exactly the class of instant where a
      // server-clock (often UTC) render and the viewer's own local render
      // would disagree if the date were computed eagerly.
      vi.setSystemTime(new Date("2026-03-02T05:00:00Z"));
      renderHome();
      const dateLine = screen.getByTestId("page-date-line");
      expect(dateLine.textContent).toMatch(/mar(ch)? 1, 2026/i);
      expect(dateLine.textContent).not.toMatch(/mar(ch)? 2, 2026/i);
      // The visible label is human-readable prose ("Sun, Mar 1, 2026"), but
      // <time> also wants a real machine-readable value alongside it
      // (CodeRabbit, PR #35) -- and that value must be the same LOCAL day
      // the label names, not a UTC one.
      expect(dateLine.getAttribute("datetime")).toBe("2026-03-01");
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTz;
    }
  });

  const PERU = tripSummaryFixture({ tripId: "0b9d4a1e-2c3f-4d5e-8f60-718293a4b5c6", name: "Peru" });

  it("labels the grid of the trips that are not the hero", async () => {
    renderHome([tripSummaryFixture(), PERU]);
    expect(await screen.findByRole("heading", { name: "Other trips" })).toBeTruthy();
  });

  // SPEC §35.2: it was "All trips", and it drew the hero's trip a second time
  // directly under the hero. The list is newest-first and the hero is its
  // head, so the grid is everything after it.
  it("does not repeat the hero in Other trips, and counts only what the grid shows", async () => {
    renderHome([tripSummaryFixture(), PERU]);
    await screen.findByRole("heading", { name: "Other trips" });

    const cards = screen.getAllByTestId("trip-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByRole("heading", { name: "Peru" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Japan", level: 2 })).toBeTruthy();
    expect(screen.getByText("1 trip")).toBeTruthy();
  });

  // **KI-034: the hero is the next trip by DATE, not the list's head.** The
  // list arrives newest-created first, so a trip made yesterday for next
  // spring sits ahead of one made last month for next week. Both dates are in
  // 2099 so "upcoming" does not depend on the day the suite runs.
  it("makes the soonest upcoming trip the hero, whatever order the list came in", async () => {
    const SPRING = tripSummaryFixture({
      tripId: "0b9d4a1e-2c3f-4d5e-8f60-718293a4b5c6",
      name: "Peru",
      startDate: "2099-04-01",
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    const NEXT_WEEK = tripSummaryFixture({ startDate: "2099-03-01" });
    renderHome([SPRING, NEXT_WEEK]);

    expect(await screen.findByRole("heading", { name: "Japan", level: 2 })).toBeTruthy();
    const cards = screen.getAllByTestId("trip-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByRole("heading", { name: "Peru" })).toBeTruthy();
  });

  // An undated trip outranks one that has already started: the hero says
  // "Next trip", and a trip in the past is not one.
  it("puts an undated trip ahead of a past one for the hero", async () => {
    const PAST = tripSummaryFixture({ startDate: "2001-01-01" });
    renderHome([PAST, PERU]);

    expect(await screen.findByRole("heading", { name: "Peru", level: 2 })).toBeTruthy();
  });

  // One trip is the hero and nothing else — a heading over an empty grid would
  // announce a list that is not there.
  it("draws no Other trips heading when the hero is the only trip", async () => {
    renderHome([tripSummaryFixture()]);
    await screen.findByRole("heading", { name: "Japan", level: 2 });
    expect(screen.queryByRole("heading", { name: "Other trips" })).toBeNull();
    expect(screen.queryByTestId("trip-card")).toBeNull();
  });

  // **M27 D3.** The hero left the grid, and the grid's cards were the only
  // place a trip's lifecycle menu lived on Home. The single-trip fixtures in
  // "Home trip actions" above reach Delete and Duplicate through the hero's
  // menu for exactly this reason; this names the claim.
  it("gives the hero the same lifecycle menu a card has", async () => {
    renderHome([tripSummaryFixture()]);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("does not render the Other trips heading when there are no trips to show", async () => {
    renderHome([]);
    await screen.findByText(/A name is enough to start/i);
    expect(screen.queryByRole("heading", { name: "Other trips" })).toBeNull();
  });

  // **SPEC §35.2: the head is "New trip" and nothing else.** *Import a file*
  // and *Start from a Playbook* sat beside it; import is a quiet link now and
  // Playbooks are reached from the new-trip sheet's row and the empty state.
  // With trips and the sheet closed, neither is anywhere but that one link.
  it("heads the page with New trip only", async () => {
    renderHome([tripSummaryFixture(), PERU]);
    await screen.findByRole("heading", { name: "Other trips" });
    expect(screen.getByRole("button", { name: "New trip" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /start from a playbook/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /import a file/i })).toBeNull();
  });

  // **One import control, and one picker, on either screen** (M25). It was in
  // the page head on both screens once, which at 375px pushed the first-run
  // composer out of the viewport (`responsive.spec.ts`). Asserted here rather
  // than left to the e2e lane because "two of them" and "none of them" are
  // both one edit away, and the browser walk would find either copy by name.
  //
  // With trips it is the phone's link under the grid (§35.2) — hidden above
  // `md` by CSS, which jsdom does not apply, so it is present here.
  it("puts one import link under the grid once there are trips", async () => {
    renderHome([tripSummaryFixture(), PERU]);
    await screen.findByRole("heading", { name: "Other trips" });
    expect(screen.getAllByRole("button", { name: /import/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Import a trip file" })).toBeTruthy();
    expect(screen.getAllByTestId("trip-file-input")).toHaveLength(1);
    expect(screen.queryByTestId("first-trip-start")).toBeNull();
  });

  it("puts it on the first-run card instead when there are none, and only there", async () => {
    renderHome([]);
    const firstRun = await screen.findByTestId("first-trip-start");
    const all = screen.getAllByRole("button", { name: /import/i });
    expect(all).toHaveLength(1);
    expect(firstRun.contains(all[0]!)).toBe(true);
    expect(screen.getAllByTestId("trip-file-input")).toHaveLength(1);
  });

  // **The sheet's *import a trip file* opens the PAGE's picker** (§35.2). The
  // sheet closes on the click, which unmounts anything inside it, so the
  // picker and its refusal banner live on the page and the link reaches them.
  // Same click, because a browser only opens a file picker from a gesture.
  it("closes the sheet and opens the page's own picker from the sheet's import link", async () => {
    renderHome([tripSummaryFixture(), PERU]);
    await screen.findByRole("heading", { name: "Other trips" });
    const pickerClicked = vi.fn();
    screen.getByTestId("trip-file-input").addEventListener("click", pickerClicked);

    await userEvent.click(screen.getByRole("button", { name: "New trip" }));
    const sheet = await screen.findByRole("dialog", { name: /new trip/i });
    await userEvent.click(within(sheet).getByRole("button", { name: "import a trip file" }));

    expect(pickerClicked).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new trip/i })).toBeNull());
  });
});

describe("Home first-run experience", () => {
  it("welcomes a signed-in user who has no trips yet", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    expect(await screen.findByText("Plan your first trip")).toBeDefined();
    expect(screen.getByText(/A name is enough to start/)).toBeDefined();
  });

  // SPEC §35.2: the empty state's import is one quiet line whose own words say
  // what it is for — *Have a trip file? Import it* — and the sentence §34.2
  // put under the old button ("A trip you downloaded from here…") is dropped.
  // *Start from a Playbook* stays as the one secondary route.
  it("offers import in the empty state as one quiet line, beside Start from a Playbook", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const firstRun = await screen.findByTestId("first-trip-start");
    expect(within(firstRun).getByRole("button", { name: "Have a trip file? Import it" })).toBeTruthy();
    expect(within(firstRun).getByRole("link", { name: "Start from a Playbook" })).toBeTruthy();
    expect(within(firstRun).queryByText(/comes back whole from its file/i)).toBeNull();
  });

  // The first-run screen promises "a name is enough to start", so it has to
  // offer somewhere to start. It used to do that with a "Name your trip"
  // button beside a numbered list of the four questions; **the conversation
  // itself is on the screen now** (SPEC §31, 2026-09-18), so the first thing a
  // new account sees is the first question, already answerable. Scoped to the
  // first-run card, so the page head cannot satisfy this by accident.
  it("puts the conversation itself in the first-run screen, already answerable", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const firstRun = await screen.findByTestId("first-trip-start");
    // The first question, and the field that answers it — no click-through.
    expect(within(firstRun).getByRole("log", { name: "Conversation" }).textContent).toContain(
      "Where are you going?",
    );
    expect(within(firstRun).getByLabelText("Where are you going?")).toBeTruthy();
    // And the opening line, which states the no-generation contract (§31.2)
    // in Cass's voice (§35.8). No name to greet with here — the session read
    // below answers with no user — so she does not invent one.
    expect(within(firstRun).getByRole("log").textContent).toContain(
      "Hi, I’m Cass. I plan trips here — ask me a few things and I’ll draft your first one. Nothing is made until your last answer.",
    );
  });

  // §35.8: *"first run: Hi Sam, I'm Cass"* — by the first word of a real name,
  // read from the session, and never the "Traveler 4f2a91" handle.
  it("greets a first run by the reader's first name", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/auth/session")
        ? jsonResponse({ user: { id: "google-123", name: "Sam Rivera" } })
        : jsonResponse({ trips: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const firstRun = await screen.findByTestId("first-trip-start");
    await waitFor(() =>
      expect(within(firstRun).getByRole("log").textContent).toContain("Hi Sam, I’m Cass."),
    );
  });

  // **One conversation on the screen, not two.** The page head's "New trip"
  // opens the sheet everywhere else; here the conversation is already inline,
  // so opening it would put two composers with the same accessible name on one
  // page — ambiguous to a screen reader, and a strict-mode violation for any
  // test addressing the field by its label. The button focuses the one that
  // exists instead.
  it("focuses the inline conversation rather than opening a second one", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await screen.findByTestId("first-trip-start");

    await userEvent.click(screen.getByRole("button", { name: "New trip" }));

    // Exactly one composer, and no sheet behind it.
    const composers = screen.getAllByLabelText("Where are you going?");
    expect(composers).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: /new trip/i })).toBeNull();

    // And the button really moved the cursor there: typing with no further
    // click lands in that field. Asserted through behaviour rather than
    // `document.activeElement`, which the testing-library rule forbids — and
    // which would pass on a field that is focused but not typeable.
    await userEvent.keyboard("Lisbon");
    expect((composers[0] as HTMLInputElement).value).toBe("Lisbon");
  });

  // "Building a trip from total scratch is a rough experience" (Mitchell,
  // 2026-09-01). The other two routes into the product already existed and were
  // reachable from everywhere EXCEPT the screen where somebody has nothing:
  // the library, and the example trip. Scoped to the first-run screen for the
  // same reason the CTA above is — the page head carries a Playbooks link too,
  // and it must not be what satisfies this.
  it("offers the library and the example trip as well as a blank name", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const firstRun = await screen.findByTestId("first-trip-start");
    expect(within(firstRun).getByRole("link", { name: "Start from a Playbook" })).toBeTruthy();
    expect(
      within(firstRun).getByRole("link", { name: "Look around an example trip" }),
    ).toHaveProperty("href", expect.stringContaining("/demo"));
  });

  // **The sheet a reader is typing into is not the one to take away.**
  //
  // Three shapes have stood here. Rendering the sheet beside the inline
  // conversation was the original defect — two fields with one accessible
  // name. CodeRabbit's round 2 produced `open={newTripOpen && !hasNoTrips}`
  // plus an effect that cleared the request, which fixed that and broke
  // something worse: a reader who pressed "New trip" while the list was still
  // loading, and typed, lost every keystroke the instant the empty list
  // resolved — the sheet vanished and an empty inline field took its place,
  // with "Create empty" disabled and no way to enable it. That is what hung
  // `createEmptyTripViaWizard` for its full 30s timeout (e2e, 2026-09-18).
  //
  // The sheet wins now and `FirstTripStart` yields its conversation. Both
  // halves of the original concern still hold, and both are asserted here.
  it("keeps the sheet and what was typed into it when the list lands empty", async () => {
    const newTripId = "1a2b3c4d-5e6f-4789-9abc-def012345678";
    let resolveList!: (response: Response) => void;
    const listPending = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    let listCallCount = 0;
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips") && init?.method === "POST") {
        return jsonResponse({ tripId: newTripId }, 201);
      }
      if (url.endsWith("/api/trips")) {
        listCallCount += 1;
        // Held open on the first call so the click below lands while `trips`
        // is still null — the one window where the page-head button opens the
        // sheet rather than focusing the inline field.
        if (listCallCount === 1) return listPending;
        return jsonResponse({ trips: [tripSummaryFixture({ tripId: newTripId, name: "Osaka" })] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /^new trip$/i }));
    const sheet = await screen.findByRole("dialog", { name: /new trip/i });

    // Typing starts before the list has resolved, which is the whole point.
    await userEvent.type(within(sheet).getByLabelText("Where are you going?"), "Osaka");

    resolveList(jsonResponse({ trips: [] }));
    await screen.findByTestId("first-trip-start");

    // The sheet is still here, and so is what was typed into it.
    expect(screen.getByRole("dialog", { name: /new trip/i })).toBeTruthy();
    expect(screen.getByLabelText("Where are you going?")).toHaveProperty("value", "Osaka");
    // Exactly one composer: the first-run screen yielded its conversation
    // rather than putting a second field with the same name on the page.
    expect(screen.getAllByLabelText("Where are you going?")).toHaveLength(1);
    expect(screen.queryByTestId("first-trip-conversation")).toBeNull();

    // And it still works: the typed name reaches the create.
    await userEvent.click(within(sheet).getByRole("button", { name: /^create an empty one$/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/trips"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls.find((c) => c[1]?.method === "POST")?.[1]?.body),
    ) as { name: string };
    expect(body.name).toBe("Osaka");
  });

  // Mitchell, 2026-09-01: *"The 'New trip' side bar should be a full screen
  // experience when you have no trips"*. That is now satisfied more directly
  // than by a full-screen sheet — the conversation is the page. What has to
  // stay true is that the two routes which are not "start from nothing" are
  // still offered here, since this is the screen where a person has no trip.
  it("keeps the other two routes beside the conversation on a first run", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const firstRun = await screen.findByTestId("first-trip-start");
    expect(within(firstRun).getByTestId("first-trip-conversation")).toBeTruthy();
    expect(within(firstRun).getByRole("link", { name: "Start from a Playbook" })).toBeTruthy();
    expect(within(firstRun).getByRole("link", { name: "Look around an example trip" })).toBeTruthy();
  });

  // This is the evidence for a milestone exit-gate requirement (M15 decision
  // 3: "Create empty" from NewTripWizard's step 1 replaces the designed
  // one-field first-run screen — see the EmptyState comment above), so it
  // has to actually prove what it claims: that the *entered* name reaches
  // the POST, and that the trip that comes back really does replace the
  // first-run empty state. CodeRabbit (PR #56, finding 3): the previous
  // version only asserted that *some* POST to /api/trips happened, which a
  // POST with no name, or the wrong name, would also satisfy.
  it("creates a first trip from a name alone", async () => {
    const created = { tripId, name: "Japan" };
    let listCallCount = 0;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/trips") && init?.method === "POST") return jsonResponse(created, 201);
      if (url.endsWith("/api/trips")) {
        listCallCount += 1;
        // First GET (initial load) finds no trips, which is what puts Home
        // in the first-run empty state this test starts from; the reload
        // that *create an empty one* triggers (Home's onCreated -> load(), same
        // stay-on-list-and-refresh path "stays on the trip list and shows
        // the new trip after create an empty one" above exercises) finds the trip
        // that was just created.
        const trips = listCallCount === 1 ? [] : [tripSummaryFixture({ tripId, name: "Japan" })];
        return jsonResponse({ trips });
      }
      // Anything else (e.g. the per-card TripDetail fetch Home's
      // plannedOfBudget effect fires once the new trip renders) is
      // deliberately unmocked here, same as the other tests in this
      // describe block — Home already treats a failed detail fetch as
      // honest absence (no plannedOfBudget line), not an error.
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "New trip" }));
    await userEvent.type(screen.getByLabelText("Where are you going?"), "Japan");

    // The first turn — *create an empty one* works from the name alone, which is why
    // M15 needs no separate one-field first-run screen (decision 3).
    await userEvent.click(screen.getByRole("button", { name: "create an empty one" }));

    // **The body now carries a client-minted `tripId`** (KI-2026-09-12-e), so
    // this can no longer be an exact `JSON.stringify` match. It is the only
    // test that exercises the real wire format end to end — `createTrip` and
    // `fetch` are both real here — which makes it the right place to pin that
    // the id actually reaches the request rather than stopping at the module
    // boundary.
    // The POST, not call zero: the page loads its trip list first, and that GET
    // has no `init` at all — reading `.method` off it is a TypeError, not a
    // failed assertion.
    const createCall = () =>
      (fetchMock.mock.calls as [string, RequestInit | undefined][]).find(
        ([url, init]) => url.includes("/api/trips") && init?.method === "POST",
      );
    await waitFor(() => expect(createCall()).toBeDefined());
    const init = createCall()![1]!;
    expect(JSON.parse(String(init.body)) as { name: string; tripId: string }).toEqual({
      name: "Japan",
      tripId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
    });

    // Post-create state: the first-run empty state is gone, the new trip is
    // showing in its place as the hero (its only trip), and *create an empty
    // one* never navigates (only the full wizard's dates/budget path does —
    // see "stays on the trip list and shows the new trip after create an
    // empty one" above).
    expect(await screen.findByRole("heading", { name: "Japan", level: 2 })).toBeTruthy();
    expect(screen.queryByText("Plan your first trip")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("Home unauthenticated visitor", () => {
  it("sends an unauthenticated visitor to the landing page", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ error: "unauthenticated" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/welcome"));
  });
});

// The "Make this trip mine" intent, redeemed where the person actually lands.
//
// Mitchell walked every one of these on 2026-09-01 and arrived with no trip:
// *"after you sign up (whether or not you errored because you didnt have code,
// or you did have code, or if you already had account) you dont have the trip
// from the demo you tried to clone."* The `?callbackUrl=` the demo attaches
// only reaches `/signin`; a refusal round trip (`/signup?error=…`) is built
// server-side and cannot carry one, and the swap link dropped it too. So the
// intent is banked in the browser and redeemed HERE — the one page every
// successful sign-in reaches.
describe("Home finishing a demo clone", () => {
  const clonedTripId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

  /** No trips, and a duplicate of the demo that answers with `clonedTripId`. */
  function stubEmptyListAndDuplicate(duplicateStatus = 201) {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${DEMO_TRIP_ID}/duplicate`)) {
        return duplicateStatus === 201
          ? jsonResponse({ tripId: clonedTripId }, 201)
          : jsonResponse({ error: "boom" }, duplicateStatus);
      }
      if (url.endsWith("/api/trips")) return jsonResponse({ trips: [] });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const duplicateCalls = () =>
    fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/api/trips/${DEMO_TRIP_ID}/duplicate`),
    );

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("copies the demo trip and opens it when the marker is set", async () => {
    rememberDemoClone();
    stubEmptyListAndDuplicate();

    render(<Home />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${clonedTripId}`));
    expect(duplicateCalls()).toHaveLength(1);
  });

  it("does nothing when no copy was ever asked for", async () => {
    stubEmptyListAndDuplicate();

    render(<Home />);

    await screen.findByTestId("first-trip-start");
    expect(duplicateCalls()).toHaveLength(0);
  });

  it("takes exactly one copy, however many times the effect runs", async () => {
    // `takeDemoClone` reads AND clears, which is what makes this true under
    // StrictMode's double-invoked effects. A second copy is a second trip in
    // somebody's list, from one button press.
    rememberDemoClone();
    stubEmptyListAndDuplicate();

    const { rerender } = render(<Home />);
    await waitFor(() => expect(duplicateCalls()).toHaveLength(1));
    rerender(<Home />);
    await waitFor(() => expect(duplicateCalls()).toHaveLength(1));
  });

  it("says so and stays put when the copy fails", async () => {
    // Not fatal: the trip list is a perfectly good place to be, and the demo is
    // one link away. What must not happen is a silent nothing.
    rememberDemoClone();
    stubEmptyListAndDuplicate(500);

    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not take a copy");
    expect(pushMock).not.toHaveBeenCalled();
  });

  // CodeRabbit, pull request 104: submitting the wizard while the demo copy is still in
  // flight created a second, unwanted trip — the wizard's own `createTrip` has
  // no idea a copy is already headed for this same list. Holds the duplicate
  // response open (rather than letting `stubEmptyListAndDuplicate` resolve it
  // immediately) so there's a real window to observe both launchers — the
  // page-head "New trip" button and the first-run conversation's *create an empty one*,
  // which is what's on screen because an empty trip list is what "no trips
  // yet" and "the clone hasn't resolved yet" both look like — disabled.
  it("disables both wizard launchers while the demo copy is in flight", async () => {
    rememberDemoClone();
    let resolveDuplicate!: (response: Response) => void;
    const duplicatePending = new Promise<Response>((resolve) => {
      resolveDuplicate = resolve;
    });
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${DEMO_TRIP_ID}/duplicate`)) return duplicatePending;
      if (url.endsWith("/api/trips")) return jsonResponse({ trips: [] });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const headButton = await screen.findByRole("button", { name: "New trip" });
    // **The first-run launcher is the conversation's own exit now** (SPEC §31):
    // the screen no longer carries a "Name your trip" button, it carries the
    // conversation, and *create an empty one* is the control that writes. That is what
    // must not race the in-flight duplicate.
    const createEmpty = within(await screen.findByTestId("first-trip-start")).getByRole("button", {
      name: "create an empty one",
    });
    await waitFor(() => {
      expect((headButton as HTMLButtonElement).disabled).toBe(true);
      expect((createEmpty as HTMLButtonElement).disabled).toBe(true);
    });

    // Let the pending request settle so the test doesn't leave a dangling
    // fetch behind it; the resulting navigation just confirms the clone
    // itself still finishes normally once unblocked.
    resolveDuplicate(jsonResponse({ tripId: clonedTripId }, 201));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${clonedTripId}`));
  });

  // The other half of the same fix: a wizard already open when the clone
  // starts must not be left sitting over a list that's about to be replaced
  // by a navigation — submitting it would still create the unwanted extra
  // trip the disabled-launcher test above guards against. The demo-clone
  // effect only fires once `/api/trips` resolves (it's gated on `trips !==
  // null`), so this holds THAT fetch open — not the duplicate one — to get a
  // real window where the page-head button is open for business (nothing has
  // decided yet whether this account has zero trips or a pending clone) and
  // a person can open the wizard before the clone claims it.
  it("closes an already-open wizard when the demo copy starts", async () => {
    rememberDemoClone();
    let resolveList!: (response: Response) => void;
    const listPending = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes(`/api/trips/${DEMO_TRIP_ID}/duplicate`)) {
        return jsonResponse({ tripId: clonedTripId }, 201);
      }
      if (url.endsWith("/api/trips")) return listPending;
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // `trips` is still null here, so `hasNoTrips` is false and `FirstTripStart`
    // hasn't rendered yet — the page-head button is the only launcher on
    // screen, and it's what a person who clicks before the list has loaded
    // actually has available.
    await userEvent.click(screen.getByRole("button", { name: "New trip" }));
    expect(await screen.findByLabelText("Where are you going?")).toBeTruthy();

    // Now let the list resolve empty: `takeDemoClone`'s effect fires, closing
    // the wizard out from under whatever was being typed into it.
    resolveList(jsonResponse({ trips: [] }));

    // **The SHEET closes** — that is what "out from under whatever was being
    // typed" means, and it is still true. What is new (SPEC §31) is that an
    // empty list renders the conversation inline, so a composer remains on the
    // page. It is a fresh one: the abandoned draft did not survive into it,
    // which is the property this test is really about.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new trip/i })).toBeNull());
    const inline = within(await screen.findByTestId("first-trip-start")).getByLabelText(
      "Where are you going?",
    );
    expect((inline as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${clonedTripId}`));
  });
});

// The third site of the class the 2026-08-28 review named (§1.1): a `load()`
// that handles 401 and nothing else. `trips` stays null on any other failure,
// and both render branches on this page are gated on `trips !== null`, so the
// page shows a title row and "New trip" and never says a word — while an
// unhandled rejection lands in the console. `TripProvider.load` got its
// try/catch then; this site did not (KI-2026-09-05-y / F-G03).
describe("Home trip list load failures", () => {
  it("says the list could not be loaded, and offers a retry, when /api/trips 500s with a non-JSON body", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips")) return new Response("boom", { status: 500 });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not load your trips/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    // Not the first-run card: "your trips could not be read" and "you have no
    // trips" are different statements, and only one of them is true here.
    expect(screen.queryByText("Plan your first trip")).toBeNull();
    // And not /welcome either — only a 401 means that (F-G03's "Do not").
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("says the same when the fetch itself rejects, and the retry reloads the list", async () => {
    let attempt = 0;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips")) {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return jsonResponse({ trips: [tripSummaryFixture({ tripId, name: "Japan" })] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not load your trips/i);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    // The only trip, so the hero's level-2 heading — not a card's (§35.2).
    expect(await screen.findByRole("heading", { name: "Japan", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// SPEC §32.2 — *"the phone gets the flow… full-screen conversation"*. M26 Wave
// 2, link 15.
//
// **There is deliberately no test here that the sheet is full-screen**, and the
// lint wall is why: "full screen" is a class swap (`max-w-measure` for
// `inset-x-0`), this file is not a `components/ui/**` primitive, and jsdom has
// neither layout nor media queries — so a `className` assertion here would be
// the second time in this wave I tried to make a paint claim at a layer that
// cannot hold one. It belongs to the `phone` Playwright project at 411px, which
// is link 16's work, and it is listed there.
//
// What this file still holds, unchanged above: that the conversation opens at
// all, that it is one conversation and not two, and every behaviour of the flow
// inside it. Those are the claims a unit test can actually make.

// M26 link 7, §3b. Home used to render its date line, its heading and its three
// buttons and then NOTHING while the list was in flight, and on failure one
// danger-coloured line at the top whose single *Try again* re-ran the whole
// page. Both are the dead screen §3b forbids.
describe("Home — the states between asked and answered", () => {
  it("paints its own shape while the list is still in flight", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/trips")) return new Promise<Response>(() => {});
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // Both regions, by their own names — a single "Loading…" for a page that
    // is part-painted is what §3b is against.
    expect(await screen.findByRole("status", { name: "Loading your next trip" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading your trips" })).toBeTruthy();
    // Rule 1: the chrome is real from the first frame, not placeholdered.
    expect(screen.getByRole("button", { name: "New trip" })).toBeTruthy();
  });

  it("puts a failed list's retry in place, and keeps the rest of the page", async () => {
    let attempts = 0;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.endsWith("/api/trips")) {
        attempts += 1;
        return attempts === 1 ? jsonResponse({ error: "boom" }, 500) : jsonResponse({ trips: [tripSummaryFixture()] });
      }
      if (url.includes(`/api/trips/${tripId}`)) {
        return jsonResponse({ detail: tripDetailFixture({ tripId, name: "Japan" }), history: historyFixture(tripId) });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const failed = await screen.findByTestId("home-trips-error");
    expect(within(failed).getByText(/Could not load your trips/i)).toBeTruthy();
    // The sentence that makes this a REGION's failure rather than the page's.
    expect(within(failed).getByText(/Everything else on the page is current/i)).toBeTruthy();
    // And it is: the page head is untouched.
    expect(screen.getByRole("button", { name: "New trip" })).toBeTruthy();

    // No placeholder under a failure notice — a breathing outline promises an
    // arrival that is not coming.
    expect(screen.queryByRole("status", { name: "Loading your trips" })).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading your next trip" })).toBeNull();

    await userEvent.click(within(failed).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: /japan/i })).toBeTruthy();
    expect(screen.queryByTestId("home-trips-error")).toBeNull();
  });
});

// M26 link 6b, SPEC §27: "a trip someone shared with you offers Leave this
// trip". Before this the menu offered Delete unconditionally, so a guest was
// shown a verb `MINIMUM_ROLE.DeleteTrip` refuses — a control that appears to do
// something and gives a silent nothing.
describe("Home — Delete or Leave, never the wrong one", () => {
  const GUEST_ID = "dev-bob";
  const shared = () =>
    tripSummaryFixture({
      name: "Kyoto",
      members: [
        { userId: OWNER_ID, role: "owner" },
        { userId: GUEST_ID, role: "editor" },
      ],
    });

  function stubTrips(trip: TripSummary, onLeave?: (url: string, init?: RequestInit) => Response) {
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // `useSessionUser` reads this endpoint directly now, so that a FAILED
      // session request stays distinguishable from a signed-out one
      // (CodeRabbit, PR #196). Each test still drives the session through
      // `getSessionMock` exactly as before; only the transport moved.
      if (url.includes("/api/auth/session")) return jsonResponse(await getSessionMock());
      if (url.includes("/membership") && onLeave) return onLeave(url, init);
      if (url.endsWith("/api/trips")) return jsonResponse({ trips: [trip] });
      if (url.includes(`/api/trips/${tripId}`)) {
        return jsonResponse({ detail: tripDetailFixture({ tripId, name: trip.name }), history: historyFixture(tripId) });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("offers Delete on a trip you own", async () => {
    stubTrips(tripSummaryFixture());
    render(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /leave this trip/i })).toBeNull();
  });

  it("offers Leave this trip, and no Delete, on a trip shared with you", async () => {
    getSessionMock.mockResolvedValue({ user: { id: GUEST_ID } });
    stubTrips(shared());
    render(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: /trip actions for kyoto/i }));
    expect(screen.getByRole("menuitem", { name: /leave this trip/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("leaving drops the card and calls the membership endpoint, not a command", async () => {
    getSessionMock.mockResolvedValue({ user: { id: GUEST_ID } });
    stubTrips(shared(), () => jsonResponse({ ok: true }));
    render(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: /trip actions for kyoto/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /leave this trip/i }));

    await waitFor(() => expect(screen.queryByRole("link", { name: /kyoto/i })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/trips/${tripId}/membership`),
      expect.objectContaining({ method: "DELETE" }),
    );
    // Leaving is not a planning command — no event, nothing in the trip's
    // history, nothing for the optimistic queue to predict (ADR-003).
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/commands"),
      expect.anything(),
    );
  });

  // The difference between the two verbs, not an omission: §27's toast exists
  // because Delete is destructive and `RestoreTrip` can undo it. Leaving
  // destroys nothing, and no verb puts you back on somebody else's trip — only
  // its owner can re-invite you. An Undo here could not keep its promise.
  it("offers no undo toast for leaving", async () => {
    getSessionMock.mockResolvedValue({ user: { id: GUEST_ID } });
    stubTrips(shared(), () => jsonResponse({ ok: true }));
    render(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: /trip actions for kyoto/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /leave this trip/i }));

    await waitFor(() => expect(screen.queryByRole("link", { name: /kyoto/i })).toBeNull());
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("puts the card back and says why when the server refuses", async () => {
    getSessionMock.mockResolvedValue({ user: { id: GUEST_ID } });
    stubTrips(shared(), () => jsonResponse({ error: "You are not a member of this trip." }, 404));
    render(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: /trip actions for kyoto/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /leave this trip/i }));

    expect(await screen.findByText("You are not a member of this trip.")).toBeTruthy();
    // The optimistic removal is undone — a card that vanished on a failed
    // request is a trip the reader now believes they are off.
    expect(screen.getByRole("link", { name: /kyoto/i })).toBeTruthy();
  });
});
